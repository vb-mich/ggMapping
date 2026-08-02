// Border detection on synthetic frames. The hard case is the law here: WHITE
// paper on a LIGHT wooden table under a soft shadow band — brightness cannot
// separate that (the color pass must); the bright-sheet-on-dark-table case
// proves the brightness fallback; hostile frames must yield null (the caller
// then offers the default quad — detection is a convenience, never a
// requirement).
import { describe, expect, it } from "vitest";

import { detectQuad, quadIOU, sobelEdges } from "../src/digitalizer/detect";
import { defaultQuad, type Pt, type Quad } from "../src/digitalizer/geometry";
import { makeRaster, type Raster } from "../src/digitalizer/raster";

type Rgb = [number, number, number];

// A filled convex quad (the "paper") over a background, plus grid lines
// inside so the fixture looks like a drawn panel, not a blank card. The
// background can be a flat gray or wood-toned with grain and a diagonal
// shadow gradient that dims paper and table alike (a phone at a table).
function frame(
  w: number,
  h: number,
  quad: Quad,
  opts: { bg: Rgb; paper: Rgb; grain?: number; shadow?: boolean; sunBand?: boolean } = {
    bg: [40, 40, 40],
    paper: [220, 220, 220],
  },
): Raster {
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
      const src = inside(x, y) ? opts.paper : opts.bg;
      // deterministic "grain": a streaky hash along x, table only
      const grain =
        !inside(x, y) && opts.grain
          ? ((((x * 7 + (y >> 3) * 131) * 2654435761) >>> 24) % opts.grain) - opts.grain / 2
          : 0;
      // a soft diagonal shadow over EVERYTHING, darkest at the top-left
      const shade = opts.shadow ? 0.72 + (0.28 * (x + y)) / (w + h) : 1;
      // a sunlit band washing out the top-left — wood and paper alike, the
      // table wearing two lights (the lost-corner failure of the field)
      const wash = opts.sunBand && x + y < (w + h) * 0.3 ? 0.5 : 0;
      const px = (v: number) => {
        const shaded = (v + grain) * shade;
        return Math.max(0, Math.min(255, shaded + (255 - shaded) * wash));
      };
      r.data[i] = px(src[0]);
      r.data[i + 1] = px(src[1]);
      r.data[i + 2] = px(src[2]);
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

const WOOD: Rgb = [186, 148, 105]; // a light table, barely darker than paper
const PAPER: Rgb = [235, 231, 222];

describe("detectQuad", () => {
  it("finds white paper on a LIGHT wooden table under a shadow band (the color pass)", () => {
    const truth: Quad = [
      { x: 55, y: 35 },
      { x: 275, y: 50 },
      { x: 260, y: 215 },
      { x: 70, y: 200 },
    ];
    const img = frame(320, 240, truth, {
      bg: WOOD,
      paper: PAPER,
      grain: 18,
      shadow: true,
    });
    const found = detectQuad(img);
    expect(found).not.toBeNull();
    const tol = Math.hypot(320, 240) * 0.03; // 3% of the diagonal
    for (let i = 0; i < 4; i++) expect(near(found![i], truth[i], tol)).toBe(true);
  });

  it("keeps the corner under a sunlit band: the table wears two lights", () => {
    // the field failure: a sun-washed streak across the top-left, over wood
    // and sheet alike; the washed wood must stay background, not bleed into
    // the sheet's component and drag its corner to the frame edge
    const truth: Quad = [
      { x: 55, y: 35 },
      { x: 275, y: 50 },
      { x: 260, y: 215 },
      { x: 70, y: 200 },
    ];
    const img = frame(320, 240, truth, {
      bg: WOOD,
      paper: PAPER,
      grain: 18,
      sunBand: true,
    });
    const found = detectQuad(img);
    expect(found).not.toBeNull();
    const tol = Math.hypot(320, 240) * 0.03;
    for (let i = 0; i < 4; i++) expect(near(found![i], truth[i], tol)).toBe(true);
  });

  it("cuts a handheld sheet out of a cluttered scene (the edge pass)", () => {
    // the field failure: no table at all — dark furniture on one side, warm
    // floor on the other, and a bright white patch (a shoe) right below the
    // sheet. Color cannot tell white paper from white shoes; edges can.
    const truth: Quad = [
      { x: 60, y: 30 },
      { x: 268, y: 44 },
      { x: 254, y: 206 },
      { x: 74, y: 196 },
    ];
    const img = frame(320, 240, truth, { bg: WOOD, paper: PAPER, grain: 18 });
    // repaint a third of the background dark (furniture)...
    for (let y = 0; y < 240; y++)
      for (let x = 0; x < 44; x++) {
        const i = (y * 320 + x) * 4;
        img.data[i] = 42; img.data[i + 1] = 40; img.data[i + 2] = 45;
      }
    // ...and a bright neutral patch under the sheet, nearly touching it
    for (let y = 212; y < 240; y++)
      for (let x = 120; x < 220; x++) {
        const i = (y * 320 + x) * 4;
        img.data[i] = 240; img.data[i + 1] = 238; img.data[i + 2] = 232;
      }
    const found = detectQuad(img);
    expect(found).not.toBeNull();
    const tol = Math.hypot(320, 240) * 0.03;
    for (let i = 0; i < 4; i++) expect(near(found![i], truth[i], tol)).toBe(true);
  });

  it("finds the corners of a bright sheet on a dark neutral table (the brightness fallback)", () => {
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

  it("canny thins a step edge to a line and keeps it connected", () => {
    const img = makeRaster(100, 100);
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) {
        const i = (y * 100 + x) * 4;
        const v = x < 50 ? 40 : 220;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    const { edges } = sobelEdges(img);
    let total = 0;
    let onLine = 0;
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++) {
        if (!edges[y * 100 + x]) continue;
        total++;
        if (x >= 47 && x <= 53) onLine++;
      }
    expect(total).toBeGreaterThan(60); // the edge runs the full height
    expect(total).toBeLessThan(300); // and is THIN, not a band
    expect(onLine / total).toBeGreaterThan(0.9); // and where it belongs
  });

  it("quadIOU measures agreement between candidate families", () => {
    const sq = (x: number, y: number, s: number): Quad => [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ];
    expect(quadIOU(sq(0, 0, 100), sq(0, 0, 100))).toBeGreaterThan(0.95);
    expect(quadIOU(sq(0, 0, 100), sq(200, 200, 100))).toBe(0);
    const half = quadIOU(sq(0, 0, 100), sq(50, 0, 100));
    expect(Math.abs(half - 1 / 3)).toBeLessThan(0.05);
  });

  it("defaultQuad is the centered inset start", () => {
    const q = defaultQuad(1000, 800);
    expect(q[0]).toEqual({ x: 80, y: 64 });
    expect(q[2]).toEqual({ x: 920, y: 736 });
  });
});


