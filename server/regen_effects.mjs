// Re-render the vignette-fixed effects (retro/sepia/bw) for entries whose local
// source still exists, re-upload to Cloudinary, and update the DB URL in place.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectDB } from "./src/db.js";
import Entry from "./src/models/Entry.js";
import { cartoonifyRetro, sepia, bw } from "./src/media.js";
import { uploadMedia } from "./src/cloudinary.js";
import { EFFECTS } from "./src/effects.js";

const MEDIA = path.join(path.dirname(fileURLToPath(import.meta.url)), "media");
const AFFECTED = {
  retro: { fn: cartoonifyRetro, field: "retroPath", ext: ".retro.mp4" },
  sepia: { fn: sepia,           field: "sepiaPath", ext: ".sepia.mp4" },
  bw:    { fn: bw,              field: "bwPath",    ext: ".bw.mp4" },
};

await connectDB(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/entry_app");
const files = fs.readdirSync(MEDIA);
const entries = await Entry.find().lean();
let fixed = 0, noSrc = 0;

for (const e of entries) {
  const hasAffected = Object.values(AFFECTED).some((a) => e[a.field]);
  if (!hasAffected) continue;
  const m = (e.mediaPath || "").match(/(\d{13}-[a-f0-9]+)/);
  if (!m) continue;
  const id = m[1];
  const srcFile = files.find((f) => new RegExp(`^${id}\\.[^.]+$`).test(f));
  if (!srcFile) { noSrc++; console.log(`- ${id}: source missing, skipped`); continue; }
  const srcPath = path.join(MEDIA, srcFile);

  for (const [key, { fn, field, ext }] of Object.entries(AFFECTED)) {
    if (!e[field]) continue;
    const out = path.join(MEDIA, `${id}${ext}`);
    try {
      await fn(srcPath, out, EFFECTS[key].opts);
      const url = await uploadMedia(out, `${id}${ext.replace(/\.[^.]+$/, "")}`);
      await Entry.findByIdAndUpdate(e._id, { [field]: url });
      fixed++;
      console.log(`✓ ${id} ${key}`);
    } catch (err) { console.log(`✗ ${id} ${key}: ${err.message}`); }
  }
}
console.log(`done — ${fixed} clips re-rendered & re-uploaded, ${noSrc} entries had no local source`);
process.exit(0);
