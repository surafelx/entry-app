import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import Entry from "../models/Entry.js";
import Transcript from "../models/Transcript.js";
import Segment from "../models/Segment.js";
import Analysis from "../models/Analysis.js";
import { MEDIA_DIR } from "../index.js";
import { runPipeline } from "../pipeline.js";

const router = Router();

// Wrap async handlers so thrown/rejected errors reach the error middleware.
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Disk storage for recorded/uploaded clips.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  // fieldSize is bumped so base64 video frames fit in a text field.
  limits: { fileSize: 200 * 1024 * 1024, fieldSize: 25 * 1024 * 1024 },
});

// Parse the `frames` field (JSON array of data-URLs) defensively.
function parseFrames(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((f) => typeof f === "string") : [];
  } catch {
    return [];
  }
}

// GET /api/entries — list, newest moment first
router.get(
  "/",
  wrap(async (req, res) => {
    const entries = await Entry.find()
      .sort({ recordedAt: -1 })
      .populate("analysis")
      .lean({ virtuals: true });
    res.json(entries);
  })
);

// GET /api/entries/:id — full entry with relations
router.get(
  "/:id",
  wrap(async (req, res) => {
    const entry = await Entry.findById(req.params.id)
      .populate("transcript")
      .populate("analysis")
      .populate({ path: "segments", options: { sort: { startSec: 1 } } })
      .lean({ virtuals: true });
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    res.json(entry);
  })
);

// POST /api/entries/upload — receive a recorded/uploaded clip (multipart)
router.post(
  "/upload",
  upload.single("media"),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No media file" });
    const { source = "upload", title, recordedAt, durationSec, transcript } = req.body;
    const frames = parseFrames(req.body.frames);

    // Persist the first frame as a poster thumbnail so cards aren't black.
    let posterPath;
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(frames[0] || "");
    if (m) {
      const posterName = `${req.file.filename}.poster.jpg`;
      fs.writeFileSync(path.join(MEDIA_DIR, posterName), Buffer.from(m[1], "base64"));
      posterPath = `/media/${posterName}`;
    }

    const entry = await Entry.create({
      recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
      source,
      title,
      mediaPath: `/media/${req.file.filename}`,
      posterPath,
      durationSec: durationSec ? Math.round(Number(durationSec)) : undefined,
      status: "ingested",
    });
    // Kick off transcribe → analyze (incl. visual frames) in the background.
    runPipeline(entry._id, transcript, frames);
    res.status(201).json(entry);
  })
);

// POST /api/entries/:id/re-edit — replace media with an edited version, re-run pipeline
router.post(
  "/:id/re-edit",
  upload.single("media"),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No media file" });

    const entry = await Entry.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    // Clean up old derived media artifacts
    for (const key of ["compressedPath", "cartoonPath", "audioPath", "ditherPath", "posterPath"]) {
      if (entry[key]?.startsWith("/media/")) {
        fs.rm(path.join(MEDIA_DIR, path.basename(entry[key])), { force: true }, () => {});
      }
    }

    // Persist new poster from frames if provided
    let posterPath;
    const frames = parseFrames(req.body.frames);
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(frames[0] || "");
    if (m) {
      const posterName = `${req.file.filename}.poster.jpg`;
      fs.writeFileSync(path.join(MEDIA_DIR, posterName), Buffer.from(m[1], "base64"));
      posterPath = `/media/${posterName}`;
    }

    // Delete old transcript, segments, analysis
    await Promise.all([
      Transcript.deleteMany({ entry: entry._id }),
      Segment.deleteMany({ entry: entry._id }),
      Analysis.deleteMany({ entry: entry._id }),
    ]);

    // Update entry with new media
    const updates = {
      mediaPath: `/media/${req.file.filename}`,
      status: "ingested",
    };
    if (posterPath) updates.posterPath = posterPath;
    if (req.body.title) updates.title = req.body.title;
    if (req.body.durationSec) updates.durationSec = Math.round(Number(req.body.durationSec));

    const updated = await Entry.findByIdAndUpdate(entry._id, updates, { new: true });

    // Re-run the full pipeline
    const transcript = req.body.transcript || "";
    runPipeline(updated._id, transcript, frames);

    res.json(updated);
  })
);

// POST /api/entries/:id/analyze — (re)run the analysis pipeline
router.post(
  "/:id/analyze",
  wrap(async (req, res) => {
    const entry = await Entry.findById(req.params.id);
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    const existing = await Transcript.findOne({ entry: entry._id });
    const text = req.body?.transcript || existing?.fullText || "";
    runPipeline(entry._id, text);
    res.status(202).json({ status: "analyzing" });
  })
);

// POST /api/entries — create a new entry
router.post(
  "/",
  wrap(async (req, res) => {
    const { recordedAt, source, title, mediaPath, durationSec } = req.body;
    const entry = await Entry.create({
      recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
      source,
      title,
      mediaPath,
      durationSec,
    });
    res.status(201).json(entry);
  })
);

// PATCH /api/entries/:id — update fields (e.g. advance status)
router.patch(
  "/:id",
  wrap(async (req, res) => {
    const entry = await Entry.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    res.json(entry);
  })
);

// DELETE /api/entries/:id — remove entry and its related docs
router.delete(
  "/:id",
  wrap(async (req, res) => {
    const entry = await Entry.findByIdAndDelete(req.params.id);
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    await Promise.all([
      Transcript.deleteOne({ entry: entry._id }),
      Segment.deleteMany({ entry: entry._id }),
      Analysis.deleteOne({ entry: entry._id }),
    ]);
    // Remove all backing files (raw, poster, compressed, cartoon, audio, dither).
    for (const p of [
      entry.mediaPath,
      entry.posterPath,
      entry.compressedPath,
      entry.cartoonPath,
      entry.audioPath,
      entry.ditherPath,
    ]) {
      if (p?.startsWith("/media/")) {
        fs.rm(path.join(MEDIA_DIR, path.basename(p)), { force: true }, () => {});
      }
    }
    res.status(204).end();
  })
);

export default router;
