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
import { uploadMedia, uploadImage, deleteMedia } from "../cloudinary.js";

const router = Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".webm";
    cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024, fieldSize: 25 * 1024 * 1024 },
});

function parseFrames(raw) {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((f) => typeof f === "string") : [];
  } catch { return []; }
}

// Derive a Cloudinary public_id from the local filename
function pubId(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

// GET /api/entries
router.get("/", wrap(async (_req, res) => {
  const entries = await Entry.find().sort({ recordedAt: -1 }).populate("analysis").lean({ virtuals: true });
  res.json(entries);
}));

// GET /api/entries/:id
router.get("/:id", wrap(async (req, res) => {
  const entry = await Entry.findById(req.params.id)
    .populate("transcript").populate("analysis")
    .populate({ path: "segments", options: { sort: { startSec: 1 } } })
    .lean({ virtuals: true });
  if (!entry) return res.status(404).json({ error: "Entry not found" });
  res.json(entry);
}));

// POST /api/entries/upload
router.post("/upload", upload.single("media"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No media file" });
  const { source = "upload", title, recordedAt, durationSec, transcript } = req.body;
  const frames = parseFrames(req.body.frames);

  // Upload original to Cloudinary
  const localFile = path.join(MEDIA_DIR, req.file.filename);
  let mediaUrl;
  try {
    mediaUrl = await uploadMedia(localFile, pubId(req.file.filename));
  } catch (e) {
    console.error("[cloudinary] upload failed:", e.message);
    mediaUrl = `/media/${req.file.filename}`; // fallback to local
  }

  // Poster from first client frame
  let posterUrl;
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(frames[0] || "");
  if (m) {
    const posterFile = path.join(MEDIA_DIR, `${req.file.filename}.poster.jpg`);
    fs.writeFileSync(posterFile, Buffer.from(m[1], "base64"));
    try {
      posterUrl = await uploadImage(posterFile, `${pubId(req.file.filename)}.poster`);
    } catch {
      posterUrl = `/media/${req.file.filename}.poster.jpg`;
    }
  }

  const entry = await Entry.create({
    recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
    source, title,
    mediaPath: mediaUrl,
    posterPath: posterUrl,
    durationSec: durationSec ? Math.round(Number(durationSec)) : undefined,
    status: "ingested",
  });

  runPipeline(entry._id, transcript, frames);
  res.status(201).json(entry);
}));

// POST /api/entries/:id/re-edit
router.post("/:id/re-edit", upload.single("media"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No media file" });
  const entry = await Entry.findById(req.params.id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  // Delete old Cloudinary assets
  for (const key of ["compressedPath", "cartoonPath", "audioPath", "ditherPath", "posterPath"]) {
    if (entry[key] && !entry[key].startsWith("/media/")) {
      const id = entry[key].split("/").pop().replace(/\.[^.]+$/, "");
      await deleteMedia(id).catch(() => {});
    }
  }

  // Upload new original
  const localFile = path.join(MEDIA_DIR, req.file.filename);
  let mediaUrl;
  try {
    mediaUrl = await uploadMedia(localFile, pubId(req.file.filename));
  } catch {
    mediaUrl = `/media/${req.file.filename}`;
  }

  let posterUrl;
  const frames = parseFrames(req.body.frames);
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(frames[0] || "");
  if (m) {
    const posterFile = path.join(MEDIA_DIR, `${req.file.filename}.poster.jpg`);
    fs.writeFileSync(posterFile, Buffer.from(m[1], "base64"));
    try { posterUrl = await uploadImage(posterFile, `${pubId(req.file.filename)}.poster`); }
    catch { posterUrl = `/media/${req.file.filename}.poster.jpg`; }
  }

  await Promise.all([
    Transcript.deleteMany({ entry: entry._id }),
    Segment.deleteMany({ entry: entry._id }),
    Analysis.deleteMany({ entry: entry._id }),
  ]);

  const updates = { mediaPath: mediaUrl, status: "ingested" };
  if (posterUrl) updates.posterPath = posterUrl;
  if (req.body.title) updates.title = req.body.title;
  if (req.body.durationSec) updates.durationSec = Math.round(Number(req.body.durationSec));

  const updated = await Entry.findByIdAndUpdate(entry._id, updates, { new: true });
  runPipeline(updated._id, req.body.transcript || "", frames);
  res.json(updated);
}));

// POST /api/entries/:id/analyze
router.post("/:id/analyze", wrap(async (req, res) => {
  const entry = await Entry.findById(req.params.id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });
  const existing = await Transcript.findOne({ entry: entry._id });
  const text = req.body?.transcript || existing?.fullText || "";
  runPipeline(entry._id, text);
  res.status(202).json({ status: "analyzing" });
}));

// POST /api/entries
router.post("/", wrap(async (req, res) => {
  const { recordedAt, source, title, mediaPath, durationSec } = req.body;
  const entry = await Entry.create({
    recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
    source, title, mediaPath, durationSec,
  });
  res.status(201).json(entry);
}));

// PATCH /api/entries/:id
router.patch("/:id", wrap(async (req, res) => {
  const entry = await Entry.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!entry) return res.status(404).json({ error: "Entry not found" });
  res.json(entry);
}));

// DELETE /api/entries/:id
router.delete("/:id", wrap(async (req, res) => {
  const entry = await Entry.findByIdAndDelete(req.params.id);
  if (!entry) return res.status(404).json({ error: "Entry not found" });
  await Promise.all([
    Transcript.deleteOne({ entry: entry._id }),
    Segment.deleteMany({ entry: entry._id }),
    Analysis.deleteOne({ entry: entry._id }),
  ]);
  // Delete Cloudinary assets
  for (const p of [entry.mediaPath, entry.posterPath, entry.compressedPath, entry.cartoonPath, entry.audioPath, entry.ditherPath]) {
    if (p && !p.startsWith("/media/")) {
      const id = p.split("/").pop().replace(/\.[^.]+$/, "");
      await deleteMedia(id).catch(() => {});
    }
  }
  // Also clean up any leftover local files
  if (entry.mediaPath?.startsWith("/media/")) {
    const base = path.basename(entry.mediaPath);
    for (const ext of ["", ".poster.jpg", ".min.mp4", ".audio.mp3", ".cartoon.mp4", ".dither.webp"]) {
      fs.rm(path.join(MEDIA_DIR, base + ext), { force: true }, () => {});
    }
  }
  res.status(204).end();
}));

export default router;
