// Local speech-to-text via whisper.cpp. Produces time-aligned segments so the
// transcript can be paginated and the video cut at each part.
//
// Needs the `whisper-cli` (or `whisper-cpp`) binary on PATH and a ggml model at
// server/models/ggml-base.en.bin (see scripts/get-whisper-model.sh).

import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDuration } from "./media.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL =
  process.env.WHISPER_MODEL ||
  path.join(__dirname, "..", "models", "ggml-base.en.bin");

// Anything longer than this is split into ~CHUNK_SEC windows transcribed in
// parallel. whisper.cpp only uses ~4 threads per file, so on a multi-core box
// running several chunks at once fills the idle cores for a near-linear speedup.
const CHUNK_SEC = Number(process.env.WHISPER_CHUNK_SEC || 30);

const BINS = ["whisper-cli", "whisper-cpp"];

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(err.trim() || `${bin} ${c}`))));
  });
}
const ff = (args) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

let _bin;
function onPath(bin) {
  return new Promise((res) => {
    const p = spawn(bin, ["--help"]);
    p.on("error", () => res(false));
    p.on("close", () => res(true));
  });
}
async function whisperBin() {
  if (_bin !== undefined) return _bin;
  for (const b of BINS) if (await onPath(b)) return (_bin = b);
  return (_bin = null);
}

export async function whisperAvailable() {
  return !!(await whisperBin()) && existsSync(MODEL);
}

// Run whisper on one wav and return time-aligned segments, each shifted by
// `offsetSec` so a chunk's times sit at their true position in the full clip.
async function whisperOne(bin, wav, offsetSec, threads) {
  const outBase = `${wav}.out`;
  try {
    // --max-len + split-on-word → many short, time-aligned segments (reader pages).
    const args = ["-m", MODEL, "-f", wav, "-oj", "-of", outBase, "-nt", "-ml", "60", "-sow"];
    if (threads) args.push("-t", String(threads));
    await run(bin, args);

    const json = JSON.parse(await readFile(`${outBase}.json`, "utf8"));
    return (json.transcription || [])
      .map((s) => ({
        startSec: offsetSec + (s.offsets?.from ?? 0) / 1000,
        endSec: offsetSec + (s.offsets?.to ?? 0) / 1000,
        text: (s.text || "").trim(),
      }))
      .filter((s) => s.text);
  } finally {
    rm(`${outBase}.json`, { force: true }).catch(() => {});
  }
}

// Run `fn` over items with bounded concurrency, preserving order.
async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results;
}

// Transcribe a media file → { text, segments:[{startSec,endSec,text}] }.
// Long clips are split into CHUNK_SEC windows transcribed in parallel.
export async function transcribe(input, opts = {}) {
  const bin = await whisperBin();
  if (!bin || !existsSync(MODEL)) return null;

  const wav = `${input}.whisper.wav`;
  const chunkSec = opts.chunkSec ?? CHUNK_SEC;
  try {
    // whisper.cpp wants 16 kHz mono PCM.
    await ff(["-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);

    const dur = await getDuration(wav).catch(() => 0);
    const cores = os.cpus().length || 4;

    // A single whisper pass already uses min(4, cores) threads, so on ≤4-core
    // boxes chunking can't add core utilization — it'd only add overhead. Only
    // split when there are spare cores to run extra whisper processes (or when
    // explicitly forced via opts.forceChunk, e.g. for testing).
    const worthChunking =
      dur && dur > chunkSec * 1.5 && (cores > 4 || opts.forceChunk);

    if (!worthChunking) {
      const segments = await whisperOne(bin, wav, 0);
      return { text: segments.map((s) => s.text).join(" "), segments };
    }

    // Carve into windows and size the thread budget so chunks×threads ≈ cores.
    const windows = [];
    for (let start = 0; start < dur; start += chunkSec) {
      windows.push({ start, len: Math.min(chunkSec, dur - start) });
    }
    const concurrency = Math.max(1, Math.min(4, windows.length, Math.floor(cores / 2)));
    const threads = Math.max(2, Math.floor(cores / concurrency));
    console.log(
      `[transcribe] ${Math.round(dur)}s → ${windows.length} chunks, ` +
        `${concurrency} parallel × ${threads} threads`
    );

    const perChunk = await mapPool(windows, concurrency, async (w, i) => {
      const cwav = `${input}.whisper.${i}.wav`;
      try {
        await ff([
          "-ss", String(w.start), "-t", String(w.len),
          "-i", wav, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", cwav,
        ]);
        return await whisperOne(bin, cwav, w.start, threads);
      } finally {
        rm(cwav, { force: true }).catch(() => {});
      }
    });

    const segments = perChunk.flat().sort((a, b) => a.startSec - b.startSec);
    return { text: segments.map((s) => s.text).join(" "), segments };
  } finally {
    rm(wav, { force: true }).catch(() => {});
  }
}
