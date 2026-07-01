import path from "node:path";
import fs from "node:fs";
import Entry from "./models/Entry.js";
import Transcript from "./models/Transcript.js";
import Analysis from "./models/Analysis.js";
import Segment from "./models/Segment.js";
import { analyzeTranscript } from "./analyze.js";
import {
  ffmpegAvailable, compress, extractAudio,
  extractFrames, extractPoster, getDuration,
} from "./media.js";
import { EFFECTS, EFFECT_KEYS } from "./effects.js";
import { whisperAvailable, transcribe } from "./transcribe.js";
import { extractAudioFeatures, analyzeVoiceEmotion } from "./voiceAnalysis.js";
import { analyzeImage } from "./imageAnalysis.js";
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
  // Cloudinary URL — look for the raw local source by id. The original is
  // `<id>.<ext>` (single extension); every artifact/effect adds an infix
  // (`<id>.min.mp4`, `<id>.retro.mp4`, …), so match exactly one dot-segment.
  const match = mediaPath.match(/\/(\d{13}-[a-f0-9]+)/);
  if (match) {
    const localFiles = fs.readdirSync(MEDIA_DIR);
    const localFile = localFiles.find((f) => {
      const m = f.match(/^(\d{13}-[a-f0-9]+)\.[^.]+$/);
      return m && m[1] === match[1];
    });
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

  // Decorative effects. An explicit array (from the bot) is honored exactly —
  // including an empty array, which means "skip decorative effects". When no
  // array is given (web/livekit ingestion) we pick a random 1-2 surprise.
  const picked = Array.isArray(opts.effects)
    ? opts.effects.filter((e) => EFFECT_KEYS.includes(e))
    : [...EFFECT_KEYS].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2));
  log("local", `picked effects: ${picked.join(", ") || "(none)"}`);

  for (const key of picked) {
    const { fn, field, ext, opts: fxOpts } = EFFECTS[key];
    const out = path.join(MEDIA_DIR, `${base}${ext}`);
    try {
      await fn(src.input, out, fxOpts);
      artifacts[field] = `/media/${base}${ext}`;
      log("local", `${key} → ${base}${ext}`);
    } catch (e) { logErr("local", `${key} failed:`, e.message); }
  }

  return artifacts;
}

// ── Step 2: Upload all artifacts to Cloudinary ──────────────────────────────
async function uploadAll(entry, artifacts) {
  const updates = {};
  const base = entry.mediaPath?.match(/\/([^/]+)$/)?.[1]?.replace(/\.[^.]+$/, "");
  if (!base) return updates;

  // Always-produced artifacts + every effect output (from the registry).
  const fieldMap = {
    posterPath: { ext: ".poster.jpg", type: "image" },
    compressedPath: { ext: ".min.mp4", type: "video" },
    audioPath: { ext: ".audio.mp3", type: "video" },
  };
  for (const { field, ext, type } of Object.values(EFFECTS)) {
    fieldMap[field] = { ext, type };
  }

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

    // ── Step 2b: Audio features via ffmpeg ──
    let audioFeatures = null;
    const audioPath = artifacts.audioPath || entry.audioPath;
    if (audioPath) {
      const audioFile = audioPath.startsWith("/media/")
        ? path.join(MEDIA_DIR, path.basename(audioPath))
        : audioPath;
      if (fs.existsSync(audioFile)) {
        send("extracting audio features...");
        audioFeatures = extractAudioFeatures(audioFile);
        if (audioFeatures) log("voice", "audio features extracted:", JSON.stringify(audioFeatures));
      }
    }

    // ── Step 2c: Voice emotion analysis ──
    let voiceEmotion = null;
    if (text || audioFeatures) {
      send("analyzing voice emotion...");
      const audioFile = audioPath?.startsWith("/media/")
        ? path.join(MEDIA_DIR, path.basename(audioPath))
        : audioPath;
      voiceEmotion = await analyzeVoiceEmotion(text, audioFeatures, audioFile);
      if (voiceEmotion) log("voice", "emotion:", JSON.stringify(voiceEmotion));
    }

    // ── Step 2d: Image analysis via Gemini ──
    let imageAnalysis = null;
    if (frames?.length) {
      send("analyzing visuals...");
      imageAnalysis = await analyzeImage(frames);
      if (imageAnalysis) log("vision", "image analysis:", JSON.stringify(imageAnalysis));
    }

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
      audioFeatures,
      voiceEmotion,
      imageAnalysis,
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
        nextStep: a.nextStep || "", goalReflections: a.goalReflections || [],
        raw: a.raw,
        ...(audioFeatures && { audioFeatures }),
        ...(voiceEmotion && { voiceEmotion }),
        ...(imageAnalysis && { imageAnalysis }),
      },
      { upsert: true }
    );
    // Link the entry to the goals this analysis touched.
    await Entry.findByIdAndUpdate(entryId, { goals: a.linkedGoalIds || [] });
    log("analyze", `saved analysis (sentiment=${a.sentiment}, ${a.topics?.length || 0} topics, ${a.linkedGoalIds?.length || 0} goals)`);

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
