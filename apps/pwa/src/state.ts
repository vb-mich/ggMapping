// App state: signals + the worker client. The engine runs in the worker; this
// module holds configuration, run status, and the run's CONTRACTS documents.
import { computed, signal } from "@preact/signals";

import { DEFAULT_COPIES, KINDS, deckWarnings, type DeckEdit, type Kind } from "./deck";
import type { JmConfig, JmEvent, WorldState } from "./contracts/schema";

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

export const deckCopies = signal<Record<Kind, number>>({ ...DEFAULT_COPIES });
export const addpanelCopies = signal(1);
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

// The shareable determinism capsule: seed + eras + full config.
export function shareableConfig(): string {
  return JSON.stringify(
    { seed: seed.value, eras: eras.value, config: buildConfig() },
    null,
    2,
  );
}

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
      status.value = d.finished ? "done" : "paused";
    } else if (d.type === "preview-deck") {
      deckPreview.value = d.cards;
    } else if (d.type === "error") {
      errorMessage.value = d.message;
      status.value = "error";
    }
  };
  return worker;
}

export function startRun(): void {
  status.value = "running";
  progressEra.value = 0;
  errorMessage.value = "";
  ensureWorker().postMessage({
    type: "run",
    config: buildConfig(),
    seed: seed.value,
    eras: eras.value,
  });
}

export function cancelRun(): void {
  ensureWorker().postMessage({ type: "cancel" });
}

export function resumeWorld(): void {
  if (!worldJson.value) return;
  status.value = "running";
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
  world.value = parsed;
  worldJson.value = json;
  events.value = [];
  logText.value = "";
  report.value = "";
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
