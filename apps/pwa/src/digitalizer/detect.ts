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
  // Candidate FAMILIES, fused — the architecture of the scanners we
  // benchmark against. Edges (Canny → Hough → scored quads) see what color
  // cannot: a sheet's boundary is a long straight edge whatever surrounds
  // it. Color segmentation (chroma clusters) sees what edges cannot: a
  // faint boundary with a distinct hue. Brightness is the last resort. All
  // candidates compete under ONE scoring, and families that agree (IOU)
  // vouch for each other.
  const { edges, luma } = sobelEdges(img);
  const near = dilateBits(edges, w, h);
  const lumaMid = medianLuma(luma);

  const cands: { quad: Quad; score: number; family: string }[] = [];
  const hough = houghBest(img, edges, near, luma, lumaMid);
  if (hough) cands.push({ ...hough, family: "edges" });
  const chromaQuad = maskToQuad(chromaMask(img), w, h);
  if (chromaQuad) {
    cands.push({
      quad: chromaQuad,
      score: scoreQuad(chromaQuad, near, luma, w, h, lumaMid),
      family: "chroma",
    });
  }
  const brightQuad = maskToQuad(brightnessMask(img), w, h);
  if (brightQuad) {
    cands.push({
      quad: brightQuad,
      score: scoreQuad(brightQuad, near, luma, w, h, lumaMid),
      family: "bright",
    });
  }
  for (const c of cands) {
    for (const o of cands) {
      if (o.family !== c.family && quadIOU(c.quad, o.quad) >= 0.75) {
        c.score += 0.08; // independent eyes agree on this sheet
        break;
      }
    }
  }
  houghDebug?.("fused", cands.map((c) => ({ family: c.family, score: +c.score.toFixed(3) })));
  const passing = cands
    .filter((c) => c.score >= 0.62)
    .sort((a, b) => b.score - a.score);
  if (passing.length) return orderQuad(passing[0].quad);
  // nothing clears the floor: segmentation still serves, as it always did —
  // a soft-edged sheet with a distinct hue has no edges to score
  return chromaQuad ?? brightQuad;
}

// Approximate intersection-over-union of two convex quads, by sampling.
export function quadIOU(a: Quad, b: Quad): number {
  const xs = [...a, ...b].map((p) => p.x);
  const ys = [...a, ...b].map((p) => p.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  if (x1 <= x0 || y1 <= y0) return 0;
  const N = 48;
  let inA = 0;
  let inB = 0;
  let both = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / N;
      const y = y0 + ((y1 - y0) * (j + 0.5)) / N;
      const pa = inConvex(a, x, y);
      const pb = inConvex(b, x, y);
      if (pa) inA++;
      if (pb) inB++;
      if (pa && pb) both++;
    }
  }
  const union = inA + inB - both;
  return union ? both / union : 0;
}

function inConvex(q: Quad, x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    const cross = (n.x - p.x) * (y - p.y) - (n.y - p.y) * (x - p.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// --- pass one: edges, lines, and the best-supported quad ---------------------
// Sobel magnitude → the strongest ~10% become edge pixels → a coarse Hough
// transform finds the dominant straight lines → quads are assembled from two
// near-parallel pairs and scored by how much of their perimeter lies on real
// edges, plus a brighter-inside-than-outside prior (paper is bright). All
// integer-friendly, deterministic, and a few kilobytes.

interface HLine {
  theta: number; // radians, 0..π
  rho: number; // px
  votes: number;
}

const THETA_STEPS = 90; // 2° resolution
const RHO_STEP = 2;

// Debug hook for the local diagnostic harness: receives the Hough lines and
// every scored candidate. Never set in the app itself.
export let houghDebug: ((tag: string, payload: unknown) => void) | null = null;
export function setHoughDebug(fn: typeof houghDebug): void {
  houghDebug = fn;
}

// The floor-applying wrapper kept for the diagnostic harness.
export function houghQuad(img: Raster): Quad | null {
  const { edges, luma } = sobelEdges(img);
  const near = dilateBits(edges, img.width, img.height);
  const best = houghBest(img, edges, near, luma, medianLuma(luma));
  return best && best.score >= 0.62 ? best.quad : null;
}

// The coarse edge map — thick bands from a raw percentile threshold. Canny
// starves on pages dense with print (its adaptive bar rises past the sheet's
// own boundary); the coarse map bridges text gaps with fat bands. Both maps
// feed the line pool; scoring stays on Canny's strict map.
export function coarseEdges(luma: Uint8Array, w: number, h: number): Uint8Array {
  const mag = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        luma[i - w + 1] + 2 * luma[i + 1] + luma[i + w + 1] -
        (luma[i - w - 1] + 2 * luma[i - 1] + luma[i + w - 1]);
      const gy =
        luma[i + w - 1] + 2 * luma[i + w] + luma[i + w + 1] -
        (luma[i - w - 1] + 2 * luma[i - w] + luma[i - w + 1]);
      const m = (Math.abs(gx) + Math.abs(gy)) >> 2;
      const v = m > 255 ? 255 : m;
      mag[i] = v;
      hist[v]++;
    }
  }
  const total = (w - 2) * (h - 2);
  let acc = 0;
  let threshold = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.9) {
      threshold = v;
      break;
    }
  }
  if (threshold < 10) threshold = 10;
  const edges = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) edges[i] = mag[i] >= threshold ? 1 : 0;
  return edges;
}

function medianLuma(luma: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (const v of luma) hist[v]++;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= luma.length / 2) return v;
  }
  return 128;
}

function houghBest(
  img: Raster,
  edges: Uint8Array,
  near: Uint8Array,
  luma: Uint8Array,
  lumaMid: number,
): { quad: Quad; score: number } | null {
  const { width: w, height: h } = img;

  // two line generators — Canny's thin truth and the coarse bands —
  // deduplicated into one pool (the ensemble idea, applied to edges)
  const lines = [...houghLines(edges, w, h)];
  for (const l of houghLines(coarseEdges(luma, w, h), w, h)) {
    const dup = lines.some(
      (o) =>
        Math.abs(o.rho - l.rho) <= 3 * RHO_STEP &&
        Math.min(
          Math.abs(o.theta - l.theta),
          Math.PI - Math.abs(o.theta - l.theta),
        ) <=
          (3 * Math.PI) / THETA_STEPS,
    );
    if (!dup) lines.push(l);
  }
  houghDebug?.("lines", lines);
  if (lines.length < 4) return null;

  // group angles: two near-parallel pairs, the pairs well apart
  const angDist = (a: number, b: number) => {
    let d = Math.abs(a - b) % Math.PI;
    return d > Math.PI / 2 ? Math.PI - d : d;
  };
  const PARALLEL = (25 * Math.PI) / 180;
  const APART = (50 * Math.PI) / 180;

  let best: Quad | null = null;
  let bestScore = 0;
  const n = lines.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      if (angDist(lines[a].theta, lines[b].theta) > PARALLEL) continue;
      for (let c = 0; c < n; c++) {
        if (c === a || c === b) continue;
        const meanAB =
          lines[a].theta + angDist(lines[a].theta, lines[b].theta) / 2;
        if (angDist(meanAB, lines[c].theta) < APART) continue;
        for (let d = c + 1; d < n; d++) {
          if (d === a || d === b) continue;
          if (angDist(lines[c].theta, lines[d].theta) > PARALLEL) continue;
          const quad = quadOf(lines[a], lines[b], lines[c], lines[d], w, h);
          if (!quad) continue;
          const score = scoreQuad(quad, near, luma, w, h, lumaMid);
          if (score > 0.4) houghDebug?.("candidate", { quad, score });
          if (score > bestScore) {
            bestScore = score;
            best = quad;
          }
        }
      }
    }
  // no floor here: the fusion in detectQuad applies it after the families
  // have exchanged their agreement bonuses
  return best ? { quad: orderQuad(best), score: bestScore } : null;
}

// True Canny, the way the scanners we envy do it: Sobel gradients, thinning
// by non-maximum suppression along the gradient direction, then a double
// threshold with hysteresis so weak edge segments survive only when they
// touch strong ones. Exported for the unit suite.
export function sobelEdges(img: Raster): { edges: Uint8Array; luma: Uint8Array } {
  const { width: w, height: h, data } = img;
  const luma = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    luma[i] = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
  }
  // Canny's first step is SMOOTHING — without it, sensor noise and wood
  // grain survive non-maximum suppression as ridge chains. Two 3×3 box
  // passes approximate a Gaussian.
  let g = luma;
  for (let pass = 0; pass < 2; pass++) {
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
    g = out;
  }
  const mag = new Uint16Array(w * h);
  const dir = new Uint8Array(w * h); // 0: E-W, 1: NE-SW, 2: N-S, 3: NW-SE
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] -
        (g[i - w - 1] + 2 * g[i - 1] + g[i + w - 1]);
      const gy =
        g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] -
        (g[i - w - 1] + 2 * g[i - w] + g[i - w + 1]);
      mag[i] = Math.abs(gx) + Math.abs(gy);
      const ax = Math.abs(gx);
      const ay = Math.abs(gy);
      // quantized gradient direction (tan 22.5° ≈ 0.414, tan 67.5° ≈ 2.414)
      if (ay * 1000 <= ax * 414) dir[i] = 0;
      else if (ay * 414 >= ax * 1000) dir[i] = 2;
      else dir[i] = (gx > 0) === (gy > 0) ? 3 : 1;
    }
  }
  // non-maximum suppression: an edge pixel beats both neighbors along its
  // gradient, leaving one-pixel-thin lines
  const OFF = [1, w - 1, w, w + 1]; // E, SW→NE mirror, S, SE
  const thin = new Uint16Array(w * h);
  const hist = new Uint32Array(1024);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (!m) continue;
      const o = OFF[dir[i]];
      if (m >= mag[i - o] && m >= mag[i + o]) {
        thin[i] = m;
        hist[m > 1023 ? 1023 : m]++;
      }
    }
  }
  // double threshold from the surviving magnitudes' distribution
  let surviving = 0;
  for (const c of hist) surviving += c;
  let acc = 0;
  let high = 1023;
  for (let v = 0; v < 1024; v++) {
    acc += hist[v];
    if (acc >= surviving * 0.7) {
      high = v;
      break;
    }
  }
  if (high < 60) high = 60;
  // a page dense with print must not raise the bar past its own boundary:
  // the sheet's edge against a hand is moderate contrast, and it is the
  // one edge that matters
  if (high > 140) high = 140;
  const low = Math.max(24, high >> 1);
  // hysteresis: strong pixels seed, weak pixels join only by connection
  const edges = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (thin[i] >= high && !edges[i]) {
      edges[i] = 1;
      stack.push(i);
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % w;
        const py = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = px + dx;
            const ny = py + dy;
            if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
            const n = ny * w + nx;
            if (!edges[n] && thin[n] >= low) {
              edges[n] = 1;
              stack.push(n);
            }
          }
        }
      }
    }
  }
  return { edges, luma };
}

function dilateBits(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] =
        mask[i] ||
        (x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) ||
        (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w])
          ? 1
          : 0;
    }
  return out;
}

function houghLines(edges: Uint8Array, w: number, h: number): HLine[] {
  const diag = Math.ceil(Math.hypot(w, h));
  const rhoBins = Math.ceil((2 * diag) / RHO_STEP);
  const acc = new Uint32Array(THETA_STEPS * rhoBins);
  const cosT = new Float32Array(THETA_STEPS);
  const sinT = new Float32Array(THETA_STEPS);
  for (let t = 0; t < THETA_STEPS; t++) {
    const theta = (t * Math.PI) / THETA_STEPS;
    cosT[t] = Math.cos(theta);
    sinT[t] = Math.sin(theta);
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!edges[y * w + x]) continue;
      for (let t = 0; t < THETA_STEPS; t++) {
        const rho = x * cosT[t] + y * sinT[t];
        const r = Math.round((rho + diag) / RHO_STEP);
        acc[t * rhoBins + r]++;
      }
    }
  // Peaks with a non-max window — extracted SEPARATELY for near-horizontal
  // and near-vertical lines, so a page dense with printed text (whose
  // baselines are all horizontal) cannot monopolize every slot and starve
  // the sheet's own left and right edges.
  const lines: HLine[] = [];
  const minVotes = Math.max(25, Math.min(w, h) * 0.18);
  const QUARTER = THETA_STEPS / 4; // 45°
  const isVertical = (t: number) => t < QUARTER || t >= 3 * QUARTER;
  for (const wantVertical of [true, false]) {
    for (let k = 0; k < 7; k++) {
      let bi = -1;
      let bv = 0;
      for (let i = 0; i < acc.length; i++) {
        if (acc[i] > bv && isVertical((i / rhoBins) | 0) === wantVertical) {
          bv = acc[i];
          bi = i;
        }
      }
      if (bi < 0 || bv < minVotes) break;
      const t = (bi / rhoBins) | 0;
      const r = bi % rhoBins;
      lines.push({
        theta: (t * Math.PI) / THETA_STEPS,
        rho: r * RHO_STEP - diag,
        votes: bv,
      });
      for (let dt = -3; dt <= 3; dt++) {
        const tt = t + dt;
        if (tt < 0 || tt >= THETA_STEPS) continue;
        for (let dr = -6; dr <= 6; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= rhoBins) continue;
          acc[tt * rhoBins + rr] = 0;
        }
      }
    }
  }
  return lines;
}

function intersect(l1: HLine, l2: HLine): Pt | null {
  const c1 = Math.cos(l1.theta), s1 = Math.sin(l1.theta);
  const c2 = Math.cos(l2.theta), s2 = Math.sin(l2.theta);
  const det = c1 * s2 - s1 * c2;
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (l1.rho * s2 - l2.rho * s1) / det,
    y: (l2.rho * c1 - l1.rho * c2) / det,
  };
}

function quadOf(a: HLine, b: HLine, c: HLine, d: HLine, w: number, h: number): Quad | null {
  const p1 = intersect(a, c);
  const p2 = intersect(a, d);
  const p3 = intersect(b, d);
  const p4 = intersect(b, c);
  if (!p1 || !p2 || !p3 || !p4) return null;
  const pts = [p1, p2, p3, p4];
  // corners may poke slightly out of frame, never wildly
  for (const p of pts) {
    if (p.x < -0.08 * w || p.x > 1.08 * w || p.y < -0.08 * h || p.y > 1.08 * h) return null;
  }
  const quad = orderQuad(pts);
  if (!isConvex(quad)) return null;
  if (quadArea(quad) < w * h * 0.1) return null;
  return quad;
}

export function scoreQuad(
  quad: Quad,
  near: Uint8Array,
  luma: Uint8Array,
  w: number,
  h: number,
  lumaMid = 128,
): number {
  // Per side: edge support (fraction of samples on a dilated edge) and the
  // LOCAL BRIGHTNESS STEP across the line — a true sheet boundary is
  // brighter just inside than just outside, on EVERY side. This is what an
  // inner printed rectangle (paper both sides) and a floor-plank seam (wood
  // both sides) cannot fake.
  let minSide = 1;
  let supportTotal = 0;
  let stepTotal = 0;
  let minStep = Infinity;
  let positives = 0;
  let flats = 0;
  let brightIn = 0;
  let continuation = 0;
  const cornerEnds = new Float32Array(8);
  for (let e = 0; e < 4; e++) {
    const a = quad[e];
    const b = quad[(e + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 8) return 0;
    const steps = Math.max(12, Math.min(60, Math.round(len / 4)));
    // outward normal: for a clockwise quad in screen coords (y down), the
    // outside of side a→b lies along (+dy, −dx)
    const nx = (b.y - a.y) / len;
    const ny = -(b.x - a.x) / len;
    let hit = 0;
    let inSum = 0;
    let outSum = 0;
    let n = 0;
    for (let s = 0; s <= steps; s++) {
      const x = a.x + ((b.x - a.x) * s) / steps;
      const y = a.y + ((b.y - a.y) * s) / steps;
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi >= 0 && yi >= 0 && xi < w && yi < h && near[yi * w + xi]) hit++;
      const ix = Math.round(x - nx * 5);
      const iy = Math.round(y - ny * 5);
      const ox = Math.round(x + nx * 5);
      const oy = Math.round(y + ny * 5);
      if (
        ix >= 0 && iy >= 0 && ix < w && iy < h &&
        ox >= 0 && oy >= 0 && ox < w && oy < h
      ) {
        inSum += luma[iy * w + ix];
        outSum += luma[oy * w + ox];
        n++;
      }
    }
    const side = hit / (steps + 1);
    if (side < minSide) minSide = side;
    supportTotal += side;
    // corners are where two edges MEET: the last stretch of each side
    // approaching its corners must itself lie on edges. A corner floating
    // in clear air (a slanted line that left the sheet) fails here.
    const endN = Math.max(2, Math.round(steps * 0.15));
    let endHitsA = 0;
    let endHitsB = 0;
    for (let s = 0; s <= endN; s++) {
      const ta = s / steps;
      const xa = Math.round(a.x + (b.x - a.x) * ta);
      const ya = Math.round(a.y + (b.y - a.y) * ta);
      if (xa >= 0 && ya >= 0 && xa < w && ya < h && near[ya * w + xa]) endHitsA++;
      const tb = 1 - s / steps;
      const xb = Math.round(a.x + (b.x - a.x) * tb);
      const yb = Math.round(a.y + (b.y - a.y) * tb);
      if (xb >= 0 && yb >= 0 && xb < w && yb < h && near[yb * w + xb]) endHitsB++;
    }
    cornerEnds[e * 2] = endHitsA / (endN + 1);
    cornerEnds[e * 2 + 1] = endHitsB / (endN + 1);
    const inMean = n ? inSum / n : 0;
    const step = n ? (inSum - outSum) / n : 0;
    if (step < minStep) minStep = step;
    if (step >= 8) positives++;
    if (Math.abs(step) < 8) flats++;
    stepTotal += Math.max(-30, Math.min(80, step));
    // a document's side has PAPER just inside it: a margin brighter than
    // the scene at large. Relative to the frame's median, because a
    // shadowed indoor sheet and a sunlit one share no absolute number.
    brightIn += Math.max(0, Math.min(1, (inMean - lumaMid) / 50));
    // a document's edge ENDS at its corners. A side whose line keeps riding
    // on edges beyond either corner is a line cut out of something longer —
    // a section break inside a busy sheet, a furniture line, a floor seam.
    const extLen = Math.max(8, len * 0.18);
    const extSteps = 10;
    let contA = 0;
    let contB = 0;
    for (let s = 1; s <= extSteps; s++) {
      const t = (extLen * s) / extSteps / len;
      const ax = Math.round(a.x - (b.x - a.x) * t);
      const ay = Math.round(a.y - (b.y - a.y) * t);
      if (ax >= 0 && ay >= 0 && ax < w && ay < h && near[ay * w + ax]) contA++;
      const bx = Math.round(b.x + (b.x - a.x) * t);
      const by = Math.round(b.y + (b.y - a.y) * t);
      if (bx >= 0 && by >= 0 && bx < w && by < h && near[by * w + bx]) contB++;
    }
    continuation += Math.max(contA, contB) / extSteps;
  }
  // A boundary steps down when crossed outward. Demanding it of every side
  // breaks on real scenes (a white shoe below the sheet, a sunlit hand
  // beside it), so: at least three sides step down, none STRONGLY inverted
  // — and a FLAT side (the same material on both sides: a grid stroke
  // inside the panel, an inner printed box, a floor seam) is punished
  // hard, because it is a line through the middle of something, not a
  // boundary. A side onto a brighter neighbor still counts as a boundary.
  const support = supportTotal / 4;
  const stepScore = Math.max(0, Math.min(1, stepTotal / 4 / 60));
  const area = quadArea(quad) / (w * h);
  houghDebug?.("score", {
    quad,
    support: +support.toFixed(2),
    minSide: +minSide.toFixed(2),
    minStep: +minStep.toFixed(1),
    positives,
    flats,
    brightIn: +(brightIn / 4).toFixed(2),
    continuation: +(continuation / 4).toFixed(2),
    stepScore: +stepScore.toFixed(2),
    area: +area.toFixed(2),
  });
  if (positives < 3 || minStep < -30) return 0;
  // the weakest corner: min over corners of the two side-ends meeting there
  // (corner k joins side k's end B with side (k+1)'s end A)
  let minCorner = 1;
  for (let k = 0; k < 4; k++) {
    const meet = Math.min(cornerEnds[k * 2 + 1], cornerEnds[((k + 1) % 4) * 2]);
    if (meet < minCorner) minCorner = meet;
  }
  // The document is the largest quad whose sides all behave like
  // boundaries: paper margins inside them, edges that END at the corners —
  // and edges that REACH the corners. The step is mostly a gate (with the
  // flat/continuation penalties): as a graded reward it once taught a quad
  // to dodge a white shoe by drifting off the sheet; support carries the
  // ranking, and area saturates — growing past three-fifths of the frame
  // buys nothing that support has not earned.
  return (
    support * 0.7 +
    minSide * 0.1 +
    stepScore * 0.08 +
    Math.min(area, 0.6) * 0.25 +
    (brightIn / 4) * 0.15 +
    minCorner * 0.12 -
    flats * 0.12 -
    (continuation / 4) * 0.4
  );
}

// --- pass two: chromatic distance from the table -----------------------------
// (chromaMask / brightnessMask / maskToQuad are exported for the local
// diagnostic harness and the unit suite — the field photos that shape this
// detector are diagnosed stage by stage, never by guesswork)

export function chromaMask(img: Raster): Uint8Array {
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

export function brightnessMask(img: Raster): Uint8Array {
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

export function maskToQuad(mask: Uint8Array, w: number, h: number): Quad | null {
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
