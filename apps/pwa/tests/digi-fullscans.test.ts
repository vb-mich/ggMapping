// The atlas swaps a thumbnail for the stored scan once zoomed. That pool is
// bounded on purpose: a map can hold hundreds of panels and a phone cannot
// hold hundreds of full scans. These tests hold the bound, the eviction
// order, and the promise that no cell is left pointing at a revoked URL.
import { describe, expect, it, vi } from "vitest";

import { FULL_SCAN_LIMIT, FULL_SCAN_ZOOM, FullScanPool } from "../src/digitalizer/fullScans";

function fakePool(limit: number) {
  const revoked: string[] = [];
  const loaded: string[] = [];
  const pool = new FullScanPool(
    {
      load: async (id) => {
        loaded.push(id);
        return new Blob([id]);
      },
      createUrl: (blob) => `blob:${(blob as Blob).size}:${loaded[loaded.length - 1]}`,
      revokeUrl: (url) => revoked.push(url),
    },
    limit,
  );
  return { pool, revoked, loaded };
}

describe("the zoom threshold", () => {
  it("keeps thumbnails at rest and asks for scans past a modest zoom", () => {
    // a 256 px thumbnail covers a 96 px cell until the map is magnified
    expect(FULL_SCAN_ZOOM).toBeGreaterThan(1);
    expect(FULL_SCAN_ZOOM).toBeLessThanOrEqual(2);
    expect(FULL_SCAN_LIMIT).toBeGreaterThan(0);
  });
});

describe("FullScanPool", () => {
  it("loads a scan once and serves it again from memory", async () => {
    const { pool, loaded } = fakePool(4);
    const a = await pool.request("one");
    const b = await pool.request("one");
    expect(a).toBe(b);
    expect(loaded).toEqual(["one"]); // asked the database exactly once
    expect(pool.size).toBe(1);
  });

  it("asks the database once when two cells want the same scan at once", async () => {
    const { pool, loaded } = fakePool(4);
    const [a, b] = await Promise.all([pool.request("one"), pool.request("one")]);
    expect(a).toBe(b);
    expect(loaded).toEqual(["one"]);
  });

  it("never holds more than its limit, and revokes what it drops", async () => {
    const { pool, revoked } = fakePool(3);
    for (const id of ["a", "b", "c", "d", "e"]) await pool.request(id);
    expect(pool.size).toBe(3);
    expect(revoked).toHaveLength(2); // the two oldest went, and were revoked
    expect(pool.peek("a")).toBeUndefined();
    expect(pool.peek("b")).toBeUndefined();
    for (const id of ["c", "d", "e"]) expect(pool.peek(id)).toBeDefined();
  });

  it("evicts the least recently asked for, not the oldest loaded", async () => {
    const { pool } = fakePool(2);
    await pool.request("a");
    await pool.request("b");
    await pool.request("a"); // a is wanted again, so b is now the stale one
    await pool.request("c");
    expect(pool.peek("a")).toBeDefined();
    expect(pool.peek("b")).toBeUndefined();
    expect(pool.peek("c")).toBeDefined();
  });

  it("tells a listener the moment a scan leaves, so no cell shows a dead URL", async () => {
    const { pool } = fakePool(1);
    const seen: string[] = [];
    pool.onEvicted((id) => seen.push(id));
    await pool.request("a");
    await pool.request("b"); // pushes a out
    expect(seen).toEqual(["a"]);
  });

  it("stops listening when asked", async () => {
    const { pool } = fakePool(1);
    const seen: string[] = [];
    const off = pool.onEvicted((id) => seen.push(id));
    off();
    await pool.request("a");
    await pool.request("b");
    expect(seen).toEqual([]);
  });

  it("clears everything when the map changes, revoking as it goes", async () => {
    const { pool, revoked } = fakePool(5);
    for (const id of ["a", "b"]) await pool.request(id);
    const evicted: string[] = [];
    pool.onEvicted((id) => evicted.push(id));
    pool.clear();
    expect(pool.size).toBe(0);
    expect(revoked).toHaveLength(2);
    expect(evicted.sort()).toEqual(["a", "b"]);
  });

  it("survives a scan that is no longer in the database", async () => {
    const pool = new FullScanPool(
      {
        load: async () => undefined,
        createUrl: () => "never",
        revokeUrl: vi.fn(),
      },
      2,
    );
    expect(await pool.request("gone")).toBeUndefined();
    expect(pool.size).toBe(0);
  });
});
