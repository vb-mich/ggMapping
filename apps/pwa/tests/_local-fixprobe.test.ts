import { describe, expect, it } from "vitest";
import { detectQuad, houghQuad, setHoughDebug } from "../src/digitalizer/detect";
import { makeRaster } from "../src/digitalizer/raster";
import type { Quad } from "../src/digitalizer/geometry";

function fixture() {
  const w = 320, h = 240;
  const truth: Quad = [
    { x: 60, y: 30 }, { x: 268, y: 44 }, { x: 254, y: 206 }, { x: 74, y: 196 },
  ];
  const r = makeRaster(w, h);
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = truth[i], b = truth[(i + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      const s = Math.sign(cross);
      if (s === 0) continue;
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
    return true;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const grain = ((((x * 7 + (y >> 3) * 131) * 2654435761) >>> 24) % 18) - 9;
      let px: [number, number, number] = inside(x, y) ? [235, 231, 222] : [186 + grain, 148 + grain, 105 + grain];
      if (x < 44 && !inside(x, y)) px = [42, 40, 45];
      if (y >= 212 && x >= 120 && x < 220 && !inside(x, y)) px = [240, 238, 232];
      r.data[i] = px[0]; r.data[i + 1] = px[1]; r.data[i + 2] = px[2]; r.data[i + 3] = 255;
    }
  return { r, truth };
}

describe("probe fixture", () => {
  it("probes", () => {
    const { r } = fixture();
    const lines: unknown[] = [];
    const scored: never[] = [];
    setHoughDebug((tag, p) => {
      if (tag === "lines") lines.push(...(p as unknown[]));
      if (tag === "score") scored.push(p as never);
    });
    const hq = houghQuad(r);
    setHoughDebug(null);
    // eslint-disable-next-line no-console
    console.log("lines:", JSON.stringify((lines as {theta:number;rho:number;votes:number}[]).map(l => ({ t: +(l.theta * 180 / Math.PI).toFixed(1), r: Math.round(l.rho), v: l.votes }))));
    // eslint-disable-next-line no-console
    for (const s of (scored as {quad:{x:number;y:number}[];support:number;minSide:number;minStep:number;positives:number}[]).slice(0, 8)) console.log("cand:", s.quad.map(p => `${Math.round(p.x)},${Math.round(p.y)}`).join(" "), "sup", s.support, "minSide", s.minSide, "minStep", s.minStep, "pos", s.positives);
    // eslint-disable-next-line no-console
    console.log("houghQuad:", JSON.stringify(hq), "detectQuad:", JSON.stringify(detectQuad(r)));
    expect(true).toBe(true);
  });
});
