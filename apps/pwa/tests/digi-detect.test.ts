// Border detection on synthetic frames: a bright sheet on a dark table must
// yield its four corners; hostile frames must yield null (the caller then
// offers the default quad — detection is a convenience, never a requirement).
import { describe, expect, it } from "vitest";

import { detectQuad } from "../src/digitalizer/detect";
import { defaultQuad, type Pt, type Quad } from "../src/digitalizer/geometry";
import { makeRaster, type Raster } from "../src/digitalizer/raster";

// A filled convex quad (the "paper") over a dark background, plus faint grid
// lines inside so the fixture looks like a drawn panel, not a blank card.
function frame(w: number, h: number, quad: Quad, bg = 40, paper = 220): Raster {
  const r = makeRaster(w, h);
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      const s = Math.sign(cross);
      if (s === 0) continue;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = inside(x, y) ? paper : bg;
      r.data[i] = r.data[i + 1] = r.data[i + 2] = v;
      r.data[i + 3] = 255;
    }
  // grid strokes: darker lines across the quad's interior
  const lerp = (a: Pt, b: Pt, t: number): Pt => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  for (let k = 1; k < 5; k++) {
    const t = k / 5;
    for (const [p, q] of [
      [lerp(quad[0], quad[3], t), lerp(quad[1], quad[2], t)],
      [lerp(quad[0], quad[1], t), lerp(quad[3], quad[2], t)],
    ]) {
      const steps = 200;
      for (let s = 0; s <= steps; s++) {
        const x = Math.round(p.x + ((q.x - p.x) * s) / steps);
        const y = Math.round(p.y + ((q.y - p.y) * s) / steps);
        if (x >= 0 && y >= 0 && x < w && y < h) {
          const i = (y * w + x) * 4;
          r.data[i] = r.data[i + 1] = r.data[i + 2] = 130;
        }
      }
    }
  }
  return r;
}

const near = (a: Pt, b: Pt, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

describe("detectQuad", () => {
  it("finds the corners of a skewed bright sheet", () => {
    const truth: Quad = [
      { x: 60, y: 40 },
      { x: 270, y: 55 },
      { x: 255, y: 210 },
      { x: 75, y: 195 },
    ];
    const img = frame(320, 240, truth);
    const found = detectQuad(img);
    expect(found).not.toBeNull();
    const tol = Math.hypot(320, 240) * 0.03; // 3% of the diagonal
    for (let i = 0; i < 4; i++) expect(near(found![i], truth[i], tol)).toBe(true);
  });

  it("returns null on a frame with no dominant sheet", () => {
    const img = makeRaster(160, 120);
    // noise: no bright region of consequence
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (i * 2654435761) % 60;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    expect(detectQuad(img)).toBeNull();
  });

  it("returns null when the bright region is too small to be the subject", () => {
    const truth: Quad = [
      { x: 70, y: 50 },
      { x: 100, y: 50 },
      { x: 100, y: 80 },
      { x: 70, y: 80 },
    ];
    expect(detectQuad(frame(320, 240, truth))).toBeNull();
  });

  it("defaultQuad is the centered inset start", () => {
    const q = defaultQuad(1000, 800);
    expect(q[0]).toEqual({ x: 80, y: 64 });
    expect(q[2]).toEqual({ x: 920, y: 736 });
  });
});
