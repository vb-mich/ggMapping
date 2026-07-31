// The app's palette constants are a transcription of CONTRACTS §2.4 —
// this test reads the law and compares, entry by entry.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHROME,
  MARK_COLORS,
  PATINA_OFFSETS,
  PEOPLE_COLORS,
  RUNG_COLORS,
  RUNG_NAMES,
  SUNKEN_TINT,
  darken55,
} from "../src/contracts/palette";

const contracts = readFileSync(
  join(__dirname, "..", "..", "..", "docs", "CONTRACTS.md"),
  "utf8",
);
const section = contracts.slice(
  contracts.indexOf("### 2.4 The canonical palette"),
  contracts.indexOf("## 3."),
);

const colorAfter = (label: string): string => {
  const m = section.match(new RegExp(`${label}[^\`]*\`(#[0-9A-Fa-f]{6,8})\``));
  if (!m) throw new Error(`no color for "${label}" in CONTRACTS 2.4`);
  return m[1];
};

describe("canonical palette vs CONTRACTS 2.4", () => {
  it("rungs", () => {
    RUNG_NAMES.forEach((name, i) => {
      expect(RUNG_COLORS[i], name).toBe(colorAfter(`\\| ${name} \\|`));
    });
  });
  it("people", () => {
    for (const [kind, color] of Object.entries(PEOPLE_COLORS)) {
      expect(color, kind).toBe(colorAfter(`\\| ${kind} \\|`));
    }
  });
  it("marks and tints", () => {
    expect(MARK_COLORS.marsh).toBe(colorAfter("marsh reeds"));
    expect(MARK_COLORS.volcano).toBe(colorAfter("volcano triangle"));
    expect(MARK_COLORS.canyon).toBe(colorAfter("canyon stroke"));
    expect(MARK_COLORS.ruins).toBe(colorAfter("ruins cross"));
    expect(MARK_COLORS.star).toBe(colorAfter("star"));
    expect(SUNKEN_TINT).toBe(colorAfter("renders")); // "…`sunken` renders `#…`"
  });
  it("chrome", () => {
    expect(CHROME.background).toBe(colorAfter("map background"));
    expect(CHROME.emptyFill).toBe(colorAfter("unpainted unit"));
    expect(CHROME.emptyOutline).toBe(colorAfter("with outline"));
    expect(CHROME.unitOutline).toBe(colorAfter("painted unit outline"));
    expect(CHROME.panelBorder).toBe(colorAfter("panel border"));
  });
  it("patina offsets appear in the law", () => {
    for (const [fx, fy] of PATINA_OFFSETS) {
      expect(section).toContain(`(${fx.toFixed(2)}, ${fy.toFixed(2)})`);
    }
  });
  it("darken55 follows the per-channel floor rule", () => {
    expect(darken55("#FFFFFF")).toBe("#8c8c8c"); // floor(255*0.55) = 140
    expect(darken55("#14364F")).toBe("#0b1d2b"); // floor(20*0.55) = 11 = 0x0b
  });
});
