// One-shot migration: upload existing local /media/ files to Cloudinary
// and update Entry documents with Cloudinary URLs.
//
// Usage: node src/migrate.js

import "dotenv/config";
import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import Entry from "./models/Entry.js";
import { uploadMedia, uploadImage } from "./cloudinary.js";

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/entry_app";
const MEDIA_DIR = path.join(import.meta.dirname, "..", "media");

function pubId(filename) {
  return filename.replace(/\.[^.]+$/, "");
}

async function migrate() {
  await mongoose.connect(MONGODB_URI);
  console.log(`[migrate] connected to ${mongoose.connection.name}`);

  const entries = await Entry.find({
    $or: [
      { mediaPath: { $regex: "^/media/" } },
      { compressedPath: { $regex: "^/media/" } },
      { cartoonPath: { $regex: "^/media/" } },
      { audioPath: { $regex: "^/media/" } },
      { ditherPath: { $regex: "^/media/" } },
      { posterPath: { $regex: "^/media/" } },
    ],
  });

  console.log(`[migrate] found ${entries.length} entries with local paths`);

  for (const entry of entries) {
    console.log(`\n[migrate] processing entry ${entry._id} — ${entry.title || "untitled"}`);

    const updates = {};

    // Upload mediaPath (original)
    if (entry.mediaPath?.startsWith("/media/")) {
      const filename = path.basename(entry.mediaPath);
      const local = path.join(MEDIA_DIR, filename);
      if (fs.existsSync(local)) {
        try {
          updates.mediaPath = await uploadMedia(local, pubId(filename));
          console.log(`  ✓ mediaPath → Cloudinary`);
        } catch (e) {
          console.error(`  ✗ mediaPath upload failed: ${e.message}`);
        }
      } else {
        console.log(`  ⚠ local file not found: ${filename}`);
      }
    }

    // Upload posterPath
    if (entry.posterPath?.startsWith("/media/")) {
      const filename = path.basename(entry.posterPath);
      const local = path.join(MEDIA_DIR, filename);
      if (fs.existsSync(local)) {
        try {
          updates.posterPath = await uploadImage(local, pubId(filename));
          console.log(`  ✓ posterPath → Cloudinary`);
        } catch (e) {
          console.error(`  ✗ posterPath upload failed: ${e.message}`);
        }
      }
    }

    // Upload compressedPath
    if (entry.compressedPath?.startsWith("/media/")) {
      const filename = path.basename(entry.compressedPath);
      const local = path.join(MEDIA_DIR, filename);
      if (fs.existsSync(local)) {
        try {
          updates.compressedPath = await uploadMedia(local, pubId(filename));
          console.log(`  ✓ compressedPath → Cloudinary`);
        } catch (e) {
          console.error(`  ✗ compressedPath upload failed: ${e.message}`);
        }
      }
    }

    // Upload audioPath
    if (entry.audioPath?.startsWith("/media/")) {
      const filename = path.basename(entry.audioPath);
      const local = path.join(MEDIA_DIR, filename);
      if (fs.existsSync(local)) {
        try {
          updates.audioPath = await uploadMedia(local, pubId(filename));
          console.log(`  ✓ audioPath → Cloudinary`);
        } catch (e) {
          console.error(`  ✗ audioPath upload failed: ${e.message}`);
        }
      }
    }

    // Upload cartoonPath
    if (entry.cartoonPath?.startsWith("/media/")) {
      const filename = path.basename(entry.cartoonPath);
      const local = path.join(MEDIA_DIR, filename);
      if (fs.existsSync(local)) {
        try {
          updates.cartoonPath = await uploadMedia(local, pubId(filename));
          console.log(`  ✓ cartoonPath → Cloudinary`);
        } catch (e) {
          console.error(`  ✗ cartoonPath upload failed: ${e.message}`);
        }
      }
    }

    // Upload ditherPath
    if (entry.ditherPath?.startsWith("/media/")) {
      const filename = path.basename(entry.ditherPath);
      const local = path.join(MEDIA_DIR, filename);
      if (fs.existsSync(local)) {
        try {
          updates.ditherPath = await uploadMedia(local, pubId(filename));
          console.log(`  ✓ ditherPath → Cloudinary`);
        } catch (e) {
          console.error(`  ✗ ditherPath upload failed: ${e.message}`);
        }
      }
    }

    if (Object.keys(updates).length) {
      await Entry.findByIdAndUpdate(entry._id, updates);
      console.log(`  → updated entry with ${Object.keys(updates).length} Cloudinary URLs`);
    } else {
      console.log(`  → nothing to upload`);
    }
  }

  console.log("\n[migrate] done!");
  await mongoose.disconnect();
}

migrate().catch((e) => {
  console.error("[migrate] fatal:", e);
  process.exit(1);
});
