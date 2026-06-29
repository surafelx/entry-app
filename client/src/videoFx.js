// Shared per-frame video FX so the editor preview and the export render
// identically: CSS color grade → pixelate → posterize/dither/duotone →
// overlays. Operating on a downscaled buffer keeps it fast (and that's what
// gives the chunky pixel/dither look anyway).

// 4×4 ordered (Bayer) dither matrix, values 0..15.
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

// One-click looks. Each is a partial FX config merged over the editor sliders.
export const STYLE_PRESETS = [
  { id: "none", label: "None", fx: { pixelSize: 1, posterize: 0, dither: "none", duotone: null } },
  { id: "cartoon", label: "Cartoon", fx: { pixelSize: 1, posterize: 5, dither: "none", duotone: null, saturation: 1.6, contrast: 1.35, brightness: 1.05 } },
  { id: "pixel", label: "Pixel", fx: { pixelSize: 8, posterize: 0, dither: "none", duotone: null, saturation: 1.3 } },
  { id: "dither", label: "Dither", fx: { pixelSize: 4, posterize: 3, dither: "bayer", duotone: null, saturation: 1.2, contrast: 1.2 } },
  { id: "comic", label: "Comic", fx: { pixelSize: 1, posterize: 4, dither: "none", duotone: null, contrast: 1.5, saturation: 1.7, brightness: 1.1 } },
  { id: "retro", label: "Retro", fx: { pixelSize: 6, posterize: 4, dither: "bayer", duotone: null, sepia: 0.3, saturation: 1.2 } },
  { id: "gameboy", label: "Game Boy", fx: { pixelSize: 6, posterize: 4, dither: "bayer", duotone: ["#0f380f", "#9bbc0f"], saturation: 1 } },
];

const hexToRgb = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function buildFilter(o = {}) {
  const f = [];
  if (o.brightness != null && o.brightness !== 1) f.push(`brightness(${o.brightness})`);
  if (o.contrast != null && o.contrast !== 1) f.push(`contrast(${o.contrast})`);
  if (o.saturation != null && o.saturation !== 1) f.push(`saturate(${o.saturation})`);
  if (o.blur > 0) f.push(`blur(${o.blur}px)`);
  if (o.grayscale > 0) f.push(`grayscale(${o.grayscale})`);
  if (o.sepia > 0) f.push(`sepia(${o.sepia})`);
  if (o.hueRotate) f.push(`hue-rotate(${o.hueRotate}deg)`);
  return f.length ? f.join(" ") : "none";
}

// cached scratch buffers keyed off the destination canvas
function buffers(canvas) {
  if (!canvas._fx) {
    const buf = document.createElement("canvas");
    canvas._fx = { buf, ctx: buf.getContext("2d", { willReadFrequently: true }) };
  }
  return canvas._fx;
}

// cached grain tile
let grainTile;
function noiseTile() {
  if (grainTile) return grainTile;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const img = x.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

export function processFrame(video, canvas, ctx, o = {}) {
  const W = canvas.width;
  const H = canvas.height;
  const filter = buildFilter(o);
  const px = Math.max(1, o.pixelSize || 1);
  const levels = o.posterize > 1 ? o.posterize : 0;
  const dither = o.dither && o.dither !== "none";
  const duo = o.duotone ? [hexToRgb(o.duotone[0]), hexToRgb(o.duotone[1])] : null;
  const pixelFx = px > 1 || levels || dither || duo;

  if (!pixelFx) {
    ctx.filter = filter;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(video, 0, 0, W, H);
    ctx.filter = "none";
  } else {
    // working resolution: divide by pixel size, else cap to keep it cheap
    let bw, bh, smooth;
    if (px > 1) {
      bw = Math.max(1, Math.round(W / px));
      bh = Math.max(1, Math.round(H / px));
      smooth = false; // crisp blocks
    } else {
      const cap = 480;
      const s = Math.min(1, cap / W);
      bw = Math.round(W * s);
      bh = Math.round(H * s);
      smooth = true; // smooth cartoon
    }

    const { buf, ctx: bctx } = buffers(canvas);
    if (buf.width !== bw || buf.height !== bh) {
      buf.width = bw;
      buf.height = bh;
    }
    bctx.filter = filter;
    bctx.imageSmoothingEnabled = true;
    bctx.drawImage(video, 0, 0, bw, bh);
    bctx.filter = "none";

    if (levels || dither || duo) {
      const L = levels || 4;
      const img = bctx.getImageData(0, 0, bw, bh);
      const d = img.data;
      for (let y = 0; y < bh; y++) {
        for (let x = 0; x < bw; x++) {
          const i = (y * bw + x) * 4;
          let r = d[i], g = d[i + 1], b = d[i + 2];
          const t = dither ? (BAYER4[y & 3][x & 3] / 16 - 0.5) : 0;
          if (duo) {
            let lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255 + t / L;
            if (levels) lum = Math.round(lum * (L - 1)) / (L - 1);
            lum = lum < 0 ? 0 : lum > 1 ? 1 : lum;
            r = duo[0][0] + (duo[1][0] - duo[0][0]) * lum;
            g = duo[0][1] + (duo[1][1] - duo[0][1]) * lum;
            b = duo[0][2] + (duo[1][2] - duo[0][2]) * lum;
          } else {
            const off = t * (255 / L);
            r = quant(r + off, L);
            g = quant(g + off, L);
            b = quant(b + off, L);
          }
          d[i] = clamp(r);
          d[i + 1] = clamp(g);
          d[i + 2] = clamp(b);
        }
      }
      bctx.putImageData(img, 0, 0);
    }

    ctx.imageSmoothingEnabled = smooth;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(buf, 0, 0, bw, bh, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
  }

  // ---- overlays ----
  if (o.overlayText) drawText(ctx, W, H, o);
  if (o.grain) drawGrain(ctx, W, H, typeof o.grain === "number" ? o.grain : 0.08);
  if (o.vignette !== false) drawVignette(ctx, W, H);
}

const quant = (v, L) => Math.round((clamp(v) / 255) * (L - 1)) / (L - 1) * 255;

function drawText(ctx, W, H, o) {
  ctx.filter = "none";
  ctx.fillStyle = o.overlayColor || "#fff";
  const size = o.overlaySize || 48;
  ctx.font = `bold ${size}px "Syne", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const y = o.overlayPosition === "top" ? size + 20 : o.overlayPosition === "center" ? H / 2 : H - size;
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  ctx.fillText(o.overlayText, W / 2, y);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function drawGrain(ctx, W, H, alpha) {
  const tile = noiseTile();
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "overlay";
  const ox = (Math.random() * 128) | 0;
  const oy = (Math.random() * 128) | 0;
  for (let x = -ox; x < W; x += 128)
    for (let y = -oy; y < H; y += 128) ctx.drawImage(tile, x, y);
  ctx.restore();
}

function drawVignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H / 2, W * 0.25, W / 2, H / 2, W * 0.72);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}
