// The deck model the editor edits — CONTRACTS §6 config granularity: per-kind
// copies, one work average per kind, per-kind mood. The printed work numbers
// shown in the UI come from the ENGINE (a genesis-only preview world), never
// from app-side arithmetic; the constants below are the handbook's own data
// (chapter 5 deck table) used only for defaults and the soft warnings.
import { STRINGS } from "./strings";

// Fixed kind order of config.deck (CONTRACTS §6.4).
export const KINDS = [
  "extend",
  "basin",
  "ridge",
  "greatridge",
  "settlement",
  "calm",
  "anomaly",
  "freestroke",
] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABELS: Record<string, string> = {
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

// Handbook chapter 5: the starting deck.
export const DEFAULT_COPIES: Record<Kind, number> = {
  extend: 4,
  basin: 3,
  ridge: 1,
  greatridge: 1,
  settlement: 3,
  calm: 4,
  anomaly: 1,
  freestroke: 2,
};

// This lineage's per-kind work averages (the engine's living table; the
// handbook's printed numbers are the spread around these).
export const DEFAULT_WORK_AVG: Record<string, number> = {
  extend: 7,
  basin: 7,
  ridge: 7,
  greatridge: 7,
  settlement: 7,
  calm: 6,
  anomaly: 7,
  freestroke: 7,
  addpanel: 4,
};

// Handbook chapter 5: the mood column.
export const DEFAULT_MOODS: Record<string, string> = {
  extend: "settle",
  basin: "settle",
  ridge: "rise",
  greatridge: "rise",
  settlement: "settle",
  calm: "level",
  anomaly: "rise",
  freestroke: "settle",
  addpanel: "settle",
};

export interface DeckEdit {
  copies: Record<Kind, number>;
  addpanelCopies: number;
  workOverrides: Partial<Record<string, number>>;
  moodOverrides: Partial<Record<string, string>>;
}

// Chapter 10's recommendations — soft warnings, never blocks. The averages are
// exact: the engine's work spread preserves each kind's mean, so sums need no
// per-card knowledge.
export function deckWarnings(d: DeckEdit): string[] {
  const warnings: string[] = [];
  const avgOf = (k: string) => d.workOverrides[k] ?? DEFAULT_WORK_AVG[k];
  let cards = d.addpanelCopies;
  let workSum = d.addpanelCopies * avgOf("addpanel");
  const moodCount: Record<string, number> = { settle: 0, level: 0, rise: 0 };
  moodCount[d.moodOverrides["addpanel"] ?? DEFAULT_MOODS["addpanel"]] +=
    d.addpanelCopies;
  for (const k of KINDS) {
    cards += d.copies[k];
    workSum += d.copies[k] * avgOf(k);
    moodCount[d.moodOverrides[k] ?? DEFAULT_MOODS[k]] += d.copies[k];
  }
  if (cards === 0) return warnings;

  if (Math.abs(workSum / cards - 7) > 0.5) warnings.push(STRINGS.deckWarnAvgWork);

  const anomalyShare = d.copies.anomaly / cards;
  if (anomalyShare < 0.025 || anomalyShare > 0.075)
    warnings.push(STRINGS.deckWarnAnomaly);

  // Starting mix in twentieths: 13 settle, 4 level, 3 rise.
  const target: Record<string, number> = { settle: 13 / 20, level: 4 / 20, rise: 3 / 20 };
  const drifted = Object.keys(target).some(
    (m) => Math.abs((moodCount[m] ?? 0) / cards - target[m]) > 0.1,
  );
  if (drifted) warnings.push(STRINGS.deckWarnMoodMix);

  // Chapter 3's growth knob: extra Add Panels pair with heavy archiving.
  if (d.addpanelCopies > 1) warnings.push(STRINGS.deckWarnAddpanelGrowth);

  return warnings;
}
