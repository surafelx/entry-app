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

// 7. Cartoonify — vivid comic look: bold black outlines over saturated, posterized
//    colour. Tuned so the outlines read clearly without crushing the whole image
//    (the old multiply-at-full-opacity darkened everything to mud).
export async function cartoonify(input, output, o = {}) {
  const {
    height = 640, fps = 24, crf = 30, preset = "fast",
  } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex",
    `[0:v]fps=${fps},scale=-2:${height},` +
      // punchy but not blown-out colour (was saturation=8, contrast=3 → muddy)
      `eq=saturation=4.5:contrast=1.6:brightness=0.02:gamma=1.1,` +
      `hue=h=8:s=1.3,` +
      // flatten into comic bands, then sharpen the boundaries
      `smartblur=lr=2.0:ls=-0.4,` +
      `unsharp=5:5:1.5:5:5:0.6,` +
      // gentle reds/blues push
      `colorbalance=rs=0.20:gs=-0.06:bs=0.20:rm=0.15:gm=-0.04:bm=0.15,` +
      // lift shadows a touch so multiplied outlines don't crush to black
      `curves=all='0/0.04 0.2/0.28 0.5/0.72 0.8/0.94 1/1',` +
      // RGB before split so the multiply blend stays per-channel (YUV multiply
      // corrupts chroma)
      `format=gbrp,split[main][edsrc];` +
      // edge map → invert for BLACK outlines
      `[edsrc]edgedetect=low=0.06:high=0.18,negate,eq=contrast=2.0[ed];` +
      // partial-opacity multiply keeps colour bright, lines bold
      `[main][ed]blend=all_mode=multiply:all_opacity=0.75[out]`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// 8. Glitch — real chromatic aberration (rgbashift actually offsets the red/blue
//    planes in space) plus scan lines, digital noise and a slight edge shake.
export async function glitch(input, output, o = {}) {
  const { height = 480, fps = 24, crf = 28, preset = "fast" } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-vf",
    `fps=${fps},scale=-2:${height},` +
      // true chromatic aberration: shift red left, blue right
      `rgbashift=rh=-6:bh=6:rv=2:bv=-2,` +
      `eq=brightness=0.02:contrast=1.12:saturation=1.35,` +
      // scan lines
      `drawgrid=width=2:height=2:thickness=1:color=black@0.15,` +
      // digital noise (dialed down from c0s=20) + slight horizontal shake
      `noise=c0s=10:c0f=t+u,` +
      `crop=in_w-4:in_h:2,` +
      `eq=gamma=0.95`,
    "-map", "0:v", "-map", "0:a?",
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
      // film-noir contrast + crushed blacks, soft vignette
      `eq=contrast=1.65:brightness=0.02:gamma=1.15,` +
      `curves=all='0/0 0.2/0.14 0.5/0.55 0.8/0.9 1/1',` +
      `unsharp=5:5:1.5:5:5:0.8,` +
      `vignette=PI/6`,
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
      // warm colour shift + desaturate slightly (brighter than before)
      `eq=saturation=0.72:contrast=1.12:brightness=0.09:gamma=1.08,` +
      `colorbalance=rs=0.2:gs=0.08:bs=-0.1:rm=0.15:gm=0.05:bm=-0.08,` +
      `hue=h=5:s=0.9,` +
      // tracking noise (softened from c0s=15) + subtle horizontal smear
      `noise=c0s=8:c0f=t+u,` +
      `rgbashift=rh=2:bh=-2,` +
      // soft glow
      `unsharp=3:3:1.6:3:3:0.8,` +
      // lighter vignette so the subject stays visible
      `vignette=PI/6[out]`,
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
      // warm sepia base via the fixed sepia matrix — immune to source colour casts
      // (the old eq+colorbalance approach turned some clips green)
      `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,` +
      `eq=contrast=1.15:brightness=0.03:saturation=0.95,` +
      // lift shadows (faded blacks) + crush midtones for that worn print look
      `curves=all='0/0.06 0.12/0.18 0.35/0.48 0.6/0.72 0.85/0.92 1/0.97',` +
      `unsharp=3:3:1.5:3:3:0.8,` +
      // add film grain (old print texture) — softened from c0s=12.
      // Force RGB before the split so the multiply blend runs per-RGB-channel;
      // multiplying in YUV corrupts chroma and tinted the low-sat sepia green.
      `noise=c0s=7:c0f=t+u,format=gbrp,split[main][edsrc2];` +
      `[edsrc2]edgedetect=low=0.05:high=0.15,` +
      `eq=contrast=1.8:brightness=-0.05,negate[ed];` +
      `[main][ed]blend=all_mode=multiply:all_opacity=0.55,` +
      `vignette=PI/5[out]`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// Shared H.264 tail for the simple single-chain effects below.
const vfEffect = (input, output, vf, o = {}, keepAudio = true) =>
  ff([
    ...range(o),
    "-i", input,
    "-vf", vf,
    "-c:v", "libx264", "-preset", o.preset || "fast", "-crf", String(o.crf ?? 28), "-pix_fmt", "yuv420p",
    ...(keepAudio ? ["-c:a", "copy"] : ["-an"]),
    "-movflags", "+faststart",
    output,
  ]).then(() => stat(output)).then((s) => s.size);

// ── ANALOG / RETRO ──────────────────────────────────────────────────────────

// super-8 home movie — warm cast, film grain, gate weave, heavy vignette.
export async function super8(input, output, o = {}) {
  const { height = 480, fps = 24 } = o;
  return vfEffect(input, output,
    `fps=${fps},scale=-2:${height},` +
      `eq=saturation=0.85:contrast=1.15:brightness=0.04:gamma=1.05,` +
      `colorbalance=rs=0.25:gs=0.08:bs=-0.15:rm=0.2:gm=0.05:bm=-0.12,` +
      `curves=all='0/0.05 0.3/0.35 0.7/0.78 1/0.96',` +
      `noise=c0s=9:c0f=t+u,` +
      // gate weave — subtly jitter the frame
      `crop=in_w-8:in_h-8:'4+3*sin(t*18)':'4+2*cos(t*15)',` +
      `vignette=PI/2.6`,
    o);
}

// classic sepia — warm monochrome via the standard sepia matrix + vignette.
export async function sepia(input, output, o = {}) {
  const { height = 480, fps = 24 } = o;
  return vfEffect(input, output,
    `fps=${fps},scale=-2:${height},` +
      `colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131,` +
      `eq=contrast=1.1:brightness=0.03,` +
      `vignette=PI/5`,
    o);
}

// ── DIGITAL / CYBER ─────────────────────────────────────────────────────────

// CRT monitor — scanlines, chromatic fringing, phosphor glow, tube vignette.
export async function crt(input, output, o = {}) {
  const { height = 480, fps = 24, crf = 28, preset = "fast" } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex",
    `[0:v]fps=${fps},scale=-2:${height},` +
      `rgbashift=rh=-2:bh=2,` +
      `eq=saturation=1.15:contrast=1.15,` +
      // horizontal scanlines
      `drawgrid=width=iw:height=3:thickness=1:color=black@0.30,` +
      `split[a][b];` +
      `[a]gblur=sigma=2.5[g];` +
      `[b][g]blend=all_mode=screen:all_opacity=0.35,` +
      `vignette=PI/5[out]`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// thermal camera — grayscale mapped through a heat-map LUT.
export async function thermal(input, output, o = {}) {
  const { height = 480, fps = 24 } = o;
  return vfEffect(input, output,
    `fps=${fps},scale=-2:${height},` +
      `format=gray,pseudocolor=preset=turbo,` +
      `eq=contrast=1.1:saturation=1.2`,
    o);
}

// neon — glowing coloured outlines over a darkened base.
export async function neon(input, output, o = {}) {
  const { height = 480, fps = 24, crf = 28, preset = "fast" } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex",
    `[0:v]fps=${fps},scale=-2:${height},split[base][edsrc];` +
      `[base]eq=brightness=-0.3:saturation=0.8[dark];` +
      `[edsrc]edgedetect=low=0.1:high=0.3:mode=colormix,` +
      `eq=saturation=2.5:brightness=0.1,gblur=sigma=1.5[edges];` +
      `[dark][edges]blend=all_mode=screen:all_opacity=0.9[out]`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// datamosh — smeared frame-blend with colour tearing (fake datamosh look).
export async function datamosh(input, output, o = {}) {
  const { height = 480, fps = 24 } = o;
  return vfEffect(input, output,
    `fps=${fps},scale=-2:${height},` +
      `tmix=frames=4,` +
      `rgbashift=rh=-5:bh=5:rv=3:bv=-3,` +
      `noise=c0s=6:c0f=t+u,` +
      `eq=saturation=1.3:contrast=1.05`,
    o);
}

// ── ARTISTIC / PAINTERLY ────────────────────────────────────────────────────

// sketch — pencil on paper: dark edge lines on a light ground.
export async function sketch(input, output, o = {}) {
  const { height = 480, fps = 24 } = o;
  return vfEffect(input, output,
    `fps=${fps},scale=-2:${height},` +
      `format=gray,edgedetect=low=0.1:high=0.25,negate,` +
      `eq=contrast=1.4:brightness=0.05,` +
      `curves=all='0/0.1 0.5/0.6 1/1'`,
    o, false);
}

// posterize — flat comic bands with bold outlines.
export async function posterize(input, output, o = {}) {
  const { height = 480, fps = 24, crf = 28, preset = "fast" } = o;
  await ff([
    ...range(o),
    "-i", input,
    "-filter_complex",
    `[0:v]fps=${fps},scale=-2:${height},` +
      `eq=saturation=1.6:contrast=1.2,smartblur=lr=1.5,` +
      `lutrgb=r='48*floor(val/48)':g='48*floor(val/48)':b='48*floor(val/48)',` +
      `format=gbrp,split[m][e];` +
      `[e]edgedetect=low=0.08:high=0.2,negate[ed];` +
      `[m][ed]blend=all_mode=multiply:all_opacity=0.7[out]`,
    "-map", "[out]", "-map", "0:a?",
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart",
    output,
  ]);
  return (await stat(output)).size;
}

// oil — painterly: heavy smoothing + coarse colour bands, no hard outlines.
export async function oil(input, output, o = {}) {
  const { height = 480, fps = 24 } = o;
  return vfEffect(input, output,
    `fps=${fps},scale=-2:${height},` +
      `eq=saturation=1.45:contrast=1.08:brightness=0.02,` +
      `smartblur=lr=4.0:ls=0.8:lt=-0.3,` +
      `lutrgb=r='56*floor(val/56)':g='56*floor(val/56)':b='56*floor(val/56)',` +
      `unsharp=5:5:0.8`,
    o);
}
