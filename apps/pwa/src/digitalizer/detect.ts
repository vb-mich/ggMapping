// Border detection — a convenience, never a correctness requirement: the four
// vertices stay draggable whatever this returns, and a failure just means the
// default quad. Hand-rolled and dependency-free (a few KB) instead of a
// vision library (megabytes): the subject is a bright sheet of paper on a
// darker table, which a brightness threshold separates well.
//
// This module is loaded ONLY via dynamic import from the scan flow, so it
// lives in its own lazy chunk, out of the app shell.
//
// Method: grayscale → 3×3 box blur → Otsu threshold → largest bright
// connected component → convex hull → the hull simplified to its most
// area-preserving points → the maximum-area quad among them.
import { orderQuad, quadArea, isConvex, type Pt, type Quad } from "./geometry";
import type { Raster } from "./raster";

export function detectQuad(img: Raster): Quad | null {
  const { width: w, height: h } = img;
  if (w < 16 || h < 16) return null;

  const gray = grayBlur(img);
  const threshold = otsu(gray);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] > threshold ? 1 : 0;

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

function otsu(gray: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
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
