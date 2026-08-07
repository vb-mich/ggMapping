// Pure raster operations over RGBA buffers — the testable core of the scan
// pipeline. Everything here runs identically in node (unit tests) and in the
// browser (the pipeline feeds it ImageData buffers).
import { homography, type Mat3, type Quad, applyH } from "./geometry";

export interface Raster {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA, row-major
}

export function makeRaster(width: number, height: number): Raster {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

// Rectify: fill a w×h output by inverse-mapping through the homography that
// sends the output rectangle onto the source quad, sampling bilinearly.
export function warpPerspective(src: Raster, quad: Quad, w: number, h: number): Raster {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const H: Mat3 = homography(rect, quad);
  const out = makeRaster(w, h);
  const od = out.data;
  const sd = src.data;
  const sw = src.width;
  const sh = src.height;
  let o = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, o += 4) {
      // sample at the pixel center
      const p = applyH(H, { x: x + 0.5, y: y + 0.5 });
      const sx = p.x - 0.5;
      const sy = p.y - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const cx0 = clampi(x0, 0, sw - 1), cx1 = clampi(x1, 0, sw - 1);
      const cy0 = clampi(y0, 0, sh - 1), cy1 = clampi(y1, 0, sh - 1);
      const i00 = (cy0 * sw + cx0) * 4;
      const i10 = (cy0 * sw + cx1) * 4;
      const i01 = (cy1 * sw + cx0) * 4;
      const i11 = (cy1 * sw + cx1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx;
        const bot = sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx;
        od[o + c] = top * (1 - fy) + bot * fy;
      }
      od[o + 3] = 255;
    }
  }
  return out;
}

const clampi = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Scanner-style auto levels: the luminance histogram's 2nd and 98th
// percentiles become the black and white points.
export function autoLevels(r: Raster): { lo: number; hi: number } {
  const hist = new Uint32Array(256);
  const d = r.data;
  const n = r.width * r.height;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const lum = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    hist[lum]++;
  }
  const loCount = n * 0.02;
  const hiCount = n * 0.98;
  let acc = 0;
  let lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= loCount) { lo = v; break; }
  }
  acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= hiCount) { hi = v; break; }
  }
  if (hi - lo < 16) { lo = Math.max(0, lo - 8); hi = Math.min(255, hi + 8); } // flat image: leave it be
  return { lo, hi };
}

export interface Adjust {
  lo: number; // levels black point (auto)
  hi: number; // levels white point (auto)
  exposure: number; // -100..100, manual
  contrast: number; // -100..100, manual
  temperature?: number; // -100..100, manual: negative cools, positive warms
}

// One 256-entry LUT: levels stretch, then exposure shift, then a contrast
// curve around the midpoint. Applied per RGB channel.
export function buildLut(a: Adjust): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, a.hi - a.lo);
  const cf = 1 + a.contrast / 100; // 0..2
  // EXPOSURE AS A CURVE, not a shift. A linear offset (x += e) drives every
  // highlight to the same 255, so pushing exposure to find brushstrokes
  // bleaches the paper texture away. A gamma curve holds both ends fixed
  // and COMPRESSES what is between them: 0 stays 0, 1 stays 1, nothing
  // clips, and near zero it matches the old offset almost exactly — the
  // difference only appears at the extremes, which is where it was wrong.
  const gamma = Math.pow(2, -a.exposure / 50);
  for (let v = 0; v < 256; v++) {
    let x = (v - a.lo) / span; // levels
    x = clampi(x, 0, 1); // the curve needs a base in [0,1]
    x = Math.pow(x, gamma); // exposure
    x = (x - 0.5) * cf + 0.5; // contrast
    lut[v] = Math.round(clampi(x, 0, 1) * 255);
  }
  return lut;
}

// The identity levels: the straighten path's default, so that straightening
// changes GEOMETRY ONLY (the field ruling). Automatic levels remain what
// the Auto-fix button applies, deliberately.
export const NEUTRAL_LEVELS = { lo: 0, hi: 255 } as const;

// Per-channel LUTs: the shared curve above, plus WHITE BALANCE — a plain
// opposed shift of red and blue (no auto magic, per the field ruling).
// Negative temperature cools a yellow-evening photo; positive warms.
export interface ChannelLuts {
  r: Uint8ClampedArray;
  g: Uint8ClampedArray;
  b: Uint8ClampedArray;
}

export function buildLuts(a: Adjust): ChannelLuts {
  const g = buildLut(a);
  const t = ((a.temperature ?? 0) / 100) * 0.18; // ±18% of full scale
  const shift = Math.round(t * 255);
  const r = new Uint8ClampedArray(256);
  const b = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    r[v] = clampi(g[v] + shift, 0, 255);
    b[v] = clampi(g[v] - shift, 0, 255);
  }
  return { r, g, b };
}

export function applyLut(r: Raster, lut: Uint8ClampedArray): Raster {
  return applyLuts(r, { r: lut, g: lut, b: lut });
}

export function applyLuts(r: Raster, luts: ChannelLuts): Raster {
  const out = makeRaster(r.width, r.height);
  const s = r.data, d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    d[i] = luts.r[s[i]];
    d[i + 1] = luts.g[s[i + 1]];
    d[i + 2] = luts.b[s[i + 2]];
    d[i + 3] = s[i + 3];
  }
  return out;
}

// AUTO-FIX — the scanner look. Estimate the slowly-varying illumination per
// channel (the paper, the light, the color cast: everything that changes
// gently across the frame) and divide it out, so THE PAPER ITSELF DEFINES
// WHITE. A yellow evening, a shadow band, a vignette — all flatten in one
// move, and ink keeps its color because ink differs from its LOCAL
// background. This is what document scanners do behind their one button.
export function autoFix(r: Raster): Raster {
  const { width: w, height: h } = r;
  // the illumination field: a heavy blur, cheaply — shrink, blur, grow
  const smallW = Math.max(8, Math.round(w / 24));
  const smallH = Math.max(8, Math.round(h / 24));
  let field = resize(r, smallW, smallH);
  field = blur3(blur3(field));
  const up = resize(field, w, h);
  const out = makeRaster(w, h);
  const TARGET = 235; // paper lands just under pure white
  const FLOOR = 24; // never divide by darkness
  const s = r.data;
  const f = up.data;
  const d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    d[i] = Math.min(255, Math.round((s[i] * TARGET) / Math.max(FLOOR, f[i])));
    d[i + 1] = Math.min(255, Math.round((s[i + 1] * TARGET) / Math.max(FLOOR, f[i + 1])));
    d[i + 2] = Math.min(255, Math.round((s[i + 2] * TARGET) / Math.max(FLOOR, f[i + 2])));
    d[i + 3] = s[i + 3];
  }
  return out;
}

function blur3(r: Raster): Raster {
  const { width: w, height: h, data } = r;
  const out = makeRaster(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sr = 0, sg = 0, sb = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const i = (yy * w + xx) * 4;
          sr += data[i];
          sg += data[i + 1];
          sb += data[i + 2];
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = sr / 9;
      out.data[o + 1] = sg / 9;
      out.data[o + 2] = sb / 9;
      out.data[o + 3] = 255;
    }
  }
  return out;
}

// Rotate a quarter turn clockwise: a sideways photo becomes an upright one.
export function rotate90(r: Raster): Raster {
  const { width: w, height: h, data } = r;
  const out = makeRaster(h, w);
  const od = out.data;
  for (let y = 0; y < w; y++) {
    // dst row y comes from src column y
    for (let x = 0; x < h; x++) {
      const src = ((h - 1 - x) * w + y) * 4;
      const dst = (y * h + x) * 4;
      od[dst] = data[src];
      od[dst + 1] = data[src + 1];
      od[dst + 2] = data[src + 2];
      od[dst + 3] = data[src + 3];
    }
  }
  return out;
}

// Downscale by iterative bilinear halving (avoids undersampling on the deep
// reduction to a thumbnail), then one bilinear pass to the exact size.
export function resize(r: Raster, w: number, h: number): Raster {
  let cur = r;
  while (cur.width >= w * 2 && cur.height >= h * 2) {
    cur = bilinear(cur, Math.round(cur.width / 2), Math.round(cur.height / 2));
  }
  if (cur.width !== w || cur.height !== h) cur = bilinear(cur, w, h);
  return cur;
}

function bilinear(src: Raster, w: number, h: number): Raster {
  const out = makeRaster(w, h);
  const sd = src.data, od = out.data;
  const sw = src.width, sh = src.height;
  const rx = sw / w, ry = sh / h;
  let o = 0;
  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) * ry - 0.5;
    const y0 = clampi(Math.floor(sy), 0, sh - 1);
    const y1 = clampi(y0 + 1, 0, sh - 1);
    const fy = clampi(sy - y0, 0, 1);
    for (let x = 0; x < w; x++, o += 4) {
      const sx = (x + 0.5) * rx - 0.5;
      const x0 = clampi(Math.floor(sx), 0, sw - 1);
      const x1 = clampi(x0 + 1, 0, sw - 1);
      const fx = clampi(sx - x0, 0, 1);
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 4; c++) {
        const top = sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx;
        const bot = sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx;
        od[o + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return out;
}
