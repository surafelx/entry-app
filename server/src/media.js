// Media-processing toolkit built on ffmpeg.
//
// Three jobs the app cares about:
//   1. compress()      — shrink a heavy recording for cheap storage/playback
//   2. pixelDither()   — turn a clip into a low-palette, Bayer-dithered animation
//   3. extractAudio()  — pull a compact mono track (the "easier output" for
//                        transcription / analysis — a fraction of the bytes)
//
// Plus pixelArt() (nearest-neighbour pixelation) and waveform() (a poster image).
//
// Everything shells out to ffmpeg/ffprobe on PATH — no native deps.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(err.trim() || `${bin} exit ${code}`))
    );
  });
}

const ff = (args) =>
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

// Cached check so we can skip processing gracefully where ffmpeg isn't installed.
let _avail;
export function ffmpegAvailable() {
  if (_avail !== undefined) return _avail;
  _avail = new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"]);
    p.on("error", () => resolve(false));
    p.on("close", (c) => resolve(c === 0));
  });
  return _avail;
}

export async function probe(input) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "format=duration,size,bit_rate:stream=width,height,codec_name,r_frame_rate",
      "-of", "json",
      input,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", () => {
      try {
        const j = JSON.parse(out);
        const v = j.streams?.[0] || {};
        const [n, d] = (v.r_frame_rate || "0/1").split("/").map(Number);
        resolve({
          duration: +j.format?.duration || 0,
          size: +j.format?.size || 0,
          bitrate: +j.format?.bit_rate || 0,
          width: v.width,
          height: v.height,
          codec: v.codec_name,
          fps: d ? +(n / d).toFixed(2) : 0,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

const range = ({ start, seconds }) => [
  ...(start ? ["-ss", String(start)] : []),
  ...(seconds ? ["-t", String(seconds)] : []),
];

// 1. Compress — scale down, cap fps, H.264 CRF. Web-friendly, faststart.
export async function compress(input, output, o = {}) {
  const { height = 720, fps = 30, crf = 28, preset = "veryfast" } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-vf", `scale=-2:${height},fps=${fps}`,
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// 2. Pixel + dither — reduce palette and apply ordered (Bayer) dithering, then
//    a nearest-neighbour upscale so the dither pattern reads as chunky pixels.
//    Output as animated WebP (.webp — ~10× smaller than GIF, so the whole clip
//    fits) or GIF (.gif). WebP is preferred for full-length previews.
export async function pixelDither(input, output, o = {}) {
  const { width = 200, up = 480, fps = 12, colors = 24, bayer = 4, mode = "bayer", quality = 70 } = o;
  const ditherArg = mode === "bayer" ? `dither=bayer:bayer_scale=${bayer}` : `dither=${mode}`;
  const webp = output.toLowerCase().endsWith(".webp");
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex",
    `[0:v]fps=${fps},scale=${width}:-2:flags=lanczos,` +
      `scale=${up}:-2:flags=neighbor,split[a][b];` +
      `[a]palettegen=max_colors=${colors}[p];` +
      `[b][p]paletteuse=${ditherArg}`,
    ...(webp
      ? ["-c:v", "libwebp_anim", "-q:v", String(quality), "-an", "-loop", "0"]
      : ["-loop", "0"]),
    output,
  ]);
  return (await stat(output)).size;
}

// pixel-art video (no dithering) — crunch to a tiny grid, blow back up.
export async function pixelArt(input, output, o = {}) {
  const { blocks = 96, up = 540, fps = 15, crf = 30 } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-an",
    "-vf", `fps=${fps},scale=${blocks}:-2:flags=area,scale=${up}:-2:flags=neighbor`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p",
    output,
  ]);
  return (await stat(output)).size;
}

// 3. Extract audio — mono, low bitrate. The cheap input for transcription.
export async function extractAudio(input, output, o = {}) {
  const { bitrate = "64k", mono = true } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-vn",
    ...(mono ? ["-ac", "1"] : []),
    "-c:a", "libmp3lame", "-b:a", bitrate,
    output,
  ]);
  return (await stat(output)).size;
}

// bonus — a static waveform poster in the app's accent colour.
export async function waveform(input, output, o = {}) {
  const { w = 1200, h = 240, color = "FF4D2E" } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex", `showwavespic=s=${w}x${h}:colors=#${color}`,
    "-frames:v", "1",
    output,
  ]);
  return (await stat(output)).size;
}

// 4. Extract keyframes as JPEGs for server-side visual analysis.
//    Samples up to `count` frames evenly across the video duration.
//    Returns an array of { base64, mimeType } objects.
export async function extractFrames(input, o = {}) {
  const { count = 4, width = 512 } = o;
  const dur = await getDuration(input).catch(() => 0);
  if (dur <= 0) return [];

  const frames = [];
  const interval = dur / (count + 1);

  for (let i = 1; i <= count; i++) {
    const ts = interval * i;
    const outBase = `${input}.frame${i}`;
    const outJpg = `${outBase}.jpg`;
    try {
      await ff([
        "-ss", String(ts),
        "-i", input,
        "-frames:v", "1",
        "-vf", `scale=${width}:-2`,
        "-q:v", "4",
        outJpg,
      ]);
      const buf = await import("node:fs/promises").then((fs) => fs.readFile(outJpg));
      frames.push({
        base64: buf.toString("base64"),
        mimeType: "image/jpeg",
      });
    } catch {}
    // cleanup temp file
    import("node:fs/promises").then((fs) => fs.rm(outJpg, { force: true }));
  }
  return frames;
}

// 5. Extract a single poster frame (at 25% into the video).
export async function extractPoster(input, output) {
  const dur = await getDuration(input).catch(() => 0);
  const ts = dur > 0 ? dur * 0.25 : 1;
  await ff([
    "-ss", String(ts),
    "-i", input,
    "-frames:v", "1",
    "-vf", "scale=640:-2",
    "-q:v", "3",
    output,
  ]);
  return (await stat(output)).size;
}

// 6. Get video duration in seconds via ffprobe.
export async function getDuration(input) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      input,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", reject);
    p.on("close", (c) => {
      const dur = parseFloat(out.trim());
      if (c === 0 && !isNaN(dur)) resolve(dur);
      else reject(new Error(`ffprobe failed: ${out.trim()}`));
    });
  });
}

// 7. Cartoonify — absurd, melted cartoon look: massive saturation + contrast,
//    crushed to a tiny grid (chunky pixels), reduced to a ~14-colour palette and
//    Smooth cartoon: bold outlines + vivid colours, upscaled cleanly (no pixel grid).
export async function cartoonify(input, output, o = {}) {
  const {
    height = 640, fps = 24, crf = 30, preset = "fast",
  } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex",
    `[0:v]fps=${fps},scale=-2:${height},` +
      // extreme colour: saturation 8×, contrast 3×, hue rotation for comic palette
      `eq=saturation=8.0:contrast=3.0:brightness=0.02:gamma=1.3,` +
      `hue=h=15:s=2.0,` +
      `unsharp=5:5:4.0:5:5:2.0,` +
      // heavy colour push — reds/blues boosted, greens muted
      `colorbalance=rs=0.45:gs=-0.15:bs=0.45:rm=0.35:gm=-0.1:bm=0.35,` +
      // crush shadows, punch highlights — comic-book contrast
      `curves=all='0/0 0.15/0.22 0.45/0.75 0.75/0.95 1/1',` +
      `split[main][edsrc];` +
      // edge map → invert for BLACK outlines, boost contrast
      `[edsrc]edgedetect=low=0.03:high=0.12,negate,eq=contrast=2.5[ed];` +
      `[main][ed]blend=all_mode=multiply[out]`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// 8. Glitch — VHS tracking errors, chromatic aberration, scan lines
export async function glitch(input, output, o = {}) {
  const { height = 480, fps = 24, crf = 28, preset = "fast" } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex",
    `[0:v]fps=${fps},scale=-2:${height},` +
      // chromatic aberration — split RGB and offset
      `split[r][g][b];` +
      `[r]colorchannelmixer=1:0:0:0:0:0:0:0:0:0:0:0:0:0:0[r];` +
      `[g]colorchannelmixer=0:0:0:0:0:1:0:0:0:0:0:0:0:0:0[g];` +
      `[b]colorchannelmixer=0:0:0:0:0:0:0:0:0:0:0:1:0:0:0[b];` +
      `[r][g]blend=all_mode=addition:all_opacity=0.5[rg];` +
      `[rg][b]blend=all_mode=addition:all_opacity=0.5[chromatic];` +
      `[chromatic]eq=brightness=0.02:contrast=1.1:saturation=1.3,` +
      // scan lines
      `drawgrid=width=2:height=2:thickness=1:color=black@0.15,` +
      // noise + slight shake
      `noise=c0s=20:c0f=t+u,` +
      `crop=in_w-4:in_h:2,` +
      `eq=gamma=0.95[out]`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// 9. B&W — high-contrast black and white, film noir
export async function bw(input, output, o = {}) {
  const { height = 480, fps = 24, crf = 28, preset = "fast" } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-vf",
    `fps=${fps},scale=-2:${height},` +
      `hue=s=0,` +
      `eq=contrast=1.5:brightness=0.03:gamma=1.2,` +
      `unsharp=5:5:1.5:5:5:0.8`,
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-an",
    "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// 10. VHS — warm degradation, tracking lines, colour bleed
export async function vhs(input, output, o = {}) {
  const { height = 480, fps = 24, crf = 30, preset = "fast" } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex",
    `[0:v]fps=${fps},scale=-2:${height},` +
      // warm colour shift + desaturate slightly
      `eq=saturation=0.7:contrast=1.15:brightness=0.04:gamma=1.05,` +
      `colorbalance=rs=0.2:gs=0.08:bs=-0.1:rm=0.15:gm=0.05:bm=-0.08,` +
      `hue=h=5:s=0.9,` +
      // tracking noise
      `noise=c0s=15:c0f=t+u,` +
      // soft glow
      `unsharp=3:3:2:3:3:1,` +
      `vignette=PI/3:0.4[out]`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// Retro vintage comic — warm sepia tones, halftone grain, faded blacks, paper texture
export async function cartoonifyRetro(input, output, o = {}) {
  const {
    height = 640, fps = 24, crf = 28, preset = "fast",
  } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex",
    `[0:v]fps=${fps},scale=-2:${height},` +
      // warm sepia base: desaturate then tint warm
      `eq=saturation=0.4:contrast=1.2:brightness=0.05:gamma=1.1,` +
      `colorbalance=rs=0.3:gs=0.1:bs=-0.15:rm=0.25:gm=0.08:bm=-0.12:rh=0.15:gh=0.05:bh=-0.08,` +
      `hue=h=8:s=0.7,` +
      // lift shadows (faded blacks) + crush midtones for that worn print look
      `curves=all='0/0.06 0.12/0.18 0.35/0.48 0.6/0.72 0.85/0.92 1/0.97',` +
      `unsharp=3:3:1.5:3:3:0.8,` +
      // add film grain (old print texture)
      `noise=c0s=12:c0f=t+u,` +
      `split[main][edsrc2];` +
      // softer edges — thicker, brownish outlines
      `[edsrc2]edgedetect=low=0.05:high=0.15,` +
      `eq=contrast=1.8:brightness=-0.05,` +
      `colorbalance=rs=0.2:gs=0.1:bs=-0.05,` +
      `negate[ed];` +
      `[main][ed]blend=all_mode=multiply:all_opacity=0.7,` +
      `vignette=PI/4:0.3[out]`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}
