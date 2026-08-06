// Act 1.5's pure law: the derived timeline rule, the rotate quarter turn,
// the zip container, and the stitch geometry with its mobile cap.
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { mapAt, stopIndexAt, timelineStops, type ScanMeta } from "../src/digitalizer/db";
import { orderQuad, rotateQuadCW, type Quad } from "../src/digitalizer/geometry";
import { makeRaster, rotate90 } from "../src/digitalizer/raster";
import {
  EXPORT_CAP,
  containFit,
  coordAxis,
  medianAspect,
  stitchLayout,
} from "../src/digitalizer/stitch";
import { buildZip, crc32, parseZip, ZipError } from "../src/digitalizer/zip";

const meta = (tx: number, ty: number, created: number, id = `${tx},${ty}@${created}`) =>
  ({ id, tx, ty, created }) as unknown as ScanMeta;

describe("the derived timeline rule (mapAt)", () => {
  const t1 = 1000, t2 = 2000, t3 = 3000;
  const scans = [
    meta(1, 1, t1, "a"), // the panel's first face
    meta(1, 1, t3, "c"), // its rework, later
    meta(2, 1, t2, "b"), // a neighbor in between
  ];
  it("at each T the map shows the right versions", () => {
    expect(mapAt(scans, t1 - 1).size).toBe(0);
    const at1 = mapAt(scans, t1);
    expect(at1.get("1,1")?.id).toBe("a");
    expect(at1.has("2,1")).toBe(false);
    const at2 = mapAt(scans, t2);
    expect(at2.get("1,1")?.id).toBe("a");
    expect(at2.get("2,1")?.id).toBe("b");
    const at3 = mapAt(scans, t3);
    expect(at3.get("1,1")?.id).toBe("c");
    expect(at3.get("2,1")?.id).toBe("b");
  });
  it("null means now: the newest of everything", () => {
    const now = mapAt(scans, null);
    expect(now.get("1,1")?.id).toBe("c");
    expect(now.size).toBe(2);
  });
  it("is pure derivation: input order does not matter", () => {
    const shuffled = [scans[2], scans[0], scans[1]];
    expect(mapAt(shuffled, t3).get("1,1")?.id).toBe("c");
  });
});

describe("import as is: when the file itself is the scan", () => {
  it("stores byte-verbatim up to the display ceiling, else downscales", async () => {
    const { verbatimPlan, AS_IS_MAX_EDGE, VERBATIM_MAX_EDGE } = await import(
      "../src/digitalizer/pipeline"
    );
    expect(AS_IS_MAX_EDGE).toBe(1600);
    expect(VERBATIM_MAX_EDGE).toBe(4096);
    expect(verbatimPlan(4096, 3000, "image/png")).toBe(true);
    expect(verbatimPlan(2000, 2400, "image/jpeg")).toBe(true);
    expect(verbatimPlan(1024, 768, "image/webp")).toBe(true);
    expect(verbatimPlan(4097, 900, "image/png")).toBe(false); // oversized
    expect(verbatimPlan(900, 4097, "image/png")).toBe(false);
    expect(verbatimPlan(800, 600, "image/gif")).toBe(false); // exotic type
    expect(verbatimPlan(800, 600, "")).toBe(false);
  });
});

describe("the encoder looks before it chooses (compression review)", () => {
  it("flatRatio tells a drawn export from a photograph", async () => {
    const { flatRatio, SCAN_QUALITY } = await import("../src/digitalizer/pipeline");
    const { makeRaster } = await import("../src/digitalizer/raster");
    expect(SCAN_QUALITY.webpPhoto).toBe(0.82);
    // a drawn export: flat runs with a few strokes
    const flat = makeRaster(200, 200);
    for (let i = 0; i < flat.data.length; i += 4) {
      const x = (i / 4) % 200;
      const v = x > 90 && x < 96 ? 40 : 230; // a stroke through paper
      flat.data[i] = v; flat.data[i + 1] = v; flat.data[i + 2] = v; flat.data[i + 3] = 255;
    }
    expect(flatRatio(flat)).toBeGreaterThan(SCAN_QUALITY.flatForLossless);
    // a photograph: per-pixel grain
    const photo = makeRaster(200, 200);
    let seed = 7;
    for (let i = 0; i < photo.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = 180 + (seed % 13) - 6;
      photo.data[i] = v; photo.data[i + 1] = v; photo.data[i + 2] = v; photo.data[i + 3] = 255;
    }
    expect(flatRatio(photo)).toBeLessThan(0.15);
  });
});

describe("the timeline's stops: one per update, equally spaced", () => {
  const scans = [
    meta(1, 1, 3000, "c"),
    meta(1, 1, 1000, "a"),
    meta(2, 1, 2000, "b"),
    meta(3, 1, 2000, "b2"), // two scans in one save burst share a moment
  ];
  it("collects distinct update moments, sorted", () => {
    expect(timelineStops(scans)).toEqual([1000, 2000, 3000]);
    expect(timelineStops([])).toEqual([]);
  });
  it("maps a moment to its stop index; null means the last stop (now)", () => {
    const stops = [1000, 2000, 3000];
    expect(stopIndexAt(stops, null)).toBe(2);
    expect(stopIndexAt(stops, 1000)).toBe(0);
    expect(stopIndexAt(stops, 2500)).toBe(1); // between stops: the one shown
    expect(stopIndexAt(stops, 3000)).toBe(2);
    expect(stopIndexAt(stops, 500)).toBe(0); // before the first: clamps
    expect(stopIndexAt([], null)).toBe(0);
  });
});

describe("rotate, a quarter turn clockwise", () => {
  it("moves pixels the way a photo turns", () => {
    // 2×3: distinct values, top-left must land at top-right
    const r = makeRaster(2, 3);
    const vals = [10, 20, 30, 40, 50, 60];
    vals.forEach((v, i) => {
      r.data[i * 4] = v;
      r.data[i * 4 + 3] = 255;
    });
    const out = rotate90(r); // now 3×2
    expect(out.width).toBe(3);
    expect(out.height).toBe(2);
    const at = (x: number, y: number) => out.data[(y * 3 + x) * 4];
    // src (0,0)=10 → dst (2,0); src (1,2)=60 → dst (0,1)
    expect(at(2, 0)).toBe(10);
    expect(at(0, 1)).toBe(60);
    expect(at(0, 0)).toBe(50); // src (0,2)
  });
  it("four turns are the identity, for image and quad alike", () => {
    let r = makeRaster(5, 7);
    for (let i = 0; i < r.data.length; i++) r.data[i] = (i * 37) % 256;
    const first = new Uint8ClampedArray(r.data);
    let q: Quad = orderQuad([
      { x: 1, y: 1 },
      { x: 4, y: 2 },
      { x: 3, y: 6 },
      { x: 0.5, y: 5 },
    ]);
    const q0 = q.map((p) => ({ ...p }));
    let h = r.height;
    for (let turn = 0; turn < 4; turn++) {
      q = rotateQuadCW(q, h);
      r = rotate90(r);
      h = r.height;
    }
    expect(r.width).toBe(5);
    expect([...r.data]).toEqual([...first]);
    for (let i = 0; i < 4; i++) {
      expect(q[i].x).toBeCloseTo(q0[i].x, 9);
      expect(q[i].y).toBeCloseTo(q0[i].y, 9);
    }
  });
});

describe("the zip container", () => {
  it("round-trips entries byte-identically", async () => {
    const bin = new Uint8Array(3000).map((_, i) => (i * 31) % 256);
    const entries = [
      { name: "manifest.json", data: new TextEncoder().encode('{"x":1}') },
      { name: "scans/deep/a.webp", data: bin },
      { name: "empty.bin", data: new Uint8Array(0) },
    ];
    const zip = buildZip(entries);
    const back = await parseZip(zip);
    expect(back.size).toBe(3);
    for (const e of entries) expect([...back.get(e.name)!]).toEqual([...e.data]);
  });
  it("knows the crc of the book", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("reads a deflated entry through the platform stream", async () => {
    // hand-build a zip whose entry is DEFLATE-compressed (a re-zipped backup)
    const raw = new TextEncoder().encode("the map, twice zipped ".repeat(20));
    const packed = new Uint8Array(deflateRawSync(raw));
    const name = new TextEncoder().encode("m.json");
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true); // DEFLATE
    lv.setUint32(14, crc32(raw), true);
    lv.setUint32(18, packed.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(16, crc32(raw), true);
    cv.setUint32(20, packed.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, 0, true);
    cd.set(name, 46);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, cd.length, true);
    ev.setUint32(16, local.length + packed.length, true);
    const zip = new Uint8Array(local.length + packed.length + cd.length + 22);
    zip.set(local, 0);
    zip.set(packed, local.length);
    zip.set(cd, local.length + packed.length);
    zip.set(end, local.length + packed.length + cd.length);

    const back = await parseZip(zip);
    expect(new TextDecoder().decode(back.get("m.json")!)).toContain("twice zipped");
  });
  it("refuses garbage and truncation with a sentence, not a crash", async () => {
    await expect(parseZip(new Uint8Array(10))).rejects.toBeInstanceOf(ZipError);
    const noise = new Uint8Array(400).map((_, i) => (i * 91) % 256);
    await expect(parseZip(noise)).rejects.toBeInstanceOf(ZipError);
    const good = buildZip([{ name: "a", data: new Uint8Array(100) }]);
    await expect(parseZip(good.subarray(0, good.length - 30))).rejects.toBeInstanceOf(ZipError);
  });
});

describe("the stitch geometry", () => {
  const item = (tx: number, ty: number, w = 1000, h = 1200) => ({ tx, ty, width: w, height: h });

  it("lands known coordinates in known cells with 1 px gaps", () => {
    // N1/E1, N1/E3, S1/E2: cols E1..E3, rows N1 then S1
    const layout = stitchLayout([item(1, 1), item(3, 1), item(2, -1)], 600);
    expect(layout.cols).toEqual([1, 2, 3]);
    expect(layout.rows).toEqual([1, -1]);
    expect(layout.cellH).toBe(600);
    expect(layout.cellW).toBe(500); // aspect 1000/1200
    expect(layout.width).toBe(3 * 500 + 2);
    expect(layout.height).toBe(2 * 600 + 1);
    expect(layout.cells.get("1,1")).toEqual({ x: 0, y: 0, w: 500, h: 600 });
    expect(layout.cells.get("3,1")).toEqual({ x: 2 * 501, y: 0, w: 500, h: 600 });
    expect(layout.cells.get("2,-1")).toEqual({ x: 501, y: 601, w: 500, h: 600 });
    expect(layout.capped).toBe(false);
  });

  it("the cap engages on an oversized map and the output stays inside it", () => {
    // ten columns of 1333×1600 cells would be ~13k px wide
    const items = [];
    for (let tx = 1; tx <= 10; tx++) items.push(item(tx, 1, 1333, 1600));
    const layout = stitchLayout(items, 1600);
    expect(layout.capped).toBe(true);
    expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(EXPORT_CAP);
    expect(layout.cellW).toBeGreaterThan(8);
  });

  it("median aspect is the middle voice, not the average", () => {
    expect(
      medianAspect([
        { width: 100, height: 100 }, // 1
        { width: 500, height: 600 }, // 5/6
        { width: 10, height: 90 }, // an outlier
      ]),
    ).toBeCloseTo(5 / 6, 9);
    expect(medianAspect([])).toBeCloseTo(5 / 6, 9);
  });

  it("contain-fit letterboxes without stretching", () => {
    const cell = { x: 10, y: 20, w: 100, h: 120 };
    const wide = containFit(200, 100, cell);
    expect(wide.w).toBe(100);
    expect(wide.h).toBe(50);
    expect(wide.y).toBe(20 + 35);
    const tall = containFit(50, 100, cell);
    expect(tall.h).toBe(120);
    expect(tall.w).toBe(60);
  });

  it("coordAxis skips the zero row and column", () => {
    expect(coordAxis([-2, 1])).toEqual([-2, -1, 1]);
    expect(coordAxis([1, 3])).toEqual([1, 2, 3]);
  });
});
