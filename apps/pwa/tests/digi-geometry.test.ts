// The scanner's pure quad math. The aspect tests project a KNOWN rectangle
// through a synthetic camera and require the estimate to recover its true
// proportions — the scanner is size-agnostic, so this recovery is the whole
// contract.
import { describe, expect, it } from "vitest";

import {
  applyH,
  estimateAspect,
  homography,
  isConvex,
  naiveAspect,
  orderQuad,
  quadArea,
  rectifiedSize,
  type Pt,
  type Quad,
} from "../src/digitalizer/geometry";

const QUAD: Quad = [
  { x: 10, y: 10 },
  { x: 100, y: 20 },
  { x: 90, y: 110 },
  { x: 5, y: 100 },
];

describe("orderQuad", () => {
  it("orders shuffled corners TL, TR, BR, BL", () => {
    const shuffles = [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [2, 0, 3, 1],
      [1, 3, 0, 2],
    ];
    for (const s of shuffles) {
      const out = orderQuad(s.map((i) => QUAD[i]));
      expect(out).toEqual(QUAD);
    }
  });
  it("keeps convexity facts straight", () => {
    expect(isConvex(QUAD)).toBe(true);
    const bowtie: Quad = [QUAD[0], QUAD[2], QUAD[1], QUAD[3]];
    expect(isConvex(bowtie)).toBe(false);
    expect(quadArea(QUAD)).toBeGreaterThan(0);
  });
});

describe("homography", () => {
  it("maps the four corners exactly and roundtrips interior points", () => {
    const rect: Quad = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ];
    const H = homography(rect, QUAD);
    for (let i = 0; i < 4; i++) {
      const p = applyH(H, rect[i]);
      expect(p.x).toBeCloseTo(QUAD[i].x, 6);
      expect(p.y).toBeCloseTo(QUAD[i].y, 6);
    }
    const back = homography(QUAD, rect);
    for (const p of [
      { x: 50, y: 60 },
      { x: 150, y: 250 },
      { x: 100, y: 150 },
    ]) {
      const there = applyH(H, p);
      const home = applyH(back, there);
      expect(home.x).toBeCloseTo(p.x, 4);
      expect(home.y).toBeCloseTo(p.y, 4);
    }
  });
});

// A pinhole camera: rectangle W×H on the z=0 plane, rotated, pushed away,
// projected with focal f. The image corners land where a real photo of a
// panel would.
function project(
  W: number,
  H: number,
  tiltX: number,
  tiltY: number,
  dist: number,
  f: number,
  cx: number,
  cy: number,
): Quad {
  const corners3 = [
    [-W / 2, -H / 2, 0],
    [W / 2, -H / 2, 0],
    [W / 2, H / 2, 0],
    [-W / 2, H / 2, 0],
  ];
  const sx = Math.sin(tiltX), cxr = Math.cos(tiltX);
  const sy = Math.sin(tiltY), cyr = Math.cos(tiltY);
  return corners3.map(([X, Y, Z]) => {
    // rotate about x, then y, then translate away from the camera
    const y1 = cxr * Y - sx * Z;
    const z1 = sx * Y + cxr * Z;
    const x2 = cyr * X + sy * z1;
    const z2 = -sy * X + cyr * z1 + dist;
    return { x: (f * x2) / z2 + cx, y: (f * y1) / z2 + cy } as Pt;
  }) as Quad;
}

describe("estimateAspect", () => {
  it("recovers the true proportions of a perspective-photographed rectangle", () => {
    const cases = [
      { W: 500, H: 600 }, // a 5×6 panel
      { W: 800, H: 1000 }, // an 8×10 panel
      { W: 700, H: 300 }, // and something wide, because size-agnostic
    ];
    for (const { W, H } of cases) {
      const quad = project(W, H, 0.45, 0.2, 1500, 800, 512, 384);
      const { ratio, method } = estimateAspect(quad, 1024, 768);
      expect(method).toBe("perspective");
      expect(Math.abs(ratio - W / H)).toBeLessThan(0.02 * (W / H));
    }
  });

  it("handles the affine case: a parallelogram has an exact ratio", () => {
    // a 300×200 rectangle rotated 30° — lengths preserved, no perspective
    const rot = (p: Pt): Pt => ({
      x: p.x * Math.cos(0.5236) - p.y * Math.sin(0.5236) + 400,
      y: p.x * Math.sin(0.5236) + p.y * Math.cos(0.5236) + 300,
    });
    const quad = [
      rot({ x: -150, y: -100 }),
      rot({ x: 150, y: -100 }),
      rot({ x: 150, y: 100 }),
      rot({ x: -150, y: 100 }),
    ] as Quad;
    const { ratio, method } = estimateAspect(quad, 800, 600);
    expect(method).toBe("affine");
    expect(ratio).toBeCloseTo(1.5, 5);
  });

  it("falls back to the naive ratio rather than exploding", () => {
    // a degenerate sliver
    const sliver: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 0.001 },
      { x: 0, y: 0.001 },
    ];
    const { ratio } = estimateAspect(sliver, 100, 100);
    expect(Number.isFinite(ratio)).toBe(true);
    expect(ratio).toBeGreaterThan(0);
  });
});

describe("rectifiedSize", () => {
  const bigQuad: Quad = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 3600 },
    { x: 0, y: 3600 },
  ];
  it("caps the longest edge and keeps the ratio", () => {
    const { w, h } = rectifiedSize(bigQuad, 5 / 6);
    expect(h).toBe(1600);
    expect(w).toBe(Math.round(1600 * (5 / 6)));
  });
  it("does not upscale a small photo to the cap", () => {
    const small: Quad = [
      { x: 0, y: 0 },
      { x: 700, y: 0 },
      { x: 700, y: 840 },
      { x: 0, y: 840 },
    ];
    const { h } = rectifiedSize(small, 5 / 6);
    expect(h).toBe(840);
  });
  it("keeps a floor for tiny quads", () => {
    const tiny: Quad = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 60 },
      { x: 0, y: 60 },
    ];
    const { h } = rectifiedSize(tiny, 5 / 6);
    expect(h).toBe(640);
  });
  it("puts the long edge on the wide side for wide panels", () => {
    const { w, h } = rectifiedSize(bigQuad, 2);
    expect(w).toBe(1600);
    expect(h).toBe(800);
  });
  it("naiveAspect reads the drawn quad's own proportions", () => {
    expect(naiveAspect(bigQuad)).toBeCloseTo(3000 / 3600, 6);
  });
});
