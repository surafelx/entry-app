import path from "node:path";
import fs from "node:fs";
import Entry from "./models/Entry.js";
import Transcript from "./models/Transcript.js";
import Analysis from "./models/Analysis.js";
import Segment from "./models/Segment.js";
import { analyzeTranscript } from "./analyze.js";
import {
  ffmpegAvailable, compress, extractAudio, pixelDither, cartoonifyRetro,
  extractFrames, extractPoster, getDuration, probe,
} from "./media.js";
import { whisperAvailable, transcribe } from "./transcribe.js";
import { MEDIA_DIR } from "./index.js";
import { uploadMedia, uploadImage, tmpPath, cleanupTmp } from "./cloudinary.js";

const log = (tag, ...args) => console.log(`[pipeline:${tag}]`, ...args);
const logErr = (tag, ...args) => console.error(`[pipeline:${tag}]`, ...args);

// Resolve local input file
async function resolveInput(mediaPath) {
  if (!mediaPath) return null;
  if (mediaPath.startsWith("/media/")) {
    const name = path.basename(mediaPath);
    const local = path.join(MEDIA_DIR, name);
    if (fs.existsSync(local)) return { name, input: local, local: true };
    return null;
  }
  return null;
}

// ── Step 1: Process everything locally (no Cloudinary) ──────────────────────
async function processLocally(entry) {
  const src = await resolveInput(entry.mediaPath);
  if (!src) return {};

  const base = src.name.replace(/\.[^.]+$/, "");
  const artifacts = {};

  // Duration
  try {
    const dur = await getDuration(src.input);
    artifacts.durationSec = Math.round(dur);
  } catch {}

  // Poster
  try {
    const posterOut = path.join(MEDIA_DIR, `${base}.poster.jpg`);
    await extractPoster(src.input, posterOut);
    artifacts.posterPath = `/media/${base}.poster.jpg`;
    log("local", `poster → ${base}.poster.jpg`);
  } catch (e) { logErr("local", "poster failed:", e.message); }

  // Compress + audio (parallel)
  const minOut = path.join(MEDIA_DIR, `${base}.min.mp4`);
  const audioOut = path.join(MEDIA_DIR, `${base}.audio.mp3`);
  const [compResult, audioResult] = await Promise.allSettled([
    compress(src.input, minOut, { height: 360, fps: 24, crf: 34, preset: "veryfast" })
      .then(() => { log("local", `compressed → ${base}.min.mp4`); return true; }),
    extractAudio(src.input, audioOut, { bitrate: "64k", mono: true })
      .then(() => { log("local", `audio → ${base}.audio.mp3`); return true; }),
  ]);
  if (compResult.status === "fulfilled") artifacts.compressedPath = `/media/${base}.min.mp4`;
  if (audioResult.status === "fulfilled") artifacts.audioPath = `/media/${base}.audio.mp3`;

  // Decorative — random pick 1-2
  const effects = ["dither", "retro"];
  const picked = effects.sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
  log("local", `picked effects: ${picked.join(", ")}`);

  if (picked.includes("dither")) {
    try {
      const ditherOut = path.join(MEDIA_DIR, `${base}.dither.webp`);
      await pixelDither(src.input, ditherOut, {
        width: 200, up: 480, fps: 12, colors: 48, bayer: 3, quality: 75,
      });
      artifacts.ditherPath = `/media/${base}.dither.webp`;
      log("local", `dither → ${base}.dither.webp`);
    } catch (e) { logErr("local", "dither failed:", e.message); }
  }

  if (picked.includes("retro")) {
    try {
      const retroOut = path.join(MEDIA_DIR, `${base}.retro.mp4`);
      await cartoonifyRetro(src.input, retroOut, { height: 360, fps: 24, crf: 28, preset: "fast" });
      artifacts.retroPath = `/media/${base}.retro.mp4`;
      log("local", `retro → ${base}.retro.mp4`);
    } catch (e) { logErr("local", "retro failed:", e.message); }
  }

  return artifacts;
}

// ── Step 2: Upload all artifacts to Cloudinary ──────────────────────────────
async function uploadAll(entry, artifacts) {
  const updates = {};
  const base = entry.mediaPath?.match(/\/([^/]+)$/)?.[1]?.replace(/\.[^.]+$/, "");
  if (!base) return updates;

  // Upload processed artifacts first
  const fieldMap = {
    posterPath: { ext: ".poster.jpg", type: "image" },
    compressedPath: { ext: ".min.mp4", type: "video" },
    audioPath: { ext: ".audio.mp3", type: "video" },
    ditherPath: { ext: ".dither.webp", type: "video" },
    retroPath: { ext: ".retro.mp4", type: "video" },
  };

  for (const [field, { ext, type }] of Object.entries(fieldMap)) {
    const localPath = path.join(MEDIA_DIR, `${base}${ext}`);
    if (fs.existsSync(localPath)) {
      try {
        const pubId = `${base}${ext.replace(/\.[^.]+$/, "")}`;
        const url = type === "image"
          ? await uploadImage(localPath, pubId)
          : await uploadMedia(localPath, pubId);
        if (url) updates[field] = url;
        log("upload", `${field} → Cloudinary`);
      } catch (e) { logErr("upload", `${field} failed:`, e.message); }
    }
  }

  return updates;
}

// ── Main pipeline ───────────────────────────────────────────────────────────
export async function runPipeline(entryId, transcriptText, clientFrames = []) {
  const t0 = Date.now();
  try {
    const entry = await Entry.findById(entryId);
    if (!entry) { logErr("main", `entry ${entryId} not found`); return; }

    log("main", `starting pipeline for ${entryId}`);

    let text = (transcriptText || "").trim();
    let segments = [];

    // ── Step 1: Process locally ──
    const artifacts = await processLocally(entry);
    if (artifacts.durationSec) {
      await Entry.findByIdAndUpdate(entryId, { durationSec: artifacts.durationSec });
      entry.durationSec = artifacts.durationSec;
    }

    // ── Step 2: Transcribe + extract frames (parallel) ──
    await Entry.findByIdAndUpdate(entryId, { status: "transcribing" });
    const src = await resolveInput(entry.mediaPath);

    const whisperTask = (async () => {
      if (src && (await whisperAvailable())) {
        try {
          const r = await transcribe(src.input);
          if (r?.text) {
            text = r.text;
            segments = r.segments || [];
            log("transcribe", `got ${segments.length} segments, ${text.length} chars`);
          }
        } catch (e) { logErr("transcribe", "whisper failed:", e.message); }
      }
      if (text) {
        await Transcript.findOneAndUpdate(
          { entry: entryId },
          { entry: entryId, fullText: text, language: "en" },
          { upsert: true }
        );
      }
      await Segment.deleteMany({ entry: entryId });
      if (segments.length) {
        await Segment.insertMany(
          segments.map((s) => ({ entry: entryId, startSec: s.startSec, endSec: s.endSec, text: s.text }))
        );
      }
    })();

    const framesTask = (async () => {
      if (src && (await ffmpegAvailable())) {
        try {
          const frames = await extractFrames(src.input, { count: 4, width: 512 });
          return frames.map((f) => `data:${f.mimeType};base64,${f.base64}`);
        } catch { return []; }
      }
      return [];
    })();

    const [_, frames] = await Promise.all([whisperTask, framesTask]);

    // ── Step 3: AI Analysis ──
    await Entry.findByIdAndUpdate(entryId, { status: "analyzing" });
    log("analyze", "sending to OpenRouter...");

    const a = await analyzeTranscript(text, {
      source: entry.source,
      title: entry.title,
      recordedAt: entry.recordedAt,
      frames,
      entryId,
    });

    const lifeSections = (a.lifeSections || []).map((s) => ({
      domain: s.domain,
      status: s.status,
      summary: s.summary || s.description || "",
    }));

    await Analysis.findOneAndUpdate(
      { entry: entryId },
      {
        entry: entryId,
        summary: a.summary, sentiment: a.sentiment, trajectory: a.trajectory,
        energy: a.energy, emotions: a.emotions, topics: a.topics,
        ideas: a.ideas, identity: a.identity, quotes: a.quotes,
        followUps: a.followUps, lifeSections, standing: a.standing,
        visual: a.visual, patterns: a.patterns || [], growth: a.growth || "",
        raw: a.raw,
      },
      { upsert: true }
    );
    log("analyze", `saved analysis (sentiment=${a.sentiment}, ${a.topics?.length || 0} topics)`);

    // ── Step 4: Mark ready ──
    await Entry.findByIdAndUpdate(entryId, { status: "ready" });
    log("main", `✓ entry ready ${entryId} in ${Date.now() - t0}ms`);

    // ── Step 5: Upload everything to Cloudinary ──
    const freshEntry = await Entry.findById(entryId);
    const updates = await uploadAll(freshEntry, artifacts);
    if (Object.keys(updates).length) {
      await Entry.findByIdAndUpdate(entryId, updates);
      log("main", `✓ uploaded ${Object.keys(updates).length} artifacts to Cloudinary`);
    }

    log("main", `✓ pipeline complete for ${entryId} in ${Date.now() - t0}ms`);
  } catch (err) {
    logErr("main", `entry ${entryId} failed:`, err.message);
    await Entry.findByIdAndUpdate(entryId, { status: "error" }).catch(() => {});
  }
}
