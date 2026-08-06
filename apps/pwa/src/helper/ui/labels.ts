// Labels for the decision taxonomy (CONTRACTS §4.1) and the book's deep
// links. The taxonomy is CLOSED: an unknown purpose already failed loudly in
// the session; these tables only dress the known set.
import { RUNG_NAMES } from "../../contracts/palette";
import { panelName, rcOf, type Geo } from "../../contracts/geometry";
import { rulesHash } from "../../router";
import { STRINGS } from "../../strings";

export const DIR_NAMES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export const CARD_NAMES: Record<string, string> = {
  extend: "Extend",
  basin: "Basin",
  ridge: "Ridge",
  greatridge: "Great Ridge",
  settlement: "Settlement",
  calm: "Calm",
  anomaly: "Anomaly",
  freestroke: "Free Stroke",
  addpanel: "Add Panel",
};

// Master Manual chapter anchors (the Rulebook's slugs of its headings).
export const CARD_CHAPTERS: Record<string, string> = {
  extend: "extend",
  basin: "basin",
  ridge: "ridge-and-great-ridge",
  greatridge: "ridge-and-great-ridge",
  settlement: "settlement",
  calm: "6-the-turn",
  anomaly: "anomaly",
  freestroke: "free-stroke",
  addpanel: "add-a-panel",
};

export const DICE_CHAPTER = "rolling-dice";

export const cardBookHash = (kind: string): string =>
  rulesHash(CARD_CHAPTERS[kind] ?? "9-the-cards-instructions");

export const PEOPLE_NAMES: Record<string, string> = {
  farm_lo: STRINGS.peopleFieldsLow,
  farm_hi: STRINGS.peopleFieldsHigh,
  rural: STRINGS.peopleRural,
  urb_lo: STRINGS.peopleUrbanLow,
  urb_md: STRINGS.peopleUrbanMedium,
  urb_hi: STRINGS.peopleUrbanHigh,
};

// The human line above a die question, in the book's vocabulary.
export function dieQuestion(purpose: string, domain: number): string {
  return STRINGS.hpQuestionDie.replace("{die}", `d${domain}`).replace("{purpose}", purpose);
}

export function unitLabel(geo: Geo, unit: [number, number]): string {
  const [r, c] = rcOf(geo, unit[0], unit[1]);
  const [tx, ty] = panelOfUnit(geo, unit);
  return STRINGS.hpUnitLabel
    .replace("{r}", String(r))
    .replace("{c}", String(c))
    .replace("{panel}", panelName(tx, ty));
}

function panelOfUnit(geo: Geo, unit: [number, number]): [number, number] {
  const xi = Math.floor(unit[0] / geo.w);
  const yi = Math.floor(unit[1] / geo.h);
  return [xi >= 0 ? xi + 1 : xi, yi >= 0 ? -(yi + 1) : -yi];
}

// The label of one pick candidate, by purpose. Unit-shaped candidates label
// as r/c panel; number-shaped ones by what the number means (§4.1).
export function candidateLabel(
  purpose: string,
  geo: Geo,
  cand: unknown,
  ctxRow: { length?: number; side?: string; water?: boolean; units: [number, number][] } | null,
): string {
  if (purpose === "heading (choice)") return DIR_NAMES[cand as number];
  if (purpose === "away direction" || purpose === "people base" ||
      purpose === "dominant tie" || purpose === "rework dominant")
    return RUNG_NAMES[cand as number];
  if (purpose === "free class (choice)")
    return (cand as number) === 0 ? STRINGS.hpWater : STRINGS.hpHeights;
  if (purpose === "extend run" && ctxRow)
    return STRINGS.hpRunLabel
      .replace("{n}", String(ctxRow.length ?? ctxRow.units.length))
      .replace("{cls}", ctxRow.water ? STRINGS.hpWater : STRINGS.hpHeights)
      .replace("{side}", ctxRow.side ?? "?");
  if ((purpose === "living city" || purpose === "lead city") && ctxRow)
    return STRINGS.hpSettlementLabel.replace("{n}", String(ctxRow.units.length));
  if (purpose === "panel position" && Array.isArray(cand))
    return panelName((cand as [number, number])[0], (cand as [number, number])[1]);
  if (Array.isArray(cand)) return unitLabel(geo, cand as [number, number]);
  if (typeof cand === "object" && cand !== null && "unit" in cand) {
    const c = cand as { unit: [number, number]; legal?: number[]; needs_paint?: boolean };
    let s = unitLabel(geo, c.unit);
    if (c.needs_paint && c.legal?.length)
      s += ` (${STRINGS.hpPaintBase.replace(
        "{elevation}",
        c.legal.map((b) => RUNG_NAMES[b]).join("/"),
      )})`;
    return s;
  }
  return String(cand);
}
