// The naming policy (CONTRACTS §10): the display name appears in exactly ONE
// source constant; everything else derives from it. When a build exists, the
// derived manifest must carry the constant's value.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DISPLAY_NAME, STRINGS } from "../src/strings";

const APP = join(__dirname, "..");

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe("naming policy", () => {
  it("holds the display name in exactly one source constant", () => {
    const files = [
      ...walk(join(APP, "src")),
      join(APP, "index.html"),
      join(APP, "vite.config.ts"),
    ];
    const needle = new RegExp(DISPLAY_NAME, "gi");
    let count = 0;
    const where: string[] = [];
    for (const f of files) {
      const hits = readFileSync(f, "utf8").match(needle)?.length ?? 0;
      if (hits) where.push(`${f}: ${hits}`);
      count += hits;
    }
    expect(count, where.join("; ")).toBe(1);
  });

  it("derives the built manifest from the constant (when a build exists)", () => {
    const manifest = join(APP, "dist", "manifest.webmanifest");
    if (!existsSync(manifest)) return; // unit runs may precede a build
    const m = JSON.parse(readFileSync(manifest, "utf8"));
    expect(m.name).toBe(DISPLAY_NAME);
    expect(m.short_name).toBe(DISPLAY_NAME);
    expect(m.id).toBe("jm-pwa");
  });

  // The lineage has ONE source: the engine. If the app kept its own copy the
  // two would drift at the next lineage break, and a badge that lies about the
  // lineage is worse than no badge (CONTRACTS §9).
  it("never hardcodes the rules lineage app-side", () => {
    const offenders: string[] = [];
    for (const f of walk(join(APP, "src"))) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      for (const [i, line] of readFileSync(f, "utf8").split("\n").entries()) {
        if (line.trimStart().startsWith("//")) continue; // prose may cite it
        if (/["'`]v0\.\d+["'`]/.test(line)) offenders.push(`${f}:${i + 1}`);
      }
    }
    expect(offenders, offenders.join("; ")).toHaveLength(0);
  });

  it("injects the built page's static title from the constant (when a build exists)", () => {
    const idx = join(APP, "dist", "index.html");
    if (!existsSync(idx)) return; // the e2e suite asserts this unconditionally
    const title = readFileSync(idx, "utf8").match(/<title>([^<]*)<\/title>/)?.[1];
    expect(title).toBe(`${DISPLAY_NAME} — ${STRINGS.tagline}`);
  });
});
