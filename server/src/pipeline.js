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
import { uploadMedia, uploadImage, tmpPath, writeTmp, cleanupTmp } from "./cloudinary.js";

const log = (tag, ...args) => console.log(`[pipeline:${tag}]`, ...args);
const logErr = (tag, ...args) => console.error(`[pipeline:${tag}]`, ...args);

// Download a file from a URL to a local path
async function download(url, localPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(localPath, buf);
  return localPath;
}

// Derive a Cloudinary public_id from a URL or filename
function pubIdFromUrl(url) {
  // e.g. https://res.cloudinary.com/.../visualspam/abc123.min.mp4 → abc123
  const parts = url.split("/");
  const file = parts[parts.length - 1];
  return file.replace(/\.[^.]+$/, "");
}

function pubIdFromFilename(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

// Resolve local input file — downloads from Cloudinary if needed
async function resolveInput(mediaPath) {
  if (!mediaPath) return null;

  if (mediaPath.startsWith("/media/")) {
    // Local file
    const name = path.basename(mediaPath);
    const local = path.join(MEDIA_DIR, name);
    if (fs.existsSync(local)) return { name, input: local, local: true };
    return null;
  }

  if (mediaPath.startsWith("http")) {
    // Cloudinary URL — download to /tmp
    const name = pubIdFromUrl(mediaPath).replace(/\//g, "_");
    const ext = mediaPath.match(/\.(\w+)(\?.*)?$/)?.[1] || "mp4";
    const localName = `${name}.${ext}`;
    const local = tmpPath(localName);
    if (fs.existsSync(local)) return { name: localName, input: local, local: false };
    try {
      await download(mediaPath, local);
      log("download", `fetched ${mediaPath} → ${localName}`);
      return { name: localName, input: local, local: false };
    } catch (e) {
      logErr("download", `failed to fetch ${mediaPath}:`, e.message);
      return null;
    }
  }

  return null;
}

// Upload a local file to Cloudinary and return the URL
async function uploadDerived(localPath, publicId, resourceType = "video") {
  try {
    if (resourceType === "image") return await uploadImage(localPath, publicId);
    return await uploadMedia(localPath, publicId);
  } catch (e) {
    logErr("upload", `failed to upload ${publicId}:`, e.message);
    return null;
  }
}

// ── Essential media — compress + audio ──────────────────────────────────────
async function processEssentialMedia(entry) {
  if (!(await ffmpegAvailable())) { log("media", "ffmpeg not available, skipping"); return; }

  const src = await resolveInput(entry.mediaPath);
  if (!src) return;

  const base = src.name.replace(/\.[^.]+$/, "");
  const minOut = tmpPath(`${base}.min.mp4`);
  const audioOut = tmpPath(`${base}.audio.mp3`);

  const results = await Promise.allSettled([
    compress(src.input, minOut, { height: 360, fps: 24, crf: 34, preset: "veryfast" })
      .then(() => log("media", `compressed → ${base}.min.mp4`)),
    extractAudio(src.input, audioOut, { bitrate: "64k", mono: true })
      .then(() => log("media", `audio → ${base}.audio.mp3`)),
  ]);

  const set = {};
  if (results[0].status === "fulfilled") {
    const url = await uploadDerived(minOut, `${base}.min`);
    if (url) set.compressedPath = url;
  } else logErr("media", "compress failed:", results[0].reason?.message);

  if (results[1].status === "fulfilled") {
    const url = await uploadDerived(audioOut, `${base}.audio`);
    if (url) set.audioPath = url;
  } else logErr("media", "extractAudio failed:", results[1].reason?.message);

  cleanupTmp(`${base}.min.mp4`);
  cleanupTmp(`${base}.audio.mp3`);

  if (Object.keys(set).length) await Entry.findByIdAndUpdate(entry._id, set);
}

// ── Decorative media — dither + cartoon ─────────────────────────────────────
async function processDecorativeMedia(entry) {
  if (!(await ffmpegAvailable())) return;

  const src = await resolveInput(entry.mediaPath);
  if (!src) return;

  const base = src.name.replace(/\.[^.]+$/, "");
  const ditherOut = tmpPath(`${base}.dither.webp`);
  const cartoonOut = tmpPath(`${base}.cartoon.mp4`);

  const results = await Promise.allSettled([
    pixelDither(src.input, ditherOut, {
      width: 200, up: 480, fps: 12, colors: 24, bayer: 4, quality: 65,
    }).then(() => log("media", `dither → ${base}.dither.webp`)),
    cartoonifyRetro(src.input, cartoonOut, { height: 360, fps: 24, crf: 28, preset: "fast" })
      .then(() => log("media", `retro cartoon → ${base}.cartoon.mp4`)),
  ]);

  const set = {};
  if (results[0].status === "fulfilled") {
    const url = await uploadDerived(ditherOut, `${base}.dither`);
    if (url) set.ditherPath = url;
  } else logErr("media", "pixelDither failed:", results[0].reason?.message);

  if (results[1].status === "fulfilled") {
    const url = await uploadDerived(cartoonOut, `${base}.cartoon`);
    if (url) set.cartoonPath = url;
  } else logErr("media", "cartoonify failed:", results[1].reason?.message);

  cleanupTmp(`${base}.dither.webp`);
  cleanupTmp(`${base}.cartoon.mp4`);

  if (Object.keys(set).length) await Entry.findByIdAndUpdate(entry._id, set);
}

// ── Extract visual frames ───────────────────────────────────────────────────
async function getVisualFrames(entry, clientFrames = []) {
  if (clientFrames.length > 0) return clientFrames;
  if (!(await ffmpegAvailable())) return [];

  const src = await resolveInput(entry.mediaPath);
  if (!src) return [];

  try {
    const frames = await extractFrames(src.input, { count: 4, width: 512 });
    if (frames.length) log("frames", `extracted ${frames.length} frames from video`);
    return frames.map((f) => `data:${f.mimeType};base64,${f.base64}`);
  } catch (e) {
    logErr("frames", "frame extraction failed:", e.message);
    return [];
  }
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

    // ── Step 0: Auto-detect duration if missing ──
    if (!entry.durationSec && (await ffmpegAvailable())) {
      const src = await resolveInput(entry.mediaPath);
      if (src) {
        try {
          const dur = await getDuration(src.input);
          await Entry.findByIdAndUpdate(entryId, { durationSec: Math.round(dur) });
          entry.durationSec = Math.round(dur);
          log("main", `detected duration: ${entry.durationSec}s`);
        } catch (e) {
          logErr("main", "duration detection failed:", e.message);
        }
      }
    }

    // ── Step 0b: Extract poster if missing ──
    if (!entry.posterPath && (await ffmpegAvailable())) {
      const src = await resolveInput(entry.mediaPath);
      if (src) {
        try {
          const base = src.name.replace(/\.[^.]+$/, "");
          const posterLocal = tmpPath(`${base}.poster.jpg`);
          await extractPoster(src.input, posterLocal);
          const posterUrl = await uploadDerived(posterLocal, `${base}.poster`, "image");
          if (posterUrl) {
            await Entry.findByIdAndUpdate(entryId, { posterPath: posterUrl });
            log("main", `extracted poster → Cloudinary`);
          }
          cleanupTmp(`${base}.poster.jpg`);
        } catch (e) {
          logErr("main", "poster extraction failed:", e.message);
        }
      }
    }

    // ── Step 1: Whisper + Media in parallel ──
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
        } catch (e) {
          logErr("transcribe", "whisper failed:", e.message);
        }
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
        log("transcribe", `saved ${segments.length} segments to DB`);
      }
    })();

    const mediaTask = processEssentialMedia(entry);
    await Promise.all([whisperTask, mediaTask]);

    // ── Step 2: Visual frames ──
    const frames = await getVisualFrames(entry, clientFrames);

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

    // ── Step 4: Ready ──
    await Entry.findByIdAndUpdate(entryId, { status: "ready" });
    log("main", `✓ entry ready ${entryId} in ${Date.now() - t0}ms`);

    // ── Step 5: Decorative (after ready) ──
    await processDecorativeMedia(entry).catch((e) =>
      logErr("media", "decorative media failed:", e.message)
    );
    log("main", `✓ pipeline complete for ${entryId} in ${Date.now() - t0}ms`);
  } catch (err) {
    logErr("main", `entry ${entryId} failed:`, err.message);
    await Entry.findByIdAndUpdate(entryId, { status: "error" }).catch(() => {});
  }
}
