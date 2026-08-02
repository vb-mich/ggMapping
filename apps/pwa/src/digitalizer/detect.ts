// Border detection — a convenience, never a correctness requirement: the four
// vertices stay draggable whatever this returns, and a failure just means the
// default quad. Hand-rolled and dependency-free (a few KB) instead of a
// vision library (megabytes of WASM).
//
// This module is loaded ONLY via dynamic import from the scan flow, so it
// lives in its own lazy chunk, out of the app shell.
//
// Method, first pass — COLOR, not brightness: the table's chromaticity is
// estimated from the frame's border ring (median), every pixel is scored by
// its chromatic distance from that background, and Otsu splits the scores.
// Chromaticity survives what brightness does not: white paper on a light
// wooden table, and the soft shadow bands a phone at a table always casts
// (shade dims a surface but barely shifts its hue). Second pass, when color
// finds nothing: the plain brightness threshold (a bright sheet on a truly
// dark table with a neutral-colored surface). Both passes end the same way:
// largest connected component → convex hull → maximum-area quad.
import { orderQuad, quadArea, isConvex, type Pt, type Quad } from "./geometry";
import type { Raster } from "./raster";

export function detectQuad(img: Raster): Quad | null {
  const { width: w, height: h } = img;
  if (w < 16 || h < 16) return null;
  return (
    maskToQuad(chromaMask(img), w, h) ?? maskToQuad(brightnessMask(img), w, h)
  );
}

// --- pass one: chromatic distance from the table -----------------------------

function chromaMask(img: Raster): Uint8Array {
  const { width: w, height: h, data } = img;
  const n = w * h;
  const rn = new Float32Array(n);
  const gn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const sum = data[j] + data[j + 1] + data[j + 2] + 3;
    rn[i] = data[j] / sum;
    gn[i] = data[j + 1] / sum;
  }

  // the background: the border ring's chromaticity (robust as long as the
  // sheet covers less than half of the frame's edge)
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.05));
  const ringR: number[] = [];
  const ringG: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && x < w - ring && y >= ring && y < h - ring) continue;
      const i = y * w + x;
      ringR.push(rn[i]);
      ringG.push(gn[i]);
    }
  }
  // A table often wears TWO lights — shade and a sunlit band. One median
  // pretends they are one color; the washed-out band then reads as "not
  // table" and bleeds into the sheet's component (the lost-corner bug). So
  // the background is up to two chroma clusters, and a pixel scores by its
  // distance to the NEAREST one.
  const centers = backgroundCenters(ringR, ringG);

  const score = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let d = Infinity;
    for (const c of centers) {
      const dc = Math.hypot(rn[i] - c.r, gn[i] - c.g);
      if (dc < d) d = dc;
    }
    d *= 2000; // into byte range for Otsu
    score[i] = d > 255 ? 255 : d;
  }
  // a floor keeps sensor noise from becoming "foreground" on a bare table
  const threshold = Math.max(otsu(score), 14);
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = score[i] > threshold ? 1 : 0;
  // open (specks off), then close (pinholes from print and text filled)
  return morphClose(morphOpen(mask, w, h), w, h);
}

// Two-means over the ring's chromaticity. Seeds: the median point, and the
// ring point at the 95th percentile of distance from it. Guards: a second
// cluster must earn at least 10% of the ring (a sheet corner grazing the
// border may not hijack the background), and must sit measurably apart —
// otherwise the ring is one color and one center serves, exactly as before.
function backgroundCenters(
  ringR: number[],
  ringG: number[],
): { r: number; g: number }[] {
  const m = ringR.length;
  const c1 = { r: median(ringR), g: median(ringG) };
  const dist = ringR.map((r, i) => Math.hypot(r - c1.r, ringG[i] - c1.g));
  const order = [...dist].sort((a, b) => a - b);
  const far = order[Math.min(m - 1, Math.floor(m * 0.95))];
  const seedIdx = dist.findIndex((d) => d >= far);
  const c2 = { r: ringR[seedIdx], g: ringG[seedIdx] };

  let share2 = 0;
  for (let iter = 0; iter < 8; iter++) {
    let r1 = 0, g1 = 0, n1 = 0, r2 = 0, g2 = 0, n2 = 0;
    for (let i = 0; i < m; i++) {
      const d1 = Math.hypot(ringR[i] - c1.r, ringG[i] - c1.g);
      const d2 = Math.hypot(ringR[i] - c2.r, ringG[i] - c2.g);
      if (d1 <= d2) { r1 += ringR[i]; g1 += ringG[i]; n1++; }
      else { r2 += ringR[i]; g2 += ringG[i]; n2++; }
    }
    if (!n1 || !n2) { share2 = 0; break; }
    c1.r = r1 / n1; c1.g = g1 / n1;
    c2.r = r2 / n2; c2.g = g2 / n2;
    share2 = n2 / m;
  }
  const apart = Math.hypot(c1.r - c2.r, c1.g - c2.g) > 0.015;
  return share2 >= 0.1 && apart ? [c1, c2] : [c1];
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

// --- pass two: plain brightness ----------------------------------------------

function brightnessMask(img: Raster): Uint8Array {
  const gray = grayBlur(img);
  const threshold = otsu(gray);
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] > threshold ? 1 : 0;
  return mask;
}

function grayBlur(img: Raster): Uint8Array {
  const { width: w, height: h, data } = img;
  const g = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    g[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  // 3×3 box blur, borders clamped
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          sum += g[yy * w + xx];
        }
      }
      out[y * w + x] = sum / 9;
    }
  }
  return out;
}

function otsu(values: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (const v of values) hist[v]++;
  const total = values.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 127;
  let bestVar = -1;
  for (let v = 0; v < 256; v++) {
    wB += hist[v];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = v;
    }
  }
  return best;
}

// --- 3×3 morphology ----------------------------------------------------------

function erode(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] =
        mask[i] &&
        (x === 0 || mask[i - 1]) && (x === w - 1 || mask[i + 1]) &&
        (y === 0 || mask[i - w]) && (y === h - 1 || mask[i + w])
          ? 1
          : 0;
    }
  }
  return out;
}

function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] =
        mask[i] ||
        (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) ||
        (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w])
          ? 1
          : 0;
    }
  }
  return out;
}

const morphOpen = (m: Uint8Array, w: number, h: number) => dilate(erode(m, w, h), w, h);
const morphClose = (m: Uint8Array, w: number, h: number) => erode(dilate(m, w, h), w, h);

// --- mask → quad (shared tail of both passes) --------------------------------

function maskToQuad(mask: Uint8Array, w: number, h: number): Quad | null {
  const comp = largestComponent(mask, w, h);
  if (!comp || comp.size < w * h * 0.08) return null;

  const boundary = boundaryPoints(comp.mask, w, h);
  if (boundary.length < 4) return null;

  let hull = convexHull(boundary);
  if (hull.length < 4) return null;
  hull = simplifyHull(hull, 24);

  const quad = bestQuad(hull);
  if (!quad) return null;
  if (quadArea(quad) < w * h * 0.08) return null;
  return orderQuad(quad);
}

function largestComponent(
  mask: Uint8Array,
  w: number,
  h: number,
): { mask: Uint8Array; size: number } | null {
  const labels = new Int32Array(w * h); // 0 = unlabeled
  let next = 0;
  let bestLabel = 0;
  let bestSize = 0;
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start]) continue;
    next++;
    let size = 0;
    stack.push(start);
    labels[start] = next;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = next; stack.push(i - 1); }
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = next; stack.push(i + 1); }
      if (y > 0 && mask[i - w] && !labels[i - w]) { labels[i - w] = next; stack.push(i - w); }
      if (y < h - 1 && mask[i + w] && !labels[i + w]) { labels[i + w] = next; stack.push(i + w); }
    }
    if (size > bestSize) {
      bestSize = size;
      bestLabel = next;
    }
  }
  if (!bestLabel) return null;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = labels[i] === bestLabel ? 1 : 0;
  return { mask: out, size: bestSize };
}

function boundaryPoints(mask: Uint8Array, w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (
        x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]
      ) {
        pts.push({ x, y });
      }
    }
  }
  return pts;
}

// Andrew's monotone chain, counterclockwise in math coords (clockwise on
// screen, matching orderQuad's winding).
function convexHull(pts: Pt[]): Pt[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (s.length <= 3) return s;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Drop hull points whose removal loses the least area until `max` remain —
// keeps the extreme corners, cheapens the quad search.
function simplifyHull(hull: Pt[], max: number): Pt[] {
  const pts = [...hull];
  const triArea = (a: Pt, b: Pt, c: Pt) =>
    Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  while (pts.length > max) {
    let worst = 0;
    let worstLoss = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const loss = triArea(
        pts[(i + pts.length - 1) % pts.length],
        pts[i],
        pts[(i + 1) % pts.length],
      );
      if (loss < worstLoss) {
        worstLoss = loss;
        worst = i;
      }
    }
    pts.splice(worst, 1);
  }
  return pts;
}

// The maximum-area quadrilateral with vertices on the (cyclically ordered)
// hull: brute force over 4-subsets in order — at most C(24,4) ≈ 10k areas.
function bestQuad(hull: Pt[]): Quad | null {
  const n = hull.length;
  if (n < 4) return null;
  if (n === 4) return [hull[0], hull[1], hull[2], hull[3]];
  let best: Quad | null = null;
  let bestArea = 0;
  for (let a = 0; a < n - 3; a++)
    for (let b = a + 1; b < n - 2; b++)
      for (let c = b + 1; c < n - 1; c++)
        for (let d = c + 1; d < n; d++) {
          const q: Quad = [hull[a], hull[b], hull[c], hull[d]];
          const area = quadArea(q);
          if (area > bestArea && isConvex(q)) {
            bestArea = area;
            best = q;
          }
        }
  return best;
}
