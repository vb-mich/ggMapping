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
  _jm_events(h: number): number;
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

  it("obeys the v0.5 marker law: shuffles fire per cycle, never from Add Panel", async () => {
    const m = await loadEngine();
    const cfg = cstr(m, "{}");
    const h = m._jm_create(cfg, 42n, 20);
    m._free(cfg);
    m._jm_run(h);
    const events = JSON.parse(m.UTF8ToString(m._jm_events(h))) as {
      kind: string;
      payload: Record<string, unknown>;
    }[];
    let shuffles = 0,
      cycles = 0,
      orphanShuffles = 0,
      cycleOpen = false,
      ageIndex = 0;
    const addpanelAges: number[] = [];
    for (const e of events) {
      if (e.kind === "age_start") {
        ageIndex += 1;
        cycleOpen = false;
        if (e.payload.card === "addpanel") addpanelAges.push(ageIndex);
      } else if (e.kind === "cycle_complete") {
        cycles += 1;
        cycleOpen = true;
      } else if (e.kind === "deck_shuffled") {
        shuffles += 1;
        if (!cycleOpen) orphanShuffles += 1;
        cycleOpen = false;
      }
    }
    expect(orphanShuffles).toBe(0); // no shuffle without its cycle marker
    expect(shuffles).toBe(cycles); // one shuffle per completed cycle
    expect(shuffles).toBeGreaterThan(15); // the whole game, ~500/20 ages

    // deck recurrence sanity: Add Panel roughly every 20 ages once awake
    const gaps = addpanelAges.slice(1).map((a, i) => a - addpanelAges[i]);
    const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    expect(avg).toBeGreaterThan(15);
    expect(avg).toBeLessThan(30);
    m._jm_free(h);
  });

  it("honors the experimental fields dial, and only when asked", async () => {
    const m = await loadEngine();
    const run = (cfgJson: string, seed: bigint) => {
      const p = cstr(m, cfgJson);
      const h = m._jm_create(p, seed, 20);
      m._free(p);
      m._jm_run(h);
      const log = m.UTF8ToString(m._jm_log(h));
      const events = JSON.parse(m.UTF8ToString(m._jm_events(h))) as {
        kind: string;
      }[];
      m._jm_free(h);
      return { log, deepenings: events.filter((e) => e.kind === "field_deepens").length };
    };

    // off (both spellings): the canon bytes, and the dial's event unreachable
    const canon = run("{}", 42n);
    const explicitOff = run(JSON.stringify({ exp_fields: false }), 42n);
    const golden = readFileSync(
      join(ROOT, "reference", "sample_log_seed42.txt"),
      "latin1",
    );
    expect(canon.log).toBe(golden.slice(0, canon.log.length));
    expect(explicitOff.log).toBe(canon.log);
    expect(canon.deepenings).toBe(0);
    expect(canon.log).not.toContain("the field deepens");

    // on: a different world, fields deepen, and it is reproducible
    const on = run(JSON.stringify({ exp_fields: true }), 42n);
    expect(on.log).not.toBe(canon.log);
    expect(on.deepenings).toBeGreaterThan(0);
    expect(on.log).toContain("    the field deepens");
    expect(run(JSON.stringify({ exp_fields: true }), 42n).log).toBe(on.log);
    expect(on.log).not.toMatch(/tile|visit|rung/i);
  });

  it("is deterministic: the same seed twice produces identical bytes", async () => {
    const m = await loadEngine();
    const run = () => {
      const cfg = cstr(m, "{}");
      const h = m._jm_create(cfg, 7n, 8);
      m._free(cfg);
      m._jm_run(h);
      const out =
        m.UTF8ToString(m._jm_log(h)) + m.UTF8ToString(m._jm_report(h));
      m._jm_free(h);
      return out;
    };
    expect(run()).toBe(run());
  });

  it("keeps the total vocabulary law over the rendered log and report", async () => {
    const m = await loadEngine();
    const cfg = cstr(m, "{}");
    const h = m._jm_create(cfg, 11n, 20);
    m._free(cfg);
    m._jm_run(h);
    const text =
      m.UTF8ToString(m._jm_log(h)) + m.UTF8ToString(m._jm_report(h));
    expect(text).not.toMatch(/tile|visit|rung/i);
    expect(text).toContain("=== JERRYMAPPING, simulator run ===");
    expect(text).toContain("elevation shares:");
    m._jm_free(h);
  });
});
