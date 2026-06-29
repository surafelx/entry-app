import { cartoonify } from "./src/media.js";
import { readdir } from "node:fs/promises";
const dir = new URL("./media/", import.meta.url);
const files = (await readdir(dir)).filter(f => f.endsWith(".cartoon.mp4"));
for (const c of files) {
  const src = "media/" + c.replace(/\.cartoon\.mp4$/, "");
  process.stdout.write(`regen → ${c} ... `);
  try { const s = await cartoonify(src, "media/" + c); console.log((s/1e6).toFixed(1)+"MB"); }
  catch (e) { console.log("FAIL " + e.message); }
}
console.log("DONE");
