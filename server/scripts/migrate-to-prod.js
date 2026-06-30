// Migration script: uploads local media to Cloudinary and copies all data to production MongoDB.
// Usage: node scripts/migrate-to-prod.js

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";

// ── Config ──────────────────────────────────────────────────────────────────
const LOCAL_URI = "mongodb://127.0.0.1:27017/entry_app";
const PROD_URI = process.env.MONGODB_URI;
const MEDIA_DIR = path.join(import.meta.dirname, "..", "media");
const FOLDER = "visualspam";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const log = (...a) => console.log("[migrate]", ...a);

// ── Schemas (inline to avoid circular imports) ──────────────────────────────
const entrySchema = new mongoose.Schema({}, { strict: false, timestamps: { createdAt: "createdAt" } });
const transcriptSchema = new mongoose.Schema({}, { strict: false });
const segmentSchema = new mongoose.Schema({}, { strict: false });
const analysisSchema = new mongoose.Schema({}, { strict: false });
const noteSchema = new mongoose.Schema({}, { strict: false });

// ── Helpers ─────────────────────────────────────────────────────────────────
async function uploadToCloudinary(localPath, publicId, resourceType = "video") {
  try {
    const res = await cloudinary.uploader.upload(localPath, {
      resource_type: resourceType,
      folder: FOLDER,
      public_id: publicId,
      overwrite: true,
    });
    return res.secure_url;
  } catch (e) {
    log(`  upload failed ${publicId}: ${e.message}`);
    return null;
  }
}

// Upload a media file referenced by a path like "/media/filename.ext" or Cloudinary URL
async function uploadMediaRef(mediaPath) {
  if (!mediaPath) return null;
  if (mediaPath.startsWith("http")) return mediaPath; // already on Cloudinary

  const filename = path.basename(mediaPath);
  const local = path.join(MEDIA_DIR, filename);
  if (!fs.existsSync(local)) {
    log(`  local file not found: ${local}`);
    return null;
  }

  const publicId = filename.replace(/\.[^.]+$/, "");
  const resourceType = filename.match(/\.(jpg|jpeg|png|webp|gif)$/i) ? "image" : "video";
  const url = await uploadToCloudinary(local, publicId, resourceType);
  if (url) log(`  uploaded ${filename} → Cloudinary`);
  return url;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!PROD_URI) {
    console.error("MONGODB_URI not set in env — cannot connect to prod DB");
    process.exit(1);
  }

  log("connecting to local DB...");
  const localConn = await mongoose.createConnection(LOCAL_URI).asPromise();
  log("connecting to prod DB...");
  const prodConn = await mongoose.createConnection(PROD_URI).asPromise();

  const L_Entry = localConn.model("Entry", entrySchema);
  const L_Transcript = localConn.model("Transcript", transcriptSchema);
  const L_Segment = localConn.model("Segment", segmentSchema);
  const L_Analysis = localConn.model("Analysis", analysisSchema);

  const P_Entry = prodConn.model("Entry", entrySchema);
  const P_Transcript = prodConn.model("Transcript", transcriptSchema);
  const P_Segment = prodConn.model("Segment", segmentSchema);
  const P_Analysis = prodConn.model("Analysis", analysisSchema);

  // ── 1. Fetch all local data ───────────────────────────────────────────────
  const entries = await L_Entry.find().lean();
  const transcripts = await L_Transcript.find().lean();
  const segments = await L_Segment.find().lean();
  const analyses = await L_Analysis.find().lean();

  log(`found ${entries.length} entries, ${transcripts.length} transcripts, ${segments.length} segments, ${analyses.length} analyses`);

  // ── 2. Upload all media to Cloudinary and build URL maps ──────────────────
  const urlMap = new Map(); // old mediaPath → new Cloudinary URL

  // Collect all unique media paths from entries
  const allMediaPaths = new Set();
  for (const e of entries) {
    const fields = ["mediaPath", "posterPath", "compressedPath", "audioPath", "cartoonPath", "ditherPath"];
    for (const f of fields) {
      if (e[f]) allMediaPaths.add(e[f]);
    }
  }

  log(`\nuploading ${allMediaPaths.size} unique media files to Cloudinary...`);
  let uploaded = 0;
  for (const mp of allMediaPaths) {
    const url = await uploadMediaRef(mp);
    if (url) urlMap.set(mp, url);
    uploaded++;
    if (uploaded % 5 === 0) log(`  progress: ${uploaded}/${allMediaPaths.size}`);
  }
  log(`uploaded ${urlMap.size}/${allMediaPaths.size} files to Cloudinary`);

  // ── 3. Remap media paths in entries ───────────────────────────────────────
  log("\nremapping entry media paths...");
  const entriesToInsert = entries.map((e) => {
    const remapped = { ...e };
    const fields = ["mediaPath", "posterPath", "compressedPath", "audioPath", "cartoonPath", "ditherPath"];
    for (const f of fields) {
      if (remapped[f] && urlMap.has(remapped[f])) {
        remapped[f] = urlMap.get(remapped[f]);
      }
    }
    delete remapped.__v;
    delete remapped._id;
    return remapped;
  });

  // ── 4. Insert into prod DB ────────────────────────────────────────────────
  log("\nclearing prod DB collections...");
  await P_Entry.deleteMany({});
  await P_Transcript.deleteMany({});
  await P_Segment.deleteMany({});
  await P_Analysis.deleteMany({});

  log("inserting entries...");
  const insertedEntries = await P_Entry.insertMany(entriesToInsert);
  log(`inserted ${insertedEntries.length} entries`);

  // Build old _id → new _id map
  const idMap = new Map();
  for (let i = 0; i < entries.length; i++) {
    idMap.set(String(entries[i]._id), String(insertedEntries[i]._id));
  }

  // Remap references in other collections
  const remapRef = (doc) => {
    const r = { ...doc };
    delete r.__v;
    delete r._id;
    if (r.entry && idMap.has(String(r.entry))) {
      r.entry = idMap.get(String(r.entry));
    }
    return r;
  };

  log("inserting transcripts...");
  const tDocs = transcripts.map(remapRef);
  if (tDocs.length) await P_Transcript.insertMany(tDocs);
  log(`inserted ${tDocs.length} transcripts`);

  log("inserting segments...");
  const sDocs = segments.map(remapRef);
  if (sDocs.length) await P_Segment.insertMany(sDocs);
  log(`inserted ${sDocs.length} segments`);

  log("inserting analyses...");
  const aDocs = analyses.map(remapRef);
  if (aDocs.length) await P_Analysis.insertMany(aDocs);
  log(`inserted ${aDocs.length} analyses`);

  // ── Done ──────────────────────────────────────────────────────────────────
  log("\n✓ migration complete");
  log(`  entries: ${insertedEntries.length}`);
  log(`  transcripts: ${tDocs.length}`);
  log(`  segments: ${sDocs.length}`);
  log(`  analyses: ${aDocs.length}`);
  log(`  media uploaded: ${urlMap.size}`);

  await localConn.close();
  await prodConn.close();
}

main().catch((e) => {
  console.error("[migrate] fatal:", e);
  process.exit(1);
});
