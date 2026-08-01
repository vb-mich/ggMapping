// Pure quad math for the scanner: ordering, homography, and the
// perspective-corrected aspect estimate. No DOM, no rules — the scanner is
// units- and size-agnostic by design: the true proportions of the photographed
// panel are recovered from the photo itself, never from a declared size.
export interface Pt {
  x: number;
  y: number;
}

// Ordered TL, TR, BR, BL in screen coordinates (y grows down).
export type Quad = [Pt, Pt, Pt, Pt];

// 3x3 row-major homography.
export type Mat3 = [number, number, number, number, number, number, number, number, number];

// Order four arbitrary corners into TL, TR, BR, BL: sort around the centroid
// (clockwise in screen coordinates), then start at the corner nearest the
// top-left (smallest x+y).
export function orderQuad(pts: Pt[]): Quad {
  if (pts.length !== 4) throw new Error("orderQuad needs 4 points");
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  // atan2 ascending is clockwise on screen (y down). Rotate so TL leads.
  let start = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  }
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as Quad;
}

export function isConvex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i], n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

// Solve the 8x8 linear system for the homography mapping src[i] -> dst[i].
export function homography(src: Quad, dst: Quad): Mat3 {
  // Rows of A·h = b with h = (h0..h7), h8 = 1.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve8(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// Gaussian elimination with partial pivoting.
function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error("degenerate quad");
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

export function applyH(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

// The aspect estimate (width/height of the true rectangle) from its four
// image corners — Zhang & He's whiteboard-scanning derivation, assuming the
// principal point at the image center and square pixels. When the quad is a
// parallelogram the perspective terms vanish and the affine ratio applies;
// when the estimate degenerates the caller falls back to naiveAspect.
export type AspectMethod = "perspective" | "affine" | "naive";

export function naiveAspect(q: Quad): number {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = (d(q[0], q[1]) + d(q[3], q[2])) / 2;
  const h = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
  return w / h;
}

export function estimateAspect(
  q: Quad,
  imageW: number,
  imageH: number,
): { ratio: number; method: AspectMethod } {
  const naive = naiveAspect(q);
  const fallback = { ratio: sane(naive) ? naive : 1, method: "naive" as const };

  // Homogeneous corners with the principal point at the origin.
  // Zhang's ordering: m1 = TL, m2 = TR, m3 = BL, m4 = BR.
  const u0 = imageW / 2, v0 = imageH / 2;
  const m1 = [q[0].x - u0, q[0].y - v0, 1];
  const m2 = [q[1].x - u0, q[1].y - v0, 1];
  const m3 = [q[3].x - u0, q[3].y - v0, 1];
  const m4 = [q[2].x - u0, q[2].y - v0, 1];

  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const c14 = cross(m1, m4);
  const k2d = dot(cross(m2, m4), m3);
  const k3d = dot(cross(m3, m4), m2);
  if (Math.abs(k2d) < 1e-9 || Math.abs(k3d) < 1e-9) return fallback;
  const k2 = dot(c14, m3) / k2d;
  const k3 = dot(c14, m2) / k3d;

  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];

  // Parallelogram: no perspective in either direction — the affine ratio is
  // exact and no focal length exists to estimate.
  const AFF = 1e-7;
  if (Math.abs(n2[2]) < AFF && Math.abs(n3[2]) < AFF) {
    const ratio = Math.hypot(n2[0], n2[1]) / Math.hypot(n3[0], n3[1]);
    return sane(ratio) ? { ratio, method: "affine" } : fallback;
  }

  const denom = n2[2] * n3[2];
  if (Math.abs(denom) < AFF) return fallback; // one vanishing point at infinity
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / denom;
  if (!Number.isFinite(f2) || f2 <= 0) return fallback;

  const num = (n2[0] * n2[0] + n2[1] * n2[1]) / f2 + n2[2] * n2[2];
  const den = (n3[0] * n3[0] + n3[1] * n3[1]) / f2 + n3[2] * n3[2];
  if (den <= 0 || num <= 0) return fallback;
  const ratio = Math.sqrt(num / den);
  return sane(ratio) ? { ratio, method: "perspective" } : fallback;
}

const sane = (r: number) => Number.isFinite(r) && r > 0.1 && r < 10;

// The quad offered when detection fails (or its chunk cannot load): centered,
// inset from the frame — a sensible start for dragging. Lives in the shell,
// not the lazy detection chunk, so the manual path never depends on it.
export function defaultQuad(w: number, h: number): Quad {
  const mx = w * 0.08;
  const my = h * 0.08;
  return [
    { x: mx, y: my },
    { x: w - mx, y: my },
    { x: w - mx, y: h - my },
    { x: mx, y: h - my },
  ];
}

// The output size of a rectified scan: the estimated proportions at a longest
// edge of `maxEdge` — never upscaled far beyond what the photo holds.
export function rectifiedSize(
  q: Quad,
  ratio: number,
  maxEdge = 1600,
  minEdge = 640,
): { w: number; h: number } {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const srcLongest = Math.max(d(q[0], q[1]), d(q[3], q[2]), d(q[0], q[3]), d(q[1], q[2]));
  const edge = Math.min(maxEdge, Math.max(minEdge, Math.round(srcLongest)));
  let w: number, h: number;
  if (ratio >= 1) {
    w = edge;
    h = Math.max(1, Math.round(edge / ratio));
  } else {
    h = edge;
    w = Math.max(1, Math.round(edge * ratio));
  }
  return { w, h };
}
