// The run worker: the engine lives here; the UI thread only renders.
// Protocol (all local, no network anywhere):
//   in:  { type: "run", config, seed, eras }
//        { type: "resume", stateJson }        — continue a loaded world
//        { type: "preview", config }          — genesis-only deck preview
//        { type: "cancel" }                   — stop at the next era boundary
//        { type: "seek", era, age }           — world state at an age (time travel)
//        { type: "lineage" }                  — ask the engine which rules it speaks
//        { type: "patina", stateJson }        — the render marks for a world
//   out: { type: "progress", era, erasWanted, agesTotal }
//        { type: "done", finished, state, stateJson, events, log, report, eras }
//        { type: "seeked", era, age, state }
//        { type: "preview-deck", cards }
//        { type: "error", message }
//
// Time travel: during a run the worker snapshots the CONTRACTS §6 state at the
// start of every era (age boundaries are the legal save points). A seek loads
// the era's snapshot and steps the remaining ages; a cached handle makes
// forward scrubbing one step per age.
import { Engine } from "../engine/api";

import type { JmConfig } from "../contracts/schema";

let enginePromise: Promise<Engine> | null = null;
const engine = () => (enginePromise ??= Engine.load());
let cancelRequested = false;

// snapshots[era] = state JSON at era start (era 1 = the fresh world)
let snapshots = new Map<number, string>();
let seekCache: { h: number; era: number; age: number } | null = null;

const yieldToInbox = () => new Promise<void>((r) => setTimeout(r, 0));

async function runLoop(eng: Engine, h: number) {
  snapshots = new Map();
  if (seekCache) { eng.free(seekCache.h); seekCache = null; }
  let t = eng.time(h);
  if (!t.finished && t.age_in_era === 0 && t.era <= t.eras_wanted)
    snapshots.set(t.era, eng.stateJson(h));
  postMessage({ type: "progress", era: Math.min(t.era, t.eras_wanted), erasWanted: t.eras_wanted, agesTotal: t.ages_total });
  let running = !t.finished;
  while (running && !cancelRequested) {
    const eraBefore = eng.time(h).era;
    do {
      running = eng.step(h);
      const tt = eng.time(h);
      if (running && tt.age_in_era === 0 && tt.era <= tt.eras_wanted)
        snapshots.set(tt.era, eng.stateJson(h));
    } while (running && eng.time(h).era === eraBefore);
    t = eng.time(h);
    postMessage({ type: "progress", era: Math.min(t.era, t.eras_wanted), erasWanted: t.eras_wanted, agesTotal: t.ages_total });
    await yieldToInbox(); // let a cancel message land between eras
  }
  const report = eng.time(h).finished ? eng.report(h) : "";
  const endState = eng.stateJson(h);
  postMessage({
    type: "done",
    finished: eng.time(h).finished,
    stateJson: endState,
    state: JSON.parse(endState),
    patina: eng.patina(endState),
    events: eng.events(h),
    log: eng.log(h),
    report,
    eras: [...snapshots.keys()].sort((a, b) => a - b),
  });
  eng.free(h);
}

async function seek(eng: Engine, era: number, age: number) {
  const snap = snapshots.get(era);
  if (!snap) throw new Error(`no snapshot for era ${era}`);
  let sc = seekCache;
  if (!(sc && sc.era === era && sc.age <= age)) {
    if (sc) eng.free(sc.h);
    sc = { h: eng.loadState(snap), era, age: 0 };
  }
  while (sc.age < age && eng.step(sc.h)) sc.age += 1;
  seekCache = sc;
  const doc = eng.stateJson(sc.h);
  postMessage({ type: "seeked", era, age, state: JSON.parse(doc),
                patina: eng.patina(doc) });
}

onmessage = async (msg: MessageEvent) => {
  const d = msg.data as
    | { type: "run"; config: JmConfig; seed: number; eras: number }
    | { type: "resume"; stateJson: string }
    | { type: "preview"; config: JmConfig }
    | { type: "seek"; era: number; age: number }
    | { type: "lineage" }
    | { type: "patina"; stateJson: string }
    | { type: "cancel" };
  try {
    if (d.type === "cancel") {
      cancelRequested = true;
      return;
    }
    const eng = await engine();
    if (d.type === "lineage") {
      postMessage({ type: "lineage", lineage: eng.lineage(), version: eng.version() });
      return;
    }
    if (d.type === "preview") {
      // A fresh world's deck.order holds every card with its printed work
      // number (the engine's spread rule, not ours). Genesis paints nothing.
      const h = eng.create(d.config, 1, 1);
      const cards = eng.state(h).deck.order.map(({ kind, work }) => ({ kind, work }));
      eng.free(h);
      postMessage({ type: "preview-deck", cards });
      return;
    }
    if (d.type === "seek") {
      await seek(eng, d.era, d.age);
      return;
    }
    if (d.type === "patina") {
      postMessage({ type: "patina", patina: eng.patina(d.stateJson) });
      return;
    }
    cancelRequested = false;
    if (d.type === "run") {
      await runLoop(eng, eng.create(d.config, d.seed, d.eras));
    } else {
      await runLoop(eng, eng.loadState(d.stateJson));
    }
  } catch (e) {
    postMessage({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
