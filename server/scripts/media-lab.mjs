// Demo/CLI for the media toolkit.
//   node scripts/media-lab.mjs <input> [outDir] [--seconds N]
//
// Produces a compressed mp4, a pixel-dithered gif, a pixel-art mp4, an
// extracted mono mp3, and a waveform png — then prints a size report.

import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  probe,
  compress,
  pixelDither,
  pixelArt,
  extractAudio,
  waveform,
} from "../src/media.js";

const input = process.argv[2];
const outDir = process.argv[3] && !process.argv[3].startsWith("--")
  ? process.argv[3]
  : path.resolve("media-out");
const secFlag = process.argv.indexOf("--seconds");
const seconds = secFlag > -1 ? Number(process.argv[secFlag + 1]) : 20;

if (!input) {
  console.error("usage: node scripts/media-lab.mjs <input> [outDir] [--seconds N]");
  process.exit(1);
}

const kb = (b) => `${(b / 1024).toFixed(0)} KB`;
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;
const human = (b) => (b > 1048576 ? mb(b) : kb(b));

async function main() {
  await mkdir(outDir, { recursive: true });
  const base = path.parse(input).name;
  const out = (suffix) => path.join(outDir, `${base}.${suffix}`);

  const src = await probe(input);
  console.log("\n📼 Source");
  console.log(
    `   ${src.width}×${src.height} · ${src.fps}fps · ${src.codec} · ` +
      `${src.duration.toFixed(0)}s · ${mb(src.size)} · ${(src.bitrate / 1e6).toFixed(0)} Mbps`
  );
  // bytes of the processed window, for an apples-to-apples ratio
  const windowSec = Math.min(seconds, src.duration);
  const srcWindowBytes = (src.bitrate / 8) * windowSec;

  const jobs = [
    ["compress  (720p30 h264)", () => compress(input, out("min.mp4"), { seconds }), true],
    ["pixelDither (webp, 24c) ", () => pixelDither(input, out("dither.webp"), { seconds: Math.min(8, seconds) })],
    ["pixelArt   (mp4)        ", () => pixelArt(input, out("pixel.mp4"), { seconds: Math.min(6, seconds) })],
    ["audio      (mono mp3)   ", () => extractAudio(input, out("audio.mp3"), {})], // full track
    ["waveform   (png)        ", () => waveform(input, out("wave.png"), {})],
  ];

  console.log(`\n⚙️  Processing first ${windowSec}s (audio = full ${src.duration.toFixed(0)}s)…\n`);
  for (const [label, fn, ratio] of jobs) {
    const t = Date.now();
    try {
      const size = await fn();
      const secs = ((Date.now() - t) / 1000).toFixed(1);
      let note = "";
      if (ratio) {
        const r = srcWindowBytes / size;
        note = ` · ${r.toFixed(0)}× smaller than source window`;
      }
      console.log(`   ✓ ${label}  ${human(size).padStart(8)}  (${secs}s)${note}`);
    } catch (e) {
      console.log(`   ✗ ${label}  ${e.message.split("\n")[0]}`);
    }
  }
  console.log(`\n📂 Outputs in ${outDir}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
