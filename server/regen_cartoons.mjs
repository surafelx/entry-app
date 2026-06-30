import { cartoonifyRetro } from "./src/media.js";
import { readdir } from "node:fs/promises";
const dir = new URL("./media/", import.meta.url);
const files = (await readdir(dir)).filter(f => f.endsWith(".cartoon.mp4"));
// Match the pipeline's params so re-rendered clips look identical to new ones.
const opts = { height: 360, fps: 24, crf: 28, preset: "fast" };
for (const c of files) {
  const src = "media/" + c.replace(/\.cartoon\.mp4$/, "");
  process.stdout.write(`regen → ${c} ... `);
  try { const s = await cartoonifyRetro(src, "media/" + c, opts); console.log((s/1e6).toFixed(1)+"MB"); }
  catch (e) { console.log("FAIL " + e.message); }
}
console.log("DONE");
