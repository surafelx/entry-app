import "dotenv/config";
import { connectDB } from "./db.js";
import mongoose from "mongoose";
import Entry from "./models/Entry.js";
import Transcript from "./models/Transcript.js";
import Segment from "./models/Segment.js";
import Analysis from "./models/Analysis.js";

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/entry_app";

async function run() {
  await connectDB(MONGODB_URI);

  await Promise.all([
    Entry.deleteMany({}),
    Transcript.deleteMany({}),
    Segment.deleteMany({}),
    Analysis.deleteMany({}),
  ]);

  const entry = await Entry.create({
    recordedAt: new Date("2026-06-28T09:15:00Z"),
    source: "checkin",
    title: "Morning check-in",
    status: "ready",
    mediaPath: "/media/2026-06-28-morning.mp4",
    durationSec: 142,
  });

  await Transcript.create({
    entry: entry._id,
    fullText:
      "Feeling good today. Shipped the new ingest pipeline and it just worked.",
    language: "en",
  });

  await Segment.insertMany([
    { entry: entry._id, startSec: 0, endSec: 4.2, text: "Feeling good today." },
    {
      entry: entry._id,
      startSec: 4.2,
      endSec: 9.8,
      text: "Shipped the new ingest pipeline and it just worked.",
    },
  ]);

  await Analysis.create({
    entry: entry._id,
    summary: "Upbeat morning check-in after a successful ship.",
    sentiment: 0.8,
    trajectory: "rising",
    energy: "high",
    emotions: ["pride", "relief"],
    topics: ["work", "shipping"],
    ideas: [{ text: "Automate the ingest QA step", novelty: 0.6 }],
    identity: ["builder", "ships things"],
    quotes: ["it just worked"],
    followUps: ["Write up the pipeline for the team"],
    raw: { note: "seed data" },
  });

  console.log("[seed] created 1 entry with transcript, 2 segments, analysis");
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
