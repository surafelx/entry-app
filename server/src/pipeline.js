import path from "node:path";
import Entry from "./models/Entry.js";
import Transcript from "./models/Transcript.js";
import Analysis from "./models/Analysis.js";
import Segment from "./models/Segment.js";
import { analyzeTranscript } from "./analyze.js";
import {
  ffmpegAvailable, compress, extractAudio, pixelDither, cartoonify,
  extractFrames, extractPoster, getDuration, probe,
} from "./media.js";
import { whisperAvailable, transcribe } from "./transcribe.js";
import { MEDIA_DIR } from "./index.js";

const log = (tag, ...args) => console.log(`[pipeline:${tag}]`, ...args);
const logErr = (tag, ...args) => console.error(`[pipeline:${tag}]`, ...args);

// Resolve the on-disk paths/helpers for an entry's media, or null if none.
function mediaCtx(entry) {
  if (!entry.mediaPath?.startsWith("/media/")) return null;
  const name = path.basename(entry.mediaPath);
  return {
    name,
    input: path.join(MEDIA_DIR, name),
    out: (suffix) => path.join(MEDIA_DIR, `${name}.${suffix}`),
    url: (suffix) => `/media/${name}.${suffix}`,
  };
}

// ── Essential media — what playback/analysis actually need. On critical path. ─
// Kept lean (just compress + audio) so it doesn't starve whisper of CPU.
async function processEssentialMedia(entry) {
  const ctx = mediaCtx(entry);
  if (!ctx) return;
  if (!(await ffmpegAvailable())) { log("media", "ffmpeg not available, skipping"); return; }
  const { name, input, out, url } = ctx;

  const results = await Promise.allSettled([
    compress(input, out("min.mp4"), { height: 360, fps: 24, crf: 34, preset: "veryfast" })
      .then(() => log("media", `compressed → ${name}.min.mp4`)),
    extractAudio(input, out("audio.mp3"), { bitrate: "64k", mono: true })
      .then(() => log("media", `audio → ${name}.audio.mp3`)),
  ]);

  const set = {};
  if (results[0].status === "fulfilled") set.compressedPath = url("min.mp4");
  else logErr("media", "compress failed:", results[0].reason?.message);
  if (results[1].status === "fulfilled") set.audioPath = url("audio.mp3");
  else logErr("media", "extractAudio failed:", results[1].reason?.message);

  if (Object.keys(set).length) await Entry.findByIdAndUpdate(entry._id, set);
}

// ── Decorative media — dither + cartoon previews. Run AFTER the entry is ─────
// `ready` so the heavy ffmpeg passes never compete with whisper/analysis.
async function processDecorativeMedia(entry) {
  const ctx = mediaCtx(entry);
  if (!ctx) return;
  if (!(await ffmpegAvailable())) return;
  const { name, input, out, url } = ctx;

  const results = await Promise.allSettled([
    pixelDither(input, out("dither.webp"), {
      width: 200, up: 480, fps: 12, colors: 24, bayer: 4, quality: 65,
    }).then(() => log("media", `dither → ${name}.dither.webp`)),
    cartoonify(input, out("cartoon.mp4"), { height: 360, fps: 24, crf: 28, preset: "fast" })
      .then(() => log("media", `cartoon → ${name}.cartoon.mp4`)),
  ]);

  const set = {};
  if (results[0].status === "fulfilled") set.ditherPath = url("dither.webp");
  else logErr("media", "pixelDither failed:", results[0].reason?.message);
  if (results[1].status === "fulfilled") set.cartoonPath = url("cartoon.mp4");
  else logErr("media", "cartoonify failed:", results[1].reason?.message);

  if (Object.keys(set).length) await Entry.findByIdAndUpdate(entry._id, set);
}

// ── Extract server-side frames for visual analysis ──────────────────────────
async function getVisualFrames(entry, clientFrames = []) {
  // Prefer client-provided frames (higher quality, captured at recording time)
  if (clientFrames.length > 0) return clientFrames;

  if (!entry.mediaPath?.startsWith("/media/")) return [];
  if (!(await ffmpegAvailable())) return [];

  const name = path.basename(entry.mediaPath);
  const input = path.join(MEDIA_DIR, name);

  try {
    const frames = await extractFrames(input, { count: 4, width: 512 });
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
    if (!entry.durationSec && entry.mediaPath?.startsWith("/media/") && (await ffmpegAvailable())) {
      try {
        const name = path.basename(entry.mediaPath);
        const dur = await getDuration(path.join(MEDIA_DIR, name));
        await Entry.findByIdAndUpdate(entryId, { durationSec: Math.round(dur) });
        entry.durationSec = Math.round(dur);
        log("main", `detected duration: ${entry.durationSec}s`);
      } catch (e) {
        logErr("main", "duration detection failed:", e.message);
      }
    }

    // ── Step 0b: Extract poster if missing ──
    if (!entry.posterPath && entry.mediaPath?.startsWith("/media/") && (await ffmpegAvailable())) {
      try {
        const name = path.basename(entry.mediaPath);
        const posterName = `${name}.poster.jpg`;
        await extractPoster(path.join(MEDIA_DIR, name), path.join(MEDIA_DIR, posterName));
        await Entry.findByIdAndUpdate(entryId, { posterPath: `/media/${posterName}` });
        log("main", `extracted poster → ${posterName}`);
      } catch (e) {
        logErr("main", "poster extraction failed:", e.message);
      }
    }

    // ── Step 1 + Media: Run whisper transcription and media processing in parallel ──
    await Entry.findByIdAndUpdate(entryId, { status: "transcribing" });

    const mediaFile =
      entry.mediaPath?.startsWith("/media/") &&
      path.join(MEDIA_DIR, path.basename(entry.mediaPath));

    const whisperTask = (async () => {
      if (mediaFile && (await whisperAvailable())) {
        try {
          const r = await transcribe(mediaFile);
          if (r?.text) {
            text = r.text;
            segments = r.segments || [];
            log("transcribe", `got ${segments.length} segments, ${text.length} chars`);
          }
        } catch (e) {
          logErr("transcribe", "whisper failed:", e.message);
        }
      }
      // Save transcript
      if (text) {
        await Transcript.findOneAndUpdate(
          { entry: entryId },
          { entry: entryId, fullText: text, language: "en" },
          { upsert: true }
        );
      }
      // Replace segments with time-aligned ones from whisper
      await Segment.deleteMany({ entry: entryId });
      if (segments.length) {
        await Segment.insertMany(
          segments.map((s) => ({ entry: entryId, startSec: s.startSec, endSec: s.endSec, text: s.text }))
        );
        log("transcribe", `saved ${segments.length} segments to DB`);
      }
    })();

    const mediaTask = processEssentialMedia(entry);

    // Wait for both to finish
    await Promise.all([whisperTask, mediaTask]);

    // ── Step 2: Extract visual frames for analysis ──
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

    // Normalize lifeSections — some models return "description" instead of "summary"
    const lifeSections = (a.lifeSections || []).map((s) => ({
      domain: s.domain,
      status: s.status,
      summary: s.summary || s.description || "",
    }));

    await Analysis.findOneAndUpdate(
      { entry: entryId },
      {
        entry: entryId,
        summary: a.summary,
        sentiment: a.sentiment,
        trajectory: a.trajectory,
        energy: a.energy,
        emotions: a.emotions,
        topics: a.topics,
        ideas: a.ideas,
        identity: a.identity,
        quotes: a.quotes,
        followUps: a.followUps,
        lifeSections,
        standing: a.standing,
        visual: a.visual,
        patterns: a.patterns || [],
        growth: a.growth || "",
        raw: a.raw,
      },
      { upsert: true }
    );
    log("analyze", `saved analysis (sentiment=${a.sentiment}, ${a.topics?.length || 0} topics)`);

    // ── Step 4: Ready — the entry is now playable and analyzed ──
    await Entry.findByIdAndUpdate(entryId, { status: "ready" });
    log("main", `✓ entry ready ${entryId} in ${Date.now() - t0}ms`);

    // ── Step 5: Decorative previews (dither/cartoon) — after ready, off the ──
    // critical path so they never steal CPU from whisper/analysis.
    await processDecorativeMedia(entry).catch((e) =>
      logErr("media", "decorative media failed:", e.message)
    );
    log("main", `✓ pipeline complete for ${entryId} in ${Date.now() - t0}ms`);
  } catch (err) {
    logErr("main", `entry ${entryId} failed:`, err.message);
    await Entry.findByIdAndUpdate(entryId, { status: "error" }).catch(() => {});
  }
}
