// Chapter 10's recommendations are soft warnings; the starting deck is quiet.
import { describe, expect, it } from "vitest";

import { DEFAULT_COPIES, deckWarnings, type DeckEdit } from "../src/deck";
import { STRINGS } from "../src/strings";

const base = (): DeckEdit => ({
  copies: { ...DEFAULT_COPIES },
  addpanelCopies: 1,
  workOverrides: {},
  moodOverrides: {},
});

describe("deck soft warnings", () => {
  it("stays silent on the handbook's starting deck", () => {
    expect(deckWarnings(base())).toEqual([]);
  });
  it("warns when the mood mix drifts", () => {
    const d = base();
    d.copies.calm = 9;
    expect(deckWarnings(d)).toContain(STRINGS.deckWarnMoodMix);
  });
  it("warns when the anomaly share leaves one-in-twenty", () => {
    const d = base();
    d.copies.anomaly = 0;
    expect(deckWarnings(d)).toContain(STRINGS.deckWarnAnomaly);
  });
  it("warns when the average work leaves seven", () => {
    const d = base();
    d.workOverrides = { extend: 11, basin: 11, settlement: 11 };
    expect(deckWarnings(d)).toContain(STRINGS.deckWarnAvgWork);
  });
  it("surfaces the growth-knob caveat above one Add Panel copy", () => {
    const d = base();
    d.addpanelCopies = 2;
    expect(deckWarnings(d)).toContain(STRINGS.deckWarnAddpanelGrowth);
  });
});
