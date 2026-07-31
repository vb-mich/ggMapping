// TypeScript views of the CONTRACTS surfaces the app speaks:
// the state schema (§6), the structured event stream (§5), the config (§6).
// The app never interprets rules — it renders these documents.

export type DeckRow = [kind: string, copies: number];

export interface JmConfig {
  panel_w?: number;
  panel_h?: number;
  deck?: DeckRow[];
  addpanel_copies?: number;
  work_spread?: boolean;
  work_overrides?: Record<string, number>;
  mood_overrides?: Record<string, string>;
  archive_permille?: number;
  stroke_die?: number;
  stroke_add?: number;
  greatridge_die?: number; // 0 = unset: the length stays chosen
  greatridge_add?: number;
  extend_cap?: number; // 0 = uncapped
  exp_fields?: boolean; // EXPERIMENTAL, CONTRACTS §11 — default false
}

export interface WorldState {
  schema: "jerrymap-state";
  version: number;
  lineage: string;
  config: Required<Pick<JmConfig, "panel_w" | "panel_h">> & JmConfig;
  rng: { algo: string; state: string };
  time: {
    seed: number;
    eras_wanted: number;
    era: number;
    age_in_era: number;
    ages_total: number;
  };
  world: {
    panels: [number, number, number][]; // tx, ty, filled
    base: [number, number, number][]; // gx, gy, rung
    wild: [number, number][];
    marks: [number, number, string][];
    people: [number, number, string][]; // insertion-ordered, semantic
    embellish: [number, number, number][];
    embellish_panel: [number, number, number][];
    atlas: [number, number][];
    binder: [number, number][];
    stack: [number, number][];
  };
  deck: {
    order: { kind: string; work: number; uid: number }[];
    marker_uid: number | null;
    woken: boolean;
    next_uid: number;
  };
  chronicle: {
    era_rows: string[];
    metrics: Record<string, number>;
    skips: Record<string, number>;
    firsts: Record<string, number>;
    genesis_panels: [number, number][];
    genesis_coverage: { num: number; den: number } | null;
    completed_per_era: Record<string, number>;
    added_per_era: Record<string, number>;
  };
  carry: { step: number; panel: [number, number] | null };
}

export interface JmEvent {
  seq: number;
  kind: string;
  panel: [number, number] | null;
  unit: [number, number] | null;
  payload: Record<string, unknown> & { step?: number };
  text: string[]; // the engine-rendered log lines of this event
}

export interface JmTime {
  era: number;
  age_in_era: number;
  ages_total: number;
  eras_wanted: number;
  finished: boolean;
}
