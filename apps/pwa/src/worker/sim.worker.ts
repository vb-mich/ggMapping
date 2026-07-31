// The run worker: the engine lives here; the UI thread only renders.
// Protocol (all local, no network anywhere):
//   in:  { type: "run", config, seed, eras }
//        { type: "resume", stateJson }        — continue a loaded world
//        { type: "preview", config }          — genesis-only deck preview
//        { type: "cancel" }                   — stop at the next era boundary
//   out: { type: "progress", era, erasWanted, agesTotal }
//        { type: "done", finished, state, stateJson, events, log, report }
//        { type: "preview-deck", cards }
//        { type: "error", message }
import { Engine } from "../engine/api";

import type { JmConfig } from "../contracts/schema";

let enginePromise: Promise<Engine> | null = null;
const engine = () => (enginePromise ??= Engine.load());
let cancelRequested = false;

const yieldToInbox = () => new Promise<void>((r) => setTimeout(r, 0));

async function runLoop(eng: Engine, h: number) {
  let t = eng.time(h);
  postMessage({ type: "progress", era: Math.min(t.era, t.eras_wanted), erasWanted: t.eras_wanted, agesTotal: t.ages_total });
  let running = !t.finished;
  while (running && !cancelRequested) {
    const eraBefore = eng.time(h).era;
    do {
      running = eng.step(h);
    } while (running && eng.time(h).era === eraBefore);
    t = eng.time(h);
    postMessage({ type: "progress", era: Math.min(t.era, t.eras_wanted), erasWanted: t.eras_wanted, agesTotal: t.ages_total });
    await yieldToInbox(); // let a cancel message land between eras
  }
  const report = eng.time(h).finished ? eng.report(h) : "";
  postMessage({
    type: "done",
    finished: eng.time(h).finished,
    stateJson: eng.stateJson(h),
    state: eng.state(h),
    events: eng.events(h),
    log: eng.log(h),
    report,
  });
  eng.free(h);
}

onmessage = async (msg: MessageEvent) => {
  const d = msg.data as
    | { type: "run"; config: JmConfig; seed: number; eras: number }
    | { type: "resume"; stateJson: string }
    | { type: "preview"; config: JmConfig }
    | { type: "cancel" };
  try {
    if (d.type === "cancel") {
      cancelRequested = true;
      return;
    }
    const eng = await engine();
    if (d.type === "preview") {
      // A fresh world's deck.order holds every card with its printed work
      // number (the engine's spread rule, not ours). Genesis paints nothing.
      const h = eng.create(d.config, 1, 1);
      const cards = eng.state(h).deck.order.map(({ kind, work }) => ({ kind, work }));
      eng.free(h);
      postMessage({ type: "preview-deck", cards });
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
