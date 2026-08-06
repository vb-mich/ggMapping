// The raster core of the scan pipeline, on synthetic fixtures: rectification
// by inverse homography, scanner auto-levels, the manual adjustment pair, and
// the thumbnail resize.
import { describe, expect, it } from "vitest";

import type { Quad } from "../src/digitalizer/geometry";
import {
  applyLut,
  applyLuts,
  autoLevels,
  buildLut,
  buildLuts,
  makeRaster,
  resize,
  warpPerspective,
  type Raster,
} from "../src/digitalizer/raster";

function fill(r: Raster, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * r.width + x) * 4;
      r.data[i] = rgb[0];
      r.data[i + 1] = rgb[1];
      r.data[i + 2] = rgb[2];
      r.data[i + 3] = 255;
    }
  }
}

const px = (r: Raster, x: number, y: number) => {
  const i = (y * r.width + x) * 4;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};

// Four quadrants, four colors — the fixture for every warp assertion.
function quadrants(): Raster {
  const r = makeRaster(100, 100);
  fill(r, 0, 0, 50, 50, [255, 0, 0]); // TL red
  fill(r, 50, 0, 100, 50, [0, 255, 0]); // TR green
  fill(r, 50, 50, 100, 100, [0, 0, 255]); // BR blue
  fill(r, 0, 50, 50, 100, [255, 255, 0]); // BL yellow
  return r;
}

describe("warpPerspective", () => {
  it("identity quad copies the image", () => {
    const src = quadrants();
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const out = warpPerspective(src, quad, 100, 100);
    expect(px(out, 10, 10)).toEqual([255, 0, 0]);
    expect(px(out, 90, 10)).toEqual([0, 255, 0]);
    expect(px(out, 90, 90)).toEqual([0, 0, 255]);
    expect(px(out, 10, 90)).toEqual([255, 255, 0]);
  });

  it("straightens a skewed quad: each corner's color lands in its corner", () => {
    const src = quadrants();
    const quad: Quad = [
      { x: 8, y: 12 },
      { x: 88, y: 4 },
      { x: 94, y: 92 },
      { x: 4, y: 84 },
    ];
    const out = warpPerspective(src, quad, 60, 80);
    expect(px(out, 5, 5)).toEqual([255, 0, 0]);
    expect(px(out, 54, 5)).toEqual([0, 255, 0]);
    expect(px(out, 54, 74)).toEqual([0, 0, 255]);
    expect(px(out, 5, 74)).toEqual([255, 255, 0]);
  });

  it("a sub-rectangle inside one color stays that color", () => {
    const src = quadrants();
    const quad: Quad = [
      { x: 5, y: 5 },
      { x: 40, y: 5 },
      { x: 40, y: 40 },
      { x: 5, y: 40 },
    ];
    const out = warpPerspective(src, quad, 30, 30);
    for (const [x, y] of [
      [0, 0],
      [29, 0],
      [15, 15],
      [0, 29],
      [29, 29],
    ]) {
      expect(px(out, x, y)).toEqual([255, 0, 0]);
    }
  });
});

describe("autoLevels", () => {
  it("finds the 2nd and 98th percentiles of a full gradient", () => {
    const r = makeRaster(256, 100);
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4;
        r.data[i] = r.data[i + 1] = r.data[i + 2] = x;
        r.data[i + 3] = 255;
      }
    const { lo, hi } = autoLevels(r);
    expect(lo).toBeGreaterThanOrEqual(3);
    expect(lo).toBeLessThanOrEqual(8);
    expect(hi).toBeGreaterThanOrEqual(247);
    expect(hi).toBeLessThanOrEqual(252);
  });

  it("leaves a flat image unstretched", () => {
    const r = makeRaster(50, 50);
    fill(r, 0, 0, 50, 50, [128, 128, 128]);
    const { lo, hi } = autoLevels(r);
    const lut = buildLut({ lo, hi, exposure: 0, contrast: 0 });
    // a flat mid-gray must stay near mid-gray, not blow out to white
    expect(Math.abs(lut[128] - 128)).toBeLessThanOrEqual(64);
  });
});

describe("the adjustment pair", () => {
  const neutral = { lo: 0, hi: 255, exposure: 0, contrast: 0 };
  it("neutral settings are the identity", () => {
    const lut = buildLut(neutral);
    for (const v of [0, 31, 128, 200, 255]) expect(lut[v]).toBe(v);
  });
  it("exposure raises, contrast steepens, both clamp", () => {
    const brighter = buildLut({ ...neutral, exposure: 40 });
    expect(brighter[128]).toBeGreaterThan(128);
    expect(brighter[255]).toBe(255);
    const punchy = buildLut({ ...neutral, contrast: 60 });
    expect(punchy[40]).toBeLessThan(40);
    expect(punchy[220]).toBeGreaterThan(220);
    expect(punchy[128]).toBe(128);
    const flat = buildLut({ ...neutral, contrast: -100 });
    for (const v of [0, 255]) expect(flat[v]).toBe(128);
  });
  it("temperature at zero leaves all three channels on the shared curve", () => {
    const luts = buildLuts({ ...neutral, temperature: 0 });
    const base = buildLut(neutral);
    for (const v of [0, 64, 128, 200, 255]) {
      expect(luts.r[v]).toBe(base[v]);
      expect(luts.g[v]).toBe(base[v]);
      expect(luts.b[v]).toBe(base[v]);
    }
  });
  it("warming lifts red and sinks blue; cooling mirrors; both clamp", () => {
    const warm = buildLuts({ ...neutral, temperature: 100 });
    expect(warm.r[128]).toBeGreaterThan(128);
    expect(warm.b[128]).toBeLessThan(128);
    expect(warm.g[128]).toBe(128);
    expect(warm.r[255]).toBe(255); // clamped, not wrapped
    expect(warm.b[0]).toBe(0);
    const cool = buildLuts({ ...neutral, temperature: -100 });
    expect(cool.r[128]).toBeLessThan(128);
    expect(cool.b[128]).toBeGreaterThan(128);
    // the shift is symmetric: what warming adds to red, cooling adds to blue
    expect(warm.r[128] - 128).toBe(cool.b[128] - 128);
  });
  it("applyLuts drives each channel by its own table", () => {
    const r = makeRaster(1, 1);
    fill(r, 0, 0, 1, 1, [100, 100, 100]);
    const out = applyLuts(r, buildLuts({ ...neutral, temperature: 50 }));
    expect(out.data[0]).toBeGreaterThan(out.data[1]); // r above g
    expect(out.data[2]).toBeLessThan(out.data[1]); // b below g
    expect(out.data[3]).toBe(255);
  });

  it("applyLut touches RGB and preserves alpha", () => {
    const r = makeRaster(2, 1);
    fill(r, 0, 0, 2, 1, [10, 20, 30]);
    const out = applyLut(r, buildLut({ lo: 0, hi: 255, exposure: 100, contrast: 0 }));
    expect(px(out, 0, 0).every((c, i) => c > [10, 20, 30][i])).toBe(true);
    expect(out.data[3]).toBe(255);
  });
});

describe("resize", () => {
  it("reaches the exact size and preserves the mean on deep reduction", () => {
    const r = makeRaster(200, 200);
    // 2px checkerboard, mean 127.5
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 200; x++) {
        const v = ((x >> 1) + (y >> 1)) % 2 ? 255 : 0;
        const i = (y * 200 + x) * 4;
        r.data[i] = r.data[i + 1] = r.data[i + 2] = v;
        r.data[i + 3] = 255;
      }
    const out = resize(r, 25, 25);
    expect(out.width).toBe(25);
    expect(out.height).toBe(25);
    let sum = 0;
    for (let i = 0; i < out.data.length; i += 4) sum += out.data[i];
    const mean = sum / (25 * 25);
    expect(Math.abs(mean - 127.5)).toBeLessThan(12);
  });
});
