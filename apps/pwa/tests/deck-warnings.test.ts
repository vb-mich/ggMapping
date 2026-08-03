// Chapter 10's recommendations are soft warnings; the starting deck is quiet.
import { describe, expect, it } from "vitest";

import { DEFAULT_COPIES, deckWarnings, type DeckEdit } from "../src/deck";
import { STRINGS } from "../src/strings";

const base = (): DeckEdit => ({
  copies: { ...DEFAULT_COPIES },
  addpanelCopies: 2,
  workOverrides: {},
  moodOverrides: {},
});

describe("deck soft warnings", () => {
  it("stays silent on the community's starting deck (ch. 5, canon since v0.9)", () => {
    expect(deckWarnings(base())).toEqual([]);
  });
  it("warns on the previous lineage's deck, entered by hand", () => {
    // the v0.8 starting deck: its 13/20 settle vs 4/20 level mix now reads as
    // a drift from the book's 12/7/3-in-22 — a legitimate warning, not a bug
    const d: DeckEdit = {
      copies: { ...DEFAULT_COPIES, extend: 4, settlement: 3, calm: 4 },
      addpanelCopies: 1,
      workOverrides: {},
      moodOverrides: {},
    };
    expect(deckWarnings(d)).toContain(STRINGS.deckWarnMoodMix);
  });
  it("warns when the mood mix drifts", () => {
    const d = base();
    d.copies.calm = 13;
    expect(deckWarnings(d)).toContain(STRINGS.deckWarnMoodMix);
  });
  it("warns when the anomaly share leaves one-in-twenty", () => {
    const d = base();
    d.copies.anomaly = 0;
    expect(deckWarnings(d)).toContain(STRINGS.deckWarnAnomaly);
  });
  it("warns when the average work leaves the starting deck's 6.5", () => {
    const d = base();
    d.workOverrides = { extend: 11, basin: 11, settlement: 11 };
    expect(deckWarnings(d)).toContain(STRINGS.deckWarnAvgWork);
  });
  it("surfaces the growth-knob caveat above the starting deck's two copies", () => {
    const d = base();
    d.addpanelCopies = 3;
    expect(deckWarnings(d)).toContain(STRINGS.deckWarnAddpanelGrowth);
  });
});
