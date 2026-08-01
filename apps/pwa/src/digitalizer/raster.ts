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
}

// One 256-entry LUT: levels stretch, then exposure shift, then a contrast
// curve around the midpoint. Applied per RGB channel.
export function buildLut(a: Adjust): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, a.hi - a.lo);
  const cf = 1 + a.contrast / 100; // 0..2
  for (let v = 0; v < 256; v++) {
    let x = (v - a.lo) / span; // levels
    x += a.exposure / 200; // exposure: ±0.5 across the slider
    x = (x - 0.5) * cf + 0.5; // contrast
    lut[v] = Math.round(clampi(x, 0, 1) * 255);
  }
  return lut;
}

export function applyLut(r: Raster, lut: Uint8ClampedArray): Raster {
  const out = makeRaster(r.width, r.height);
  const s = r.data, d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    d[i] = lut[s[i]];
    d[i + 1] = lut[s[i + 1]];
    d[i + 2] = lut[s[i + 2]];
    d[i + 3] = s[i + 3];
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
