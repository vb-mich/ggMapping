// App state: signals + the worker client. The engine runs in the worker; this
// module holds configuration, run status, navigation, and the run's CONTRACTS
// documents. No rules live here — only reading and filtering of engine output.
import { computed, signal } from "@preact/signals";

import { DEFAULT_COPIES, KINDS, deckWarnings, type DeckEdit, type Kind } from "./deck";
import { panelName, panelOf } from "./contracts/geometry";
import type { JmConfig, JmEvent, WorldState } from "./contracts/schema";

// --- theme ------------------------------------------------------------------
export type Theme = "dark" | "light";
export const theme = signal<Theme>(
  (localStorage.getItem("jm-theme") as Theme) || "dark",
);
export function applyTheme(t: Theme): void {
  theme.value = t;
  document.documentElement.dataset.theme = t;
  localStorage.setItem("jm-theme", t);
}

// --- configuration ----------------------------------------------------------
export const seed = signal(randomSeed());
export const eras = signal(8);
export const panelSize = signal<"5x6" | "8x10">("5x6");
export const archiveChance = signal("0"); // percent, one decimal allowed
export const strokeDie = signal(4);
export const strokeAdd = signal(1);
export const grMode = signal<"choice" | "rolled">("choice");
export const grDie = signal(6);
export const grAdd = signal(0);
export const extendCap = signal(4);
export const flatWork = signal(false);


// --- the rules lineage ------------------------------------------------------
// Read from the engine, never hardcoded here: seeds do not survive a lineage
// break, so a world or config from another lineage repaints differently.
export const engineLineage = signal("");
export const engineVersion = signal("");
// Set when a loaded file names a different lineage; a notice, never a block.
export const foreignLineage = signal<string | null>(null);
// Set when a loaded file still carries a dial this lineage retired. Also a
// notice, never a block: the world opens, the key does nothing (CONTRACTS §6.3).
export const retiredKey = signal<string | null>(null);

export const deckCopies = signal<Record<Kind, number>>({ ...DEFAULT_COPIES });
export const addpanelCopies = signal(2);
export const workOverrides = signal<Partial<Record<string, number>>>({});
export const moodOverrides = signal<Partial<Record<string, string>>>({});

export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 10_000_000);
}

// Percent (one decimal, CONTRACTS §3) -> per-mille integer; NaN when invalid.
export function percentToPermille(s: string): number {
  if (!/^\d{1,3}(\.\d)?$/.test(s.trim())) return NaN;
  const m = Math.round(parseFloat(s.trim()) * 10);
  return m >= 0 && m <= 1000 ? m : NaN;
}

export const deckEdit = computed<DeckEdit>(() => ({
  copies: deckCopies.value,
  addpanelCopies: addpanelCopies.value,
  workOverrides: workOverrides.value,
  moodOverrides: moodOverrides.value,
}));
export const warnings = computed(() => deckWarnings(deckEdit.value));

export function buildConfig(): JmConfig {
  const [w, h] = panelSize.value === "5x6" ? [5, 6] : [8, 10];
  const cfg: JmConfig = {
    panel_w: w,
    panel_h: h,
    deck: KINDS.map((k) => [k, deckCopies.value[k]] as [string, number]),
    addpanel_copies: addpanelCopies.value,
    archive_permille: percentToPermille(archiveChance.value) || 0,
    stroke_die: strokeDie.value,
    stroke_add: strokeAdd.value,
    greatridge_die: grMode.value === "rolled" ? grDie.value : 0,
    greatridge_add: grMode.value === "rolled" ? grAdd.value : 0,
    extend_cap: extendCap.value,
  };
  if (flatWork.value) cfg.work_spread = false;
  const wo = Object.fromEntries(
    Object.entries(workOverrides.value).filter(([, v]) => v != null),
  ) as Record<string, number>;
  if (Object.keys(wo).length) cfg.work_overrides = wo;
  const mo = Object.fromEntries(
    Object.entries(moodOverrides.value).filter(([, v]) => v != null),
  ) as Record<string, string>;
  if (Object.keys(mo).length) cfg.mood_overrides = mo;
  return cfg;
}

// The shareable determinism capsule: seed + eras + full config. No run marker:
// with the fields promoted (v0.8) there is no live experiment to mark, and §11
// requires the marker to arrive with the next dial, not to linger after one.
export function shareableConfig(): string {
  const cfg = buildConfig();
  return JSON.stringify(
    {
      seed: seed.value,
      eras: eras.value,
      // the rules that produced it: a seed means nothing without its lineage
      lineage: engineLineage.value,
      config: cfg,
    },
    null,
    2,
  );
}

// Apply a saved config capsule back onto the controls.
export function loadConfigJson(json: string): boolean {
  let c: { seed?: number; eras?: number; lineage?: string; config?: JmConfig };
  try {
    c = JSON.parse(json);
  } catch {
    return false;
  }
  const cfg = c.config;
  if (!cfg || typeof c.seed !== "number" || typeof c.eras !== "number") return false;
  noteLineage(c.lineage);
  noteRetired(cfg);
  seed.value = c.seed;
  eras.value = c.eras;
  panelSize.value = cfg.panel_w === 8 ? "8x10" : "5x6";
  archiveChance.value = String((cfg.archive_permille ?? 0) / 10);
  strokeDie.value = cfg.stroke_die ?? 4;
  strokeAdd.value = cfg.stroke_add ?? 1;
  grMode.value = cfg.greatridge_die ? "rolled" : "choice";
  grDie.value = cfg.greatridge_die || 6;
  grAdd.value = cfg.greatridge_add ?? 0;
  extendCap.value = cfg.extend_cap ?? 4;
  flatWork.value = cfg.work_spread === false;
  addpanelCopies.value = cfg.addpanel_copies ?? 2;
  if (cfg.deck) {
    const copies = { ...DEFAULT_COPIES };
    for (const [kind, n] of cfg.deck)
      if ((KINDS as readonly string[]).includes(kind)) copies[kind as Kind] = n;
    deckCopies.value = copies;
  }
  workOverrides.value = { ...(cfg.work_overrides ?? {}) };
  moodOverrides.value = { ...(cfg.mood_overrides ?? {}) };
  return true;
}

// A loaded file names the rules it was made under. A different lineage is not
// an error and never blocks the load — the same seed simply paints a different
// map, and the notice says so (CONTRACTS §9). No migration is attempted.
function noteLineage(theirs: string | undefined): void {
  foreignLineage.value =
    theirs && engineLineage.value && theirs !== engineLineage.value ? theirs : null;
}

// Dials this lineage has retired. A config saved days ago may still carry one;
// it loads, the key is ignored, and the notice says so once (CONTRACTS §6.3).
const RETIRED = ["exp_fields"] as const;
function noteRetired(cfg: object): void {
  retiredKey.value = RETIRED.find((k) => k in cfg) ?? null;
}

// The deck section alone, for the deck export file.
export function deckExportJson(): string {
  const cfg = buildConfig();
  return JSON.stringify(
    {
      deck: cfg.deck,
      addpanel_copies: cfg.addpanel_copies,
      work_spread: cfg.work_spread ?? true,
      work_overrides: cfg.work_overrides ?? {},
      mood_overrides: cfg.mood_overrides ?? {},
    },
    null,
    2,
  );
}

// The handbook's defaults for deck and dials; seed and eras stay.
export function backToCanon(): void {
  panelSize.value = "5x6";
  archiveChance.value = "0";
  strokeDie.value = 4;
  strokeAdd.value = 1;
  grMode.value = "choice";
  grDie.value = 6;
  grAdd.value = 0;
  extendCap.value = 4;
  flatWork.value = false;
  deckCopies.value = { ...DEFAULT_COPIES };
  addpanelCopies.value = 2;
  workOverrides.value = {};
  moodOverrides.value = {};
}

// --- map view toggles -------------------------------------------------------
export const followPanel = signal(false);
export const showPanelNames = signal(false);
export const traceReworks = signal(false);
export const dimArchived = signal(false);
// The worked units of the age on show, numbered as the record numbers them.
export const workNumbers = signal(true);

// --- run state --------------------------------------------------------------
export type Status = "idle" | "running" | "done" | "paused" | "error";
export const status = signal<Status>("idle");
export const progressEra = signal(0);
export const errorMessage = signal("");

export const world = signal<WorldState | null>(null);
export const worldJson = signal("");
export const events = signal<JmEvent[]>([]);
export const logText = signal("");
export const report = signal("");
export const deckPreview = signal<{ kind: string; work: number }[]>([]);
// The rework marks, computed by the ENGINE (CONTRACTS §2.5). The app never
// decides where a panel-level flourish goes — it only draws what it is given.
export const patinaMarks = signal<Map<string, number>>(new Map());

const toPatinaMap = (rows: [number, number, number][]) =>
  new Map(rows.map(([x, y, n]) => [`${x},${y}`, n] as const));

// --- navigation (time travel) -----------------------------------------------
// position: the age the map shows — era E with A completed ages (A=0: era
// start). seekWorld is that age's engine state; null falls back to `world`.
export const position = signal<{ era: number; age: number } | null>(null);
export const seekWorld = signal<WorldState | null>(null);
export const snapshotEras = signal<number[]>([]);
export const seeking = signal(false);

export const shownWorld = computed(() => seekWorld.value ?? world.value);

export const endPosition = computed(() => {
  const w = world.value;
  if (!w) return null;
  const t = w.time;
  return t.era > t.eras_wanted
    ? { era: t.eras_wanted, age: 25 }
    : { era: t.era, age: t.age_in_era };
});

export function seekTo(era: number, age: number): void {
  const end = endPosition.value;
  const eraList = snapshotEras.value;
  if (!end || !eraList.length || status.value === "running") return;
  era = Math.max(eraList[0], Math.min(era, end.era));
  age = Math.max(0, Math.min(age, era === end.era ? end.age : 25));
  position.value = { era, age };
  if (era === end.era && age === end.age) {
    seekWorld.value = world.value; // the end is the run's own state
    return;
  }
  seeking.value = true;
  ensureWorker().postMessage({ type: "seek", era, age });
}

// --- annotated events (shared by Now + Record) ------------------------------
export interface Annotated {
  era: number;
  age: number;
  panel: string | null;
  rawPanel: [number, number] | null; // the event's own panel, for map marks
  unit: [number, number] | null;
  kind: string;
  payload: Record<string, unknown>;
  text: string[];
}

export const annotatedEvents = computed<Annotated[]>(() => {
  const w = world.value;
  const geo = w ? { w: w.config.panel_w, h: w.config.panel_h } : { w: 5, h: 6 };
  let era = 0,
    age = 0;
  let agePanel: string | null = null;
  return events.value.map((e) => {
    if (e.kind === "era_start" || e.kind === "run_start") {
      era = (e.payload.era as number) ?? era;
      age = 0;
      agePanel = null;
    } else if (e.kind === "age_start") {
      era = e.payload.era as number;
      age = e.payload.age as number;
      agePanel = e.panel ? panelName(e.panel[0], e.panel[1]) : null;
    }
    const panel = e.panel
      ? panelName(e.panel[0], e.panel[1])
      : e.unit
        ? panelName(...panelOf(geo, e.unit[0], e.unit[1]))
        : agePanel;
    return {
      era, age, panel, rawPanel: e.panel, unit: e.unit,
      kind: e.kind, payload: e.payload, text: e.text,
    };
  });
});

// The age on show, as the map draws it: every numbered step of that age finds
// a place, one for one with the record. A step that names a unit badges that
// unit (a unit worked twice carries both numbers); a step that names only a
// panel — a card that could not act, a panel placed, the deck shuffling —
// badges the panel's corner.
export interface WorkMarks {
  units: Map<string, number[]>;
  panels: Map<string, number[]>;
}

const addMark = (m: Map<string, number[]>, key: string, step: number) => {
  const at = m.get(key);
  if (at) {
    if (!at.includes(step)) at.push(step);
  } else {
    m.set(key, [step]);
  }
};

export const workMarks = computed<WorkMarks>(() => {
  const units = new Map<string, number[]>();
  const panels = new Map<string, number[]>();
  const p = position.value;
  if (!p) return { units, panels };
  for (const a of annotatedEvents.value) {
    if (a.era !== p.era || a.age !== p.age) continue;
    const step = a.payload.step as number | undefined;
    if (!step) continue;
    if (a.unit) addMark(units, `${a.unit[0]},${a.unit[1]}`, step);
    else if (a.rawPanel) addMark(panels, `${a.rawPanel[0]},${a.rawPanel[1]}`, step);
  }
  return { units, panels };
});

// The panel the shown age works on (its age_start event's coordinates).
export const currentAgePanel = computed<[number, number] | null>(() => {
  const p = position.value;
  if (!p || p.age === 0) return null;
  const ev = events.value.find(
    (e) =>
      e.kind === "age_start" &&
      e.payload.era === p.era &&
      e.payload.age === p.age,
  );
  return ev?.panel ?? null;
});

// --- the worker client ------------------------------------------------------
let worker: Worker | null = null;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker/sim.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (msg: MessageEvent) => {
    const d = msg.data;
    if (d.type === "progress") {
      progressEra.value = d.era;
    } else if (d.type === "done") {
      world.value = d.state;
      worldJson.value = d.stateJson;
      events.value = d.events;
      logText.value = d.log;
      report.value = d.report;
      snapshotEras.value = d.eras ?? [];
      patinaMarks.value = toPatinaMap(d.patina);
      status.value = d.finished ? "done" : "paused";
      seekWorld.value = d.state;
      position.value = endPosition.value;
    } else if (d.type === "seeked") {
      seekWorld.value = d.state;
      patinaMarks.value = toPatinaMap(d.patina);
      seeking.value = false;
    } else if (d.type === "patina") {
      patinaMarks.value = toPatinaMap(d.patina);
    } else if (d.type === "lineage") {
      engineLineage.value = d.lineage;
      engineVersion.value = d.version;
    } else if (d.type === "preview-deck") {
      deckPreview.value = d.cards;
    } else if (d.type === "error") {
      errorMessage.value = d.message;
      seeking.value = false;
      status.value = "error";
    }
  };
  return worker;
}

export function startRun(): void {
  status.value = "running";
  progressEra.value = 0;
  errorMessage.value = "";
  position.value = null;
  seekWorld.value = null;
  snapshotEras.value = [];
  ensureWorker().postMessage({
    type: "run",
    config: buildConfig(),
    seed: seed.value,
    eras: eras.value,
  });
}

export function reroll(): void {
  seed.value = randomSeed();
  startRun();
}

export function cancelRun(): void {
  ensureWorker().postMessage({ type: "cancel" });
}

export function resumeWorld(): void {
  if (!worldJson.value) return;
  status.value = "running";
  position.value = null;
  seekWorld.value = null;
  ensureWorker().postMessage({ type: "resume", stateJson: worldJson.value });
}

export function loadWorld(json: string): boolean {
  let parsed: WorldState;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  if (parsed?.schema !== "jerrymap-state") return false;
  noteLineage(parsed.lineage);
  world.value = parsed;
  worldJson.value = json;
  events.value = [];
  logText.value = "";
  report.value = "";
  snapshotEras.value = [];
  seekWorld.value = parsed;
  position.value = endPosition.value;
  // a loaded world has no engine handle: ask for its marks by document
  patinaMarks.value = new Map();
  ensureWorker().postMessage({ type: "patina", stateJson: json });
  seed.value = parsed.time.seed;
  eras.value = parsed.time.eras_wanted;
  // Paused even when the run looks complete: Continue re-enters the engine,
  // which finishes instantly and renders the final report from state.
  status.value = "paused";
  return true;
}

export function requestDeckPreview(): void {
  ensureWorker().postMessage({ type: "preview", config: buildConfig() });
}

export function requestLineage(): void {
  ensureWorker().postMessage({ type: "lineage" });
}
