import path from "node:path";
import fs from "node:fs";
import Entry from "./models/Entry.js";
import Transcript from "./models/Transcript.js";
import Analysis from "./models/Analysis.js";
import Segment from "./models/Segment.js";
import { analyzeTranscript } from "./analyze.js";
import {
  ffmpegAvailable, compress, extractAudio, pixelDither, cartoonifyRetro,
  cartoonify, pixelArt, glitch, bw, vhs,
  extractFrames, extractPoster, getDuration, probe,
} from "./media.js";
import { whisperAvailable, transcribe } from "./transcribe.js";
import { MEDIA_DIR } from "./index.js";
import { uploadMedia, uploadImage, tmpPath, cleanupTmp } from "./cloudinary.js";

const log = (tag, ...args) => console.log(`[pipeline:${tag}]`, ...args);
const logErr = (tag, ...args) => console.error(`[pipeline:${tag}]`, ...args);

// Resolve local input file — also tries matching by filename if mediaPath is a Cloudinary URL
async function resolveInput(mediaPath) {
  if (!mediaPath) return null;
  if (mediaPath.startsWith("/media/")) {
    const name = path.basename(mediaPath);
    const local = path.join(MEDIA_DIR, name);
    if (fs.existsSync(local)) return { name, input: local, local: true };
    return null;
  }
  // Cloudinary URL — look for matching local file by timestamp prefix
  const match = mediaPath.match(/\/(\d{13}-[a-f0-9]+)/);
  if (match) {
    const localFiles = fs.readdirSync(MEDIA_DIR);
    const localFile = localFiles.find(f => f.startsWith(match[1]) && !f.includes(".min.") && !f.includes(".audio.") && !f.includes(".poster.") && !f.includes(".dither.") && !f.includes(".retro.") && !f.includes(".cartoon."));
    if (localFile) {
      return { name: localFile, input: path.join(MEDIA_DIR, localFile), local: true };
    }
  }
  return null;
}

// ── Step 1: Process everything locally (no Cloudinary) ──────────────────────
async function processLocally(entry, opts = {}) {
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

  // Decorative — user-selected or random pick 1-2
  const allEffects = ["dither", "retro", "pixel", "cartoon", "glitch", "bw", "vhs"];
  const picked = opts.effects?.length
    ? opts.effects.filter(e => allEffects.includes(e))
    : allEffects.sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
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

  if (picked.includes("pixel")) {
    try {
      const pixelOut = path.join(MEDIA_DIR, `${base}.pixel.mp4`);
      await pixelArt(src.input, pixelOut, { blocks: 96, up: 480, fps: 15, crf: 30 });
      artifacts.pixelPath = `/media/${base}.pixel.mp4`;
      log("local", `pixel → ${base}.pixel.mp4`);
    } catch (e) { logErr("local", "pixel failed:", e.message); }
  }

  if (picked.includes("cartoon")) {
    try {
      const cartoonOut = path.join(MEDIA_DIR, `${base}.cartoon.mp4`);
      await cartoonify(src.input, cartoonOut, { height: 480, fps: 24, crf: 30, preset: "fast" });
      artifacts.cartoonPath = `/media/${base}.cartoon.mp4`;
      log("local", `cartoon → ${base}.cartoon.mp4`);
    } catch (e) { logErr("local", "cartoon failed:", e.message); }
  }

  if (picked.includes("glitch")) {
    try {
      const glitchOut = path.join(MEDIA_DIR, `${base}.glitch.mp4`);
      await glitch(src.input, glitchOut, { height: 480, fps: 24, crf: 28, preset: "fast" });
      artifacts.glitchPath = `/media/${base}.glitch.mp4`;
      log("local", `glitch → ${base}.glitch.mp4`);
    } catch (e) { logErr("local", "glitch failed:", e.message); }
  }

  if (picked.includes("bw")) {
    try {
      const bwOut = path.join(MEDIA_DIR, `${base}.bw.mp4`);
      await bw(src.input, bwOut, { height: 480, fps: 24, crf: 28, preset: "fast" });
      artifacts.bwPath = `/media/${base}.bw.mp4`;
      log("local", `bw → ${base}.bw.mp4`);
    } catch (e) { logErr("local", "bw failed:", e.message); }
  }

  if (picked.includes("vhs")) {
    try {
      const vhsOut = path.join(MEDIA_DIR, `${base}.vhs.mp4`);
      await vhs(src.input, vhsOut, { height: 480, fps: 24, crf: 30, preset: "fast" });
      artifacts.vhsPath = `/media/${base}.vhs.mp4`;
      log("local", `vhs → ${base}.vhs.mp4`);
    } catch (e) { logErr("local", "vhs failed:", e.message); }
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
    pixelPath: { ext: ".pixel.mp4", type: "video" },
    cartoonPath: { ext: ".cartoon.mp4", type: "video" },
    glitchPath: { ext: ".glitch.mp4", type: "video" },
    bwPath: { ext: ".bw.mp4", type: "video" },
    vhsPath: { ext: ".vhs.mp4", type: "video" },
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
export async function runPipeline(entryId, transcriptText, clientFrames = [], opts = {}) {
  const { notify, effects, onComplete } = opts;
  const t0 = Date.now();
  const send = (msg) => { try { notify?.(msg); } catch {} };
  try {
    const entry = await Entry.findById(entryId);
    if (!entry) { logErr("main", `entry ${entryId} not found`); return; }

    log("main", `starting pipeline for ${entryId}`);

    let text = (transcriptText || "").trim();
    let segments = [];

    // ── Step 1: Process locally ──
    send("processing video...");
    const artifacts = await processLocally(entry, { effects });
    if (artifacts.durationSec) {
      await Entry.findByIdAndUpdate(entryId, { durationSec: artifacts.durationSec });
      entry.durationSec = artifacts.durationSec;
    }

    // ── Step 2: Transcribe + extract frames (parallel) ──
    await Entry.findByIdAndUpdate(entryId, { status: "transcribing" });
    send("transcribing...");
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
    send("analyzing with AI...");
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

    // ── Step 4: Upload everything to Cloudinary ──
    send("uploading to cloud...");
    const freshEntry = await Entry.findById(entryId);
    const updates = await uploadAll(freshEntry, artifacts);
    if (Object.keys(updates).length) {
      await Entry.findByIdAndUpdate(entryId, updates);
      log("main", `✓ uploaded ${Object.keys(updates).length} artifacts to Cloudinary`);
    }

    // ── Step 5: Mark ready (after upload so DB never has stale local paths) ──
    await Entry.findByIdAndUpdate(entryId, { status: "ready" });
    log("main", `✓ entry ready ${entryId} in ${Date.now() - t0}ms`);

    // ── Step 6: Send analysis summary back ──
    const mood = a.sentiment > 0.25 ? "😊" : a.sentiment < -0.25 ? "😔" : "😐";
    const summary = [
      `${mood} ${entry.title || "Untitled"}`,
      a.standing || a.summary || "",
      a.topics?.length ? `topics: ${a.topics.slice(0, 5).join(", ")}` : "",
      `duration: ${artifacts.durationSec || "?"}s`,
    ].filter(Boolean).join("\n");
    send(summary || "done!");

    // ── Step 7: Post to channel ──
    try { onComplete?.(entryId); } catch {}

    log("main", `✓ pipeline complete for ${entryId} in ${Date.now() - t0}ms`);
  } catch (err) {
    logErr("main", `entry ${entryId} failed:`, err.message);
    await Entry.findByIdAndUpdate(entryId, { status: "error" }).catch(() => {});
  }
}
