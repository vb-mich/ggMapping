// The browser-build smoke (CONTRACTS §8.2 companion): one oracle cell through
// the WEB-flavored WASM engine, byte-compared to the committed oracle log.
// The Node-flavored gate remains the authoritative gate; this proves the
// artifact the PWA ships.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const ENGINE = join(ROOT, "engine", "wasm", "dist", "web", "jerrymap.mjs");

interface RawModule {
  _jm_create(cfg: number, seed: bigint, eras: number): number;
  _jm_run(h: number): void;
  _jm_log(h: number): number;
  _jm_report(h: number): number;
  _jm_state(h: number): number;
  _jm_load(p: number): number;
  _jm_free(h: number): void;
  _malloc(n: number): number;
  _free(p: number): void;
  UTF8ToString(p: number): string;
  stringToUTF8(s: string, p: number, n: number): void;
  lengthBytesUTF8(s: string): number;
}

async function loadEngine(): Promise<RawModule> {
  const mod = await import(/* @vite-ignore */ pathToFileURL(ENGINE).href);
  return (await mod.default()) as RawModule;
}

const cstr = (m: RawModule, s: string): number => {
  const n = m.lengthBytesUTF8(s) + 1;
  const p = m._malloc(n);
  m.stringToUTF8(s, p, n);
  return p;
};

describe("web-flavored engine smoke", () => {
  it("reproduces the base-42 oracle cell byte-for-byte", async () => {
    const m = await loadEngine();
    const cfg = cstr(m, "{}");
    const h = m._jm_create(cfg, 42n, 20);
    m._free(cfg);
    expect(h).toBeGreaterThan(0);
    m._jm_run(h);
    const produced = m.UTF8ToString(m._jm_log(h)) + m.UTF8ToString(m._jm_report(h)) + "\n";
    const golden = readFileSync(
      join(ROOT, "reference", "sample_log_seed42.txt"),
      "latin1",
    );
    expect(produced.length).toBe(golden.length);
    expect(produced).toBe(golden);

    // and the state document survives a load->save roundtrip byte-identically
    const state = m.UTF8ToString(m._jm_state(h));
    const sp = cstr(m, state);
    const h2 = m._jm_load(sp);
    m._free(sp);
    expect(h2).toBeGreaterThan(0);
    expect(m.UTF8ToString(m._jm_state(h2))).toBe(state);
    m._jm_free(h);
    m._jm_free(h2);
  });
});
