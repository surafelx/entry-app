// Effects registry — the single source of truth for decorative video effects.
//
// One entry per effect drives everything: the pipeline (which fn to run + opts),
// the Cloudinary upload map (field + ext + type), and the Telegram keyboard
// (label + category). Adding an effect = add one entry here + its fn in media.js
// + the matching `<field>` on the Entry model.
//
//   key      → the token used in bot callbacks and pipeline `effects` arrays
//   fn       → the media.js function (input, output, opts) → size
//   field    → the Entry model path field the produced URL is stored on
//   ext      → output filename suffix (also the Cloudinary lookup key)
//   type     → "video" | "image" (how uploadAll pushes it to Cloudinary)
//   label    → human label shown on the bot button
//   category → grouping for the keyboard: "analog" | "cyber" | "art"
//   opts     → default ffmpeg options passed to fn

import {
  cartoonify, cartoonifyRetro, pixelArt, pixelDither, glitch, bw, vhs,
  super8, sepia, crt, thermal, neon, datamosh, sketch, posterize, oil,
} from "./media.js";

const V = { height: 480, fps: 24, crf: 28, preset: "fast" }; // common video preset

export const EFFECTS = {
  // ── analog / retro ──
  retro:  { fn: cartoonifyRetro, field: "retroPath",  ext: ".retro.mp4",  type: "video", label: "retro",   category: "analog", opts: { height: 360, fps: 24, crf: 28, preset: "fast" } },
  bw:     { fn: bw,              field: "bwPath",     ext: ".bw.mp4",     type: "video", label: "b&w",     category: "analog", opts: V },
  vhs:    { fn: vhs,             field: "vhsPath",    ext: ".vhs.mp4",    type: "video", label: "vhs",     category: "analog", opts: { ...V, crf: 30 } },
  super8: { fn: super8,          field: "super8Path", ext: ".super8.mp4", type: "video", label: "super-8", category: "analog", opts: V },
  sepia:  { fn: sepia,           field: "sepiaPath",  ext: ".sepia.mp4",  type: "video", label: "sepia",   category: "analog", opts: V },

  // ── digital / cyber ──
  glitch:   { fn: glitch,     field: "glitchPath",   ext: ".glitch.mp4",   type: "video", label: "glitch",   category: "cyber", opts: V },
  pixel:    { fn: pixelArt,    field: "pixelPath",    ext: ".pixel.mp4",    type: "video", label: "pixel",    category: "cyber", opts: { blocks: 96, up: 480, fps: 15, crf: 30 } },
  dither:   { fn: pixelDither, field: "ditherPath",   ext: ".dither.webp",  type: "video", label: "dither",   category: "cyber", opts: { width: 200, up: 480, fps: 12, colors: 48, bayer: 3, quality: 75 } },
  crt:      { fn: crt,         field: "crtPath",      ext: ".crt.mp4",      type: "video", label: "crt",      category: "cyber", opts: V },
  thermal:  { fn: thermal,     field: "thermalPath",  ext: ".thermal.mp4",  type: "video", label: "thermal",  category: "cyber", opts: V },
  neon:     { fn: neon,        field: "neonPath",     ext: ".neon.mp4",     type: "video", label: "neon",     category: "cyber", opts: V },
  datamosh: { fn: datamosh,    field: "datamoshPath", ext: ".datamosh.mp4", type: "video", label: "datamosh", category: "cyber", opts: V },

  // ── artistic / painterly ──
  cartoon:   { fn: cartoonify, field: "cartoonPath",   ext: ".cartoon.mp4",   type: "video", label: "cartoon",   category: "art", opts: { ...V, crf: 30 } },
  sketch:    { fn: sketch,     field: "sketchPath",    ext: ".sketch.mp4",    type: "video", label: "sketch",    category: "art", opts: V },
  posterize: { fn: posterize,  field: "posterizePath", ext: ".posterize.mp4", type: "video", label: "posterize", category: "art", opts: V },
  oil:       { fn: oil,        field: "oilPath",       ext: ".oil.mp4",       type: "video", label: "oil",       category: "art", opts: V },
};

export const EFFECT_KEYS = Object.keys(EFFECTS);

export const CATEGORY_LABELS = {
  analog: "🎞 analog",
  cyber: "💾 digital",
  art: "🎨 artistic",
};

// keys grouped by category, preserving insertion order
export const byCategory = EFFECT_KEYS.reduce((acc, key) => {
  const cat = EFFECTS[key].category;
  (acc[cat] ||= []).push(key);
  return acc;
}, {});

// order effect outputs prefer for display (best-looking colour effects first),
// used by the client to decide which processed clip to show.
export const DISPLAY_FIELD_ORDER = [
  "retroPath", "cartoonPath", "vhsPath", "super8Path", "sepiaPath",
  "crtPath", "neonPath", "thermalPath", "glitchPath", "datamoshPath",
  "posterizePath", "oilPath", "sketchPath", "pixelPath",
];
