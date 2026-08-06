// The Helper's record model (HELPER_DESIGN "The record"): a world is config
// plus lineage, an origin, and the ordered script of decisions, overrides,
// and checkpoints. Replaying the record reproduces the world byte-for-byte —
// that is the identity test, and every type here serves it.
import type { JmConfig, JmEvent, TapeRecord, WorldState } from "../contracts/schema";

// Where a world came from. The origin carries everything replay needs to
// reconstruct age zero without this device's help.
export type Origin =
  | { type: "blank"; config: JmConfig; seed: number; eras: number }
  | {
      type: "fork"; // a simulator world continued by hand
      config: JmConfig;
      seed: number;
      eras: number;
      forkedAtAges: number;
      state: WorldState; // the §6 document where the Helper takes over
    }
  | { type: "paper"; state: WorldState }; // a lazily entered paper map

// Who answered a decision — the Helper's own bookkeeping beside the §4
// record. Guided and proposal ages share this one shape (the honesty rule
// and the identity test both need the modes to write identically).
//   player  — a tapped choice (spatial or listed)
//   entered — a die/chance result the player read off their physical dice
//   rolled  — the Helper rolled for them (§3 RNG)
//   chosen  — the player chose the outcome instead of rolling (the book's note)
//   auto    — synthesized by the Helper itself (provisional deck orders)
//   policy  — a proposal row accepted as the simulator's suggestion
export type RowSource = "player" | "entered" | "rolled" | "chosen" | "auto" | "policy";

export interface ScriptRow {
  rec: TapeRecord;
  source: RowSource;
}

// One paint-editor edit (the truth hierarchy: paper wins). Applied to a §6
// state document between ages by pure code — the same code at play time and
// at replay time, so an override cannot mean two things.
export type OverrideEdit =
  | { op: "base"; unit: [number, number]; elevation: number | null }
  | { op: "mark"; unit: [number, number]; mark: string | null }
  | { op: "wild"; unit: [number, number]; wild: boolean }
  | { op: "people"; unit: [number, number]; kind: string | null }
  | {
      op: "panel";
      panel: [number, number];
      action: "add" | "remove" | "full" | "notFull" | "archive" | "unarchive";
    }
  | { op: "stack"; order: [number, number][] };

// The record's entries, in order. Ages carry their scripts; overrides carry
// their edits; checkpoints carry a whole state document (a state set, with
// the age count) — the away-from-tool catch-up made replayable.
export type HelperEntry =
  | { type: "genesis"; script: ScriptRow[] } // blank origin: the deck build's shuffle
  | {
      type: "age";
      card: { kind: string; work: number };
      mode: "guided" | "proposal";
      script: ScriptRow[];
    }
  | { type: "override"; edits: OverrideEdit[]; note?: string }
  | { type: "checkpoint"; state: WorldState; agesAdvanced: number; note?: string };

// A stored entry: the record row plus this device's caches — the state after
// the entry and (for ages) the age's rendered events. Caches are recomputable
// by replay and are rebuilt on import; the record itself never depends on them.
export interface StoredEntry {
  worldId: string;
  seq: number;
  entry: HelperEntry;
  state: WorldState; // the world after this entry
  events?: JmEvent[]; // an age's events, engine-rendered text included
}

// The age in progress (uncommitted): its reveal, mode, script so far, and —
// in proposal mode — the proposal under review.
export interface OpenAge {
  card: { kind: string; work: number };
  mode: "guided" | "proposal";
  script: ScriptRow[];
  proposal: { fresh: ScriptRow[]; takeoverAt: number | null } | null;
}

export interface HelperWorldMeta {
  id: string;
  name: string;
  created: number;
  updated: number;
  lineage: string; // the rules at creation; foreign records get the notice
  origin: Origin;
  modePref: "guided" | "proposal"; // the next age's default (a preference, per-age)
  rngState: string; // the Helper's own §3 state: rolls, perms, the proposal policy
  // Panels whose units are entered. null = the world is complete (blank or
  // fork origin); a list = a lazily entered paper world (detail on demand).
  entered: [number, number][] | null;
  open: OpenAge | null;
  sync: "local"; // act two widens this union (outbox pattern, digitalizer db)
}

// The export file: the record, whole, and nothing device-local.
export const HELPER_FILE_TAG = "jm-helper-world";
export const HELPER_FILE_VERSION = 1;

export interface HelperExport {
  file: typeof HELPER_FILE_TAG;
  version: typeof HELPER_FILE_VERSION;
  exported: number;
  name: string;
  lineage: string;
  origin: Origin;
  modePref: "guided" | "proposal";
  rngState: string;
  entered: [number, number][] | null;
  entries: HelperEntry[];
  open: OpenAge | null;
}

// The purposes the UI knows how to present, one for one with the CONTRACTS
// §4.1 taxonomy. An unknown purpose must FAIL LOUDLY, never guess a shape.
export const KNOWN_DIE_PURPOSES = [
  "row",
  "column",
  "first elevation",
  "wobble",
  "heading",
  "len",
  "length",
  "foundation",
  "grow",
  "farm intensity",
  "anomaly",
  "islets",
] as const;

export const KNOWN_PICK_PURPOSES = [
  "row (choice)",
  "column (choice)",
  "wobble (choice)",
  "fill spot",
  "dominant tie",
  "rework dominant",
  "away direction",
  "ridge seed (choice)",
  "free seed (choice)",
  "heading (choice)",
  "length (choice)",
  "basin start",
  "extend run",
  "extend entry",
  "free class (choice)",
  "people base",
  "riser",
  "deepen field",
  "living city",
  "lead city",
  "panel position",
] as const;

// nudge {what}: the two rolled homes and the twelve anomaly names (§4.1)
export const NUDGE_WHATS = [
  "basin seed",
  "home",
  "lone island",
  "sunken land",
  "crater lake",
  "archipelago",
  "marsh",
  "trench",
  "mesa",
  "oasis",
  "volcano",
  "canyon",
  "old ruins",
  "wonder",
] as const;

export const PLACE_KINDS = ["farm_lo", "farm_hi", "rural"] as const;

export function isKnownPurpose(kind: TapeRecord["kind"], purpose: string): boolean {
  if (kind === "chance") return purpose === "archive";
  if (kind === "shuffle") return purpose === "deck";
  if (kind === "die")
    return (KNOWN_DIE_PURPOSES as readonly string[]).includes(purpose);
  if ((KNOWN_PICK_PURPOSES as readonly string[]).includes(purpose)) return true;
  if (purpose.startsWith("nudge "))
    return (NUDGE_WHATS as readonly string[]).includes(purpose.slice(6));
  if (purpose.startsWith("place "))
    return (PLACE_KINDS as readonly string[]).includes(purpose.slice(6));
  return false;
}
