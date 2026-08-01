// The scan archive's storage law: CRUD, version ordering, the multi-map
// model, the sync field act two builds on, and the default-coordinate rule.
// Runs against fake-indexeddb; each test gets a virgin database and a fresh
// module (the layer caches its connection).
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Db = typeof import("../src/digitalizer/db");

let db: Db;
let now = 1_000_000;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => ++now);
  vi.resetModules();
  db = await import("../src/digitalizer/db");
});
afterEach(() => vi.restoreAllMocks());

const blob = (n: number) => new Blob([new Uint8Array(n)], { type: "image/webp" });

function newScan(mapId: string, tx: number, ty: number, note = ""): Parameters<Db["addScan"]>[0] {
  return {
    mapId,
    tx,
    ty,
    note,
    mime: "image/webp",
    width: 1333,
    height: 1600,
    image: blob(1000),
    thumb: blob(50),
  };
}

describe("maps", () => {
  it("auto-creates the default map once and keeps it current", async () => {
    const a = await db.currentMap("My first map");
    const b = await db.currentMap("My first map");
    expect(a.id).toBe(b.id);
    expect(a.name).toBe("My first map");
    expect(await db.listMaps()).toHaveLength(1);
  });

  it("creates and switches maps", async () => {
    const first = await db.currentMap("My first map");
    const second = await db.createMap("The long game");
    expect((await db.currentMap("x")).id).toBe(second.id);
    await db.setCurrentMap(first.id);
    expect((await db.currentMap("x")).id).toBe(first.id);
    expect((await db.listMaps()).map((m) => m.name)).toEqual([
      "My first map",
      "The long game",
    ]);
  });
});

describe("scans", () => {
  it("stores a scan with a local id and sync=local; lists strip the image", async () => {
    const map = await db.currentMap("m");
    const rec = await db.addScan(newScan(map.id, 1, 1));
    expect(rec.id).toBeTruthy();
    expect(rec.sync).toBe("local");
    expect(rec.bytes).toBe(1000);
    const metas = await db.listScans(map.id);
    expect(metas).toHaveLength(1);
    expect((metas[0] as Record<string, unknown>).image).toBeUndefined();
    expect(metas[0].thumb).toBeInstanceOf(Blob);
    const full = await db.getScan(rec.id);
    expect(full?.image).toBeInstanceOf(Blob);
    expect(full?.image.size).toBe(1000);
  });

  it("keeps every scan of a panel as versions, newest first", async () => {
    const map = await db.currentMap("m");
    const first = await db.addScan(newScan(map.id, -1, 2, "first pass"));
    const second = await db.addScan(newScan(map.id, -1, 2, "after the rework"));
    const versions = await db.listVersions(map.id, -1, 2);
    expect(versions.map((v) => v.id)).toEqual([second.id, first.id]);
    const latest = await db.latestPerPanel(map.id);
    expect(latest.get("-1,2")?.id).toBe(second.id);
    expect(latest.size).toBe(1);
  });

  it("scopes the atlas to its map", async () => {
    const a = await db.currentMap("a");
    const b = await db.createMap("b");
    await db.addScan(newScan(a.id, 1, 1));
    await db.addScan(newScan(b.id, 2, 2));
    expect((await db.latestPerPanel(a.id)).has("1,1")).toBe(true);
    expect((await db.latestPerPanel(a.id)).has("2,2")).toBe(false);
    expect(await db.listScans(b.id)).toHaveLength(1);
  });

  it("deletes locally and finally", async () => {
    const map = await db.currentMap("m");
    const rec = await db.addScan(newScan(map.id, 1, 1));
    await db.deleteScan(rec.id);
    expect(await db.listScans(map.id)).toHaveLength(0);
    expect(await db.getScan(rec.id)).toBeUndefined();
  });

  it("counts scans and bytes for the footer", async () => {
    const map = await db.currentMap("m");
    await db.addScan(newScan(map.id, 1, 1));
    await db.addScan(newScan(map.id, 1, 2));
    const facts = await db.storageFacts();
    expect(facts.scans).toBe(2);
    expect(facts.bytes).toBe(2000);
    expect(facts.persisted).toBeNull(); // never asked (no navigator.storage here)
  });
});

describe("the default coordinate rule (E, S, W, N)", () => {
  const meta = (tx: number, ty: number, created: number) =>
    ({ tx, ty, created }) as import("../src/digitalizer/db").ScanMeta;

  it("first scan of a map offers N1/E1", () => {
    expect(db.defaultCoord([])).toEqual({ tx: 1, ty: 1 });
  });
  it("offers East of the newest scan first", () => {
    expect(db.defaultCoord([meta(1, 1, 5)])).toEqual({ tx: 2, ty: 1 });
  });
  it("then South, then West, then North", () => {
    const s = [meta(1, 1, 5), meta(2, 1, 6)];
    // newest is (2,1): E=(3,1) free
    expect(db.defaultCoord(s)).toEqual({ tx: 3, ty: 1 });
    // E taken -> S
    expect(db.defaultCoord([...s, meta(3, 1, 4)])).toEqual({ tx: 2, ty: -1 });
    // E and S taken -> W (which is (1,1), taken) -> N
    expect(
      db.defaultCoord([meta(1, 1, 5), meta(2, 1, 9), meta(3, 1, 4), meta(2, -1, 3)]),
    ).toEqual({ tx: 2, ty: 2 });
  });
  it("skips the zero row and column", () => {
    // East of W1 is E1, not 0
    expect(db.defaultCoord([meta(-1, 1, 5)])).toEqual({ tx: 1, ty: 1 });
    // South of N1 is S1
    expect(db.defaultCoord([meta(1, 1, 5), meta(2, 1, 4), meta(1, -1, 3)]).ty).not.toBe(0);
  });
  it("falls back to the newest scan's own panel when boxed in", () => {
    const s = [
      meta(1, 1, 9),
      meta(2, 1, 1),
      meta(1, -1, 2),
      meta(-1, 1, 3),
      meta(1, 2, 4),
    ];
    expect(db.defaultCoord(s)).toEqual({ tx: 1, ty: 1 });
  });
  it("stepCoord crosses the missing zero cleanly", () => {
    expect(db.stepCoord(-1, 1)).toBe(1);
    expect(db.stepCoord(1, -1)).toBe(-1);
    expect(db.stepCoord(2, 1)).toBe(3);
    expect(db.stepCoord(-3, -1)).toBe(-4);
  });
});
