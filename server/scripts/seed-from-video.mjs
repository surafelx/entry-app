// Seed an Entry from a local video file: compress + poster + dither + audio,
// then analyze. Usage: node scripts/seed-from-video.mjs <video> [seconds]
import "dotenv/config";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "../src/db.js";
import Entry from "../src/models/Entry.js";
import Transcript from "../src/models/Transcript.js";
import Segment from "../src/models/Segment.js";
import Analysis from "../src/models/Analysis.js";
import { compress, extractAudio, pixelDither } from "../src/media.js";
import { analyzeTranscript } from "../src/analyze.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = path.join(__dirname, "..", "media");
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/entry_app";

const input = process.argv[2];
const seconds = Number(process.argv[3] || 30);
if (!input) { console.error("need a video path"); process.exit(1); }

const ff = (args) =>
  new Promise((res, rej) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let e = ""; p.stderr.on("data", (d) => (e += d));
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(e))));
  });

// Placeholder transcript (no STT engine installed). Flagged in Analysis.raw.
const TRANSCRIPT =
  "Alright, first real cut up here on the roof. The city looks unreal from this " +
  "angle. I've been heads-down on the project for weeks and honestly it's starting " +
  "to come together. I'm tired but it's a good kind of tired. I keep thinking I " +
  "should reach out to people more, I've been isolated. Idea: I want to turn these " +
  "check-ins into something I actually look back on.";

async function main() {
  await connectDB(MONGODB_URI);
  const tag = `seed-${Date.now()}`;
  const out = (s) => path.join(MEDIA_DIR, `${tag}.${s}`);
  const url = (s) => `/media/${tag}.${s}`;

  console.log(`[seed] compressing first ${seconds}s → 720p…`);
  await compress(input, out("mp4"), { height: 720, fps: 30, crf: 28, seconds });

  console.log("[seed] poster + dither + audio…");
  await ff(["-ss", "3", "-i", input, "-frames:v", "1", "-vf", "scale=-2:720", out("poster.jpg")]);
  await pixelDither(input, out("dither.webp"), { seconds: 5, width: 200, up: 480, fps: 12, colors: 24 });
  await extractAudio(input, out("audio.mp3"), { seconds, bitrate: "64k", mono: true });

  console.log("[seed] analyzing…");
  const recordedAt = new Date();
  const a = await analyzeTranscript(TRANSCRIPT, { source: "upload", title: "First cut", recordedAt });

  const entry = await Entry.create({
    recordedAt,
    source: "upload",
    title: "First cut",
    status: "ready",
    mediaPath: url("mp4"),
    posterPath: url("poster.jpg"),
    ditherPath: url("dither.webp"),
    audioPath: url("audio.mp3"),
    durationSec: seconds,
  });

  await Transcript.create({ entry: entry._id, fullText: TRANSCRIPT, language: "en" });

  // Split the transcript into even time-sliced "pages" for paginated reading.
  const sentences = TRANSCRIPT.split(/(?<=[.!?])\s+/).filter(Boolean);
  const slice = seconds / sentences.length;
  await Segment.insertMany(
    sentences.map((text, i) => ({
      entry: entry._id,
      startSec: +(i * slice).toFixed(2),
      endSec: +((i + 1) * slice).toFixed(2),
      text,
    }))
  );

  await Analysis.create({
    entry: entry._id,
    summary: a.summary, sentiment: a.sentiment, trajectory: a.trajectory, energy: a.energy,
    emotions: a.emotions, topics: a.topics, ideas: a.ideas, identity: a.identity,
    quotes: a.quotes, followUps: a.followUps, lifeSections: a.lifeSections,
    standing: a.standing, visual: a.visual, raw: { ...a, _seededTranscript: true },
  });

  console.log(`[seed] done → entry ${entry._id} (${entry.title})`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
