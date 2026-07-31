// The vocabulary law (CONTRACTS §1) over every UI string table.
import { describe, expect, it } from "vitest";

import { KIND_LABELS } from "../src/deck";
import { RUNG_NAMES } from "../src/contracts/palette";
import { DISPLAY_NAME, STRINGS } from "../src/strings";

const FORBIDDEN = /tile|visit/i;

describe("vocabulary law", () => {
  it("bans the words in every centralized UI string", () => {
    for (const [k, v] of Object.entries(STRINGS)) {
      expect(v, `STRINGS.${k}`).not.toMatch(FORBIDDEN);
    }
  });
  it("bans the words in the display name and label tables", () => {
    expect(DISPLAY_NAME).not.toMatch(FORBIDDEN);
    for (const v of Object.values(KIND_LABELS)) expect(v).not.toMatch(FORBIDDEN);
    for (const v of RUNG_NAMES) expect(v).not.toMatch(FORBIDDEN);
  });
});
