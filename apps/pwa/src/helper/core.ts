// The Helper's core: pure session logic over the engine's helper seam
// (CONTRACTS §4.3). No DOM, no storage — the app's screens, the worker-less
// play loop, and the identity tests all drive THIS module, so the record the
// player writes and the record the tests replay cannot be two things.
//
// Design rulings this module embodies (reported in the conversation's report):
//  * The card draw is not a Decider call — deck order is. "The player says
//    which card was drawn" is honored by treating every synthesized shuffle
//    permutation as PROVISIONAL: the paper deck's truth, revealed one draw at
//    a time. Naming a card swaps it to the front INSIDE the governing shuffle
//    record (or checkpoint/origin deck order), which only touches positions
//    no draw has revealed yet; the ages between replay unchanged, and the
//    final record replays byte-for-byte with no amendment machinery in sight.
//  * A world's state document always carries rng "0" (scripted end to end);
//    the Helper's own §3 state lives beside the record.
import type { Engine } from "../engine/api";
import type {
  JmConfig,
  JmEvent,
  HelperQuestion,
  HelperResponse,
  TapeRecord,
  WorldState,
} from "../contracts/schema";
import { origin as panelOrigin, panelOf, type Geo } from "../contracts/geometry";
import type {
  HelperEntry,
  HelperExport,
  Origin,
  OverrideEdit,
  ScriptRow,
} from "./schema";

export class HelperError extends Error {}

const fail = (msg: string): never => {
  throw new HelperError(msg);
};

export const geoOf = (s: WorldState): Geo => ({
  w: s.config.panel_w,
  h: s.config.panel_h,
});

const key = (x: number, y: number) => `${x},${y}`;

// Canonical bytes of a state document: engine emission order survives
// JSON.parse (insertion order), so stringify(parse(x)) is one canonical form.
export const canonical = (s: WorldState): string => JSON.stringify(s);

export const tapeOf = (script: ScriptRow[]): TapeRecord[] => script.map((r) => r.rec);

// --- replay -----------------------------------------------------------------

export interface ReplayedEntry {
  entry: HelperEntry;
  state: WorldState;
  events?: JmEvent[];
}

// The origin's age-zero state. For a blank origin the genesis entry replays
// construction (its script answers the deck build's shuffle).
export function originState(eng: Engine, origin: Origin, genesis?: HelperEntry): {
  state: WorldState;
  events: JmEvent[];
} {
  if (origin.type === "blank") {
    if (!genesis || genesis.type !== "genesis") fail("a blank origin needs its genesis entry");
    const g = genesis as Extract<HelperEntry, { type: "genesis" }>;
    const r = eng.helperCreate(origin.config, origin.seed, origin.eras, tapeOf(g.script));
    if (r.status !== "closed") fail(`genesis did not close: ${JSON.stringify(r).slice(0, 200)}`);
    const c = r as Extract<HelperResponse, { status: "closed" }>;
    if (c.consumed !== g.script.length) fail("genesis left script records unconsumed");
    return { state: c.state, events: c.events };
  }
  return { state: origin.state, events: [] };
}

// One entry forward from a known state. Committed ages replay through the
// PLAIN ScriptedDecider (mode "replay") — the identity test's machinery is
// the play machinery.
export function replayEntry(
  eng: Engine,
  prev: WorldState | null,
  origin: Origin,
  entry: HelperEntry,
): ReplayedEntry {
  if (entry.type === "genesis") {
    const { state, events } = originState(eng, origin, entry);
    return { entry, state, events };
  }
  if (!prev) fail("no prior state to replay from");
  if (entry.type === "checkpoint") {
    return { entry, state: entry.state };
  }
  if (entry.type === "override") {
    return { entry, state: applyOverrides(prev!, entry.edits) };
  }
  const r = eng.helperAge(canonical(prev!), tapeOf(entry.script), "replay");
  if (r.status !== "closed")
    fail(`age replay did not close: ${r.status === "error" ? r.message : r.status}`);
  const c = r as Extract<HelperResponse, { status: "closed" }>;
  if (c.consumed !== entry.script.length)
    fail(`age replay consumed ${c.consumed} of ${entry.script.length} records`);
  const drawn = ageCardOf(c.events);
  if (!drawn || drawn.kind !== entry.card.kind)
    fail(`age replay drew ${drawn?.kind ?? "nothing"}, the record says ${entry.card.kind}`);
  return { entry, state: c.state, events: c.events };
}

// The whole record, origin to frontier. Fails loudly on any divergence.
export function replayAll(
  eng: Engine,
  origin: Origin,
  entries: HelperEntry[],
): ReplayedEntry[] {
  const out: ReplayedEntry[] = [];
  let prev: WorldState | null = origin.type === "blank" ? null : origin.state;
  for (const entry of entries) {
    const rep = replayEntry(eng, prev, origin, entry);
    out.push(rep);
    prev = rep.state;
  }
  return out;
}

// The full game log: origin headers plus every age's engine-rendered lines,
// exactly as a simulator run would have printed them.
export function fullLog(replayed: ReplayedEntry[]): string {
  const lines: string[] = [];
  for (const r of replayed)
    if (r.events) for (const e of r.events) for (const t of e.text) lines.push(t);
  return lines.length ? lines.join("\n") + "\n" : "";
}

// The card an age's events say was played (its age_start header).
export function ageCardOf(events: JmEvent[]): { kind: string } | null {
  const hdr = events.find((e) => e.kind === "age_start");
  return hdr ? { kind: hdr.payload.card as string } : null;
}

// --- the deck cycle (reveal-by-amendment) -----------------------------------

export interface CycleInfo {
  // where the governing order lives: a shuffle record inside an entry's
  // script ("genesis" or "age"), a checkpoint's document, or the origin's
  source:
    | { kind: "record"; entryIndex: number; recordIndex: number }
    | { kind: "checkpoint"; entryIndex: number }
    | { kind: "origin" };
  drawsSince: number; // committed draws consumed from that order
  unrevealed: number; // cards of the cycle no draw has revealed yet
}

const findShuffle = (script: ScriptRow[]): number =>
  script.findIndex((r) => r.rec.kind === "shuffle");

// Walk the committed entries backwards to the governing order. drawsSince
// counts the age entries after it — the age that contains a cycle shuffle
// drew BEFORE shuffling, so its own draw does not count against the new
// order. The order's length is read at its SOURCE: wake-added cards join the
// current order's tail and are provably behind the marker, so they never
// enter a cycle before its shuffle.
export function cycleInfo(
  entries: HelperEntry[],
  origin: Origin,
): CycleInfo {
  let drawsSince = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "checkpoint") {
      return {
        source: { kind: "checkpoint", entryIndex: i },
        drawsSince,
        unrevealed: e.state.deck.order.length - drawsSince,
      };
    }
    if (e.type === "genesis" || e.type === "age") {
      const at = findShuffle(e.script);
      if (at >= 0) {
        const order = (e.script[at].rec.result as number[]).length;
        return {
          source: { kind: "record", entryIndex: i, recordIndex: at },
          drawsSince,
          unrevealed: order - drawsSince,
        };
      }
    }
    if (e.type === "age") drawsSince += 1;
  }
  if (origin.type === "blank")
    fail("a blank world's cycle must trace to its genesis shuffle");
  return {
    source: { kind: "origin" },
    drawsSince,
    unrevealed:
      (origin as Extract<Origin, { type: "fork" | "paper" }>).state.deck.order.length -
      drawsSince,
  };
}

// What the picker mirrors: the cards of this cycle no draw has revealed,
// grouped by the print on their faces (kind + work).
export interface RemainingCard {
  kind: string;
  work: number;
  count: number;
}

export function remainingCards(
  entries: HelperEntry[],
  origin: Origin,
  current: WorldState,
): RemainingCard[] {
  const ci = cycleInfo(entries, origin);
  // every card of the cycle revealed: the next draw is FORCED — the marked
  // first card coming around to complete the cycle
  const prefix =
    ci.unrevealed > 0
      ? current.deck.order.slice(0, ci.unrevealed)
      : current.deck.order.slice(0, 1);
  if (!prefix.length) fail("the deck is empty — the record is inconsistent");
  const groups = new Map<string, RemainingCard>();
  for (const c of prefix) {
    const k = `${c.kind}|${c.work}`;
    const g = groups.get(k);
    if (g) g.count += 1;
    else groups.set(k, { kind: c.kind, work: c.work, count: 1 });
  }
  return [...groups.values()];
}

// Reveal the next draw: make the engine's front card the named one by editing
// the governing provisional order at positions no draw has revealed. Returns
// the edited entries/origin (untouched objects when the front already
// matches) and whether downstream states must be recomputed.
export interface RevealResult {
  entries: HelperEntry[];
  origin: Origin;
  amendedFrom: number | null; // entry index to replay from (null: nothing changed)
}

export function revealCard(
  entries: HelperEntry[],
  origin: Origin,
  current: WorldState,
  want: { kind: string; work: number },
): RevealResult {
  const ci = cycleInfo(entries, origin);
  if (ci.unrevealed <= 0) {
    // the cycle's forced final draw: the marked card returning. No
    // amendment is possible — the reveal must be that very card.
    const front = current.deck.order[0];
    if (front.kind !== want.kind || front.work !== want.work)
      fail(`the cycle completes with ${front.kind} (work ${front.work}), not ${want.kind}`);
    return { entries, origin, amendedFrom: null };
  }
  const prefix = current.deck.order.slice(0, ci.unrevealed);
  const at = prefix.findIndex((c) => c.kind === want.kind && c.work === want.work);
  if (at < 0)
    fail(`${want.kind} (work ${want.work}) is not among this cycle's unrevealed cards`);
  if (at === 0) return { entries, origin, amendedFrom: null };

  const a = ci.drawsSince; // governing-order position of the next draw
  const b = ci.drawsSince + at; // where the named card sits
  if (ci.source.kind === "record") {
    const { entryIndex, recordIndex } = ci.source;
    const src = entries[entryIndex];
    if (src.type !== "genesis" && src.type !== "age") fail("cycle source is not a script");
    const script = (src as Extract<HelperEntry, { type: "genesis" | "age" }>).script;
    const perm = (script[recordIndex].rec.result as number[]).slice();
    [perm[a], perm[b]] = [perm[b], perm[a]];
    const editedRow: ScriptRow = {
      ...script[recordIndex],
      rec: { ...script[recordIndex].rec, result: perm },
    };
    const editedScript = script.slice();
    editedScript[recordIndex] = editedRow;
    const editedEntry = { ...src, script: editedScript } as HelperEntry;
    const out = entries.slice();
    out[entryIndex] = editedEntry;
    return { entries: out, origin, amendedFrom: entryIndex };
  }
  if (ci.source.kind === "checkpoint") {
    const idx = ci.source.entryIndex;
    const src = entries[idx];
    if (src.type !== "checkpoint") fail("cycle source is not a checkpoint");
    const cp = src as Extract<HelperEntry, { type: "checkpoint" }>;
    const state = structuredClone(cp.state);
    const ord = state.deck.order;
    [ord[a], ord[b]] = [ord[b], ord[a]];
    const out = entries.slice();
    out[idx] = { ...cp, state };
    return { entries: out, origin, amendedFrom: idx };
  }
  // origin-held order (fork and paper worlds before any shuffle of their own)
  if (origin.type === "blank")
    throw new HelperError("a blank origin's order lives in its genesis record");
  const state = structuredClone(origin.state);
  const ord = state.deck.order;
  [ord[a], ord[b]] = [ord[b], ord[a]];
  return { entries, origin: { ...origin, state }, amendedFrom: -1 };
}

// --- overrides (the truth hierarchy: paper wins) ----------------------------

// Apply paint-editor edits to a §6 document. Panel filled counts follow the
// painted units of every touched panel; full/archive declarations maintain
// atlas, binder, and the stack exactly as the schema keeps them (§6.2).
export function applyOverrides(state: WorldState, edits: OverrideEdit[]): WorldState {
  const s = structuredClone(state);
  const geo = geoOf(s);
  const w = s.world;
  const touched = new Set<string>();

  const baseMap = new Map(w.base.map(([x, y, r]) => [key(x, y), r] as const));
  const wildSet = new Set(w.wild.map(([x, y]) => key(x, y)));
  const markMap = new Map(w.marks.map(([x, y, m]) => [key(x, y), m] as const));
  const panelSet = new Map(w.panels.map(([tx, ty, n]) => [key(tx, ty), n] as const));
  const atlasSet = new Set(w.atlas.map(([tx, ty]) => key(tx, ty)));
  const binderSet = new Set(w.binder.map(([tx, ty]) => key(tx, ty)));
  let stack = w.stack.slice();
  let people = w.people.slice(); // insertion order is semantic (§6.1)

  const touchUnit = (u: [number, number]) => {
    const [tx, ty] = panelOf(geo, u[0], u[1]);
    touched.add(key(tx, ty));
  };

  for (const e of edits) {
    if (e.op === "base") {
      if (e.elevation === null) baseMap.delete(key(...e.unit));
      else baseMap.set(key(...e.unit), e.elevation);
      touchUnit(e.unit);
    } else if (e.op === "mark") {
      if (e.mark === null) {
        markMap.delete(key(...e.unit));
        wildSet.delete(key(...e.unit));
      } else {
        markMap.set(key(...e.unit), e.mark);
        wildSet.add(key(...e.unit)); // a mark implies wild membership (§6.2)
      }
    } else if (e.op === "wild") {
      if (e.wild) wildSet.add(key(...e.unit));
      else if (!markMap.has(key(...e.unit))) wildSet.delete(key(...e.unit));
    } else if (e.op === "people") {
      const k = key(...e.unit);
      const at = people.findIndex(([x, y]) => key(x, y) === k);
      if (e.kind === null) {
        if (at >= 0) people = people.filter((_, i) => i !== at);
      } else if (at >= 0) {
        people = people.slice();
        people[at] = [e.unit[0], e.unit[1], e.kind]; // in place: order kept
      } else {
        people = [...people, [e.unit[0], e.unit[1], e.kind]]; // append: python-dict law
      }
    } else if (e.op === "panel") {
      const pk = key(...e.panel);
      const inStack = () => stack.some(([tx, ty]) => key(tx, ty) === pk);
      if (e.action === "add") {
        if (!panelSet.has(pk)) {
          panelSet.set(pk, 0);
          if (!inStack()) stack = [...stack, e.panel];
        }
      } else if (e.action === "remove") {
        panelSet.delete(pk);
        atlasSet.delete(pk);
        binderSet.delete(pk);
        stack = stack.filter(([tx, ty]) => key(tx, ty) !== pk);
      } else if (e.action === "full") {
        panelSet.set(pk, geo.w * geo.h);
        atlasSet.add(pk);
      } else if (e.action === "notFull") {
        atlasSet.delete(pk);
        touched.add(pk); // recount from paint below
      } else if (e.action === "archive") {
        atlasSet.add(pk);
        binderSet.add(pk);
        panelSet.set(pk, geo.w * geo.h);
        stack = stack.filter(([tx, ty]) => key(tx, ty) !== pk);
      } else if (e.action === "unarchive") {
        binderSet.delete(pk);
        if (!inStack()) stack = [...stack, e.panel];
      }
    } else if (e.op === "stack") {
      const have = new Set(stack.map(([tx, ty]) => key(tx, ty)));
      const given = new Set(e.order.map(([tx, ty]) => key(tx, ty)));
      if (have.size !== given.size || [...have].some((k2) => !given.has(k2)))
        fail("a stack order must name exactly the panels in rotation");
      stack = e.order.slice();
    }
  }

  // painted units are the count of every panel touched by a base edit —
  // unless the panel is DECLARED full/archived (a skeleton fact that stands
  // until its detail arrives)
  for (const pk of touched) {
    if (!panelSet.has(pk)) continue;
    if (binderSet.has(pk)) continue;
    let n = 0;
    for (const k2 of baseMap.keys()) {
      const [x, y] = k2.split(",").map(Number);
      const [tx, ty] = panelOf(geo, x, y);
      if (key(tx, ty) === pk) n++;
    }
    const declaredFull = atlasSet.has(pk) && n === 0;
    if (!declaredFull) panelSet.set(pk, n);
  }

  const sortNum = <T extends readonly [number, number, ...unknown[]] | readonly [number, number]>(
    a: T,
    b: T,
  ) => a[0] - b[0] || a[1] - b[1];
  w.base = [...baseMap.entries()]
    .map(([k2, r]) => [...k2.split(",").map(Number), r] as [number, number, number])
    .sort(sortNum);
  w.wild = [...wildSet]
    .map((k2) => k2.split(",").map(Number) as [number, number])
    .sort(sortNum);
  w.marks = [...markMap.entries()]
    .map(([k2, m]) => [...k2.split(",").map(Number), m] as [number, number, string])
    .sort(sortNum);
  w.panels = [...panelSet.entries()]
    .map(([k2, n]) => [...k2.split(",").map(Number), n] as [number, number, number])
    .sort(sortNum);
  w.atlas = [...atlasSet]
    .map((k2) => k2.split(",").map(Number) as [number, number])
    .sort(sortNum);
  w.binder = [...binderSet]
    .map((k2) => k2.split(",").map(Number) as [number, number])
    .sort(sortNum);
  w.stack = stack;
  w.people = people;
  return s;
}

// --- beyond-Spread detection ------------------------------------------------

// Panels an age response touches that the player has not entered yet: the
// events' own units plus (for a question) every candidate unit on offer.
export function panelsTouchedOutside(
  entered: [number, number][] | null,
  state: WorldState,
  events: JmEvent[],
  question: HelperQuestion | null,
): [number, number][] {
  if (!entered) return [];
  const geo = geoOf(state);
  const have = new Set(entered.map(([tx, ty]) => key(tx, ty)));
  const out = new Map<string, [number, number]>();
  const noteUnit = (u: [number, number]) => {
    const [tx, ty] = panelOf(geo, u[0], u[1]);
    if (!have.has(key(tx, ty))) out.set(key(tx, ty), [tx, ty]);
  };
  for (const e of events) if (e.unit) noteUnit(e.unit);
  if (question) {
    for (const c of question.cands ?? []) {
      if (Array.isArray(c) && question.purpose !== "panel position")
        noteUnit(c as [number, number]);
      else if (typeof c === "object" && !Array.isArray(c)) {
        noteUnit(c.unit);
        if (c.facing) noteUnit(c.facing);
        if (c.outside) noteUnit(c.outside);
      }
    }
    for (const row of question.ctx ?? []) for (const u of row.units) noteUnit(u);
  }
  return [...out.values()];
}

// The Spread an age needs entered before it runs: the working panel and its
// side neighbors (handbook: "the current panel with its map neighbors").
export function spreadOf(state: WorldState): [number, number][] {
  const front = state.world.stack[0];
  if (!front) return [];
  const exists = new Set(state.world.panels.map(([tx, ty]) => key(tx, ty)));
  const around: [number, number][] = [[front[0], front[1]]];
  const step = (v: number, d: number) => (v + d === 0 ? (d > 0 ? 1 : -1) : v + d);
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const tx = dx ? step(front[0], dx) : front[0];
    const ty = dy ? step(front[1], dy) : front[1];
    if (exists.has(key(tx, ty))) around.push([tx, ty]);
  }
  return around;
}

// --- builders: paper origins and checkpoints --------------------------------

// The printed cards of a config's deck, read from the ENGINE (the spread
// rule is rules, so no port of it may grow here): a fresh world's deck for
// the main cards, stepped to the wake for the Add Panel prints.
export function deckPrints(
  eng: Engine,
  config: JmConfig,
): { main: { kind: string; work: number }[]; addpanel: { kind: string; work: number }[] } {
  // ask with an empty script first (the shuffle question tells us the deck
  // size), then answer with the identity permutation — any order does
  const probe = eng.helperCreate(config, 1, 1, []);
  let main: { kind: string; work: number; uid: number }[] = [];
  if (probe.status === "question") {
    const n = probe.question.domain;
    const r = eng.helperCreate(config, 1, 1, [
      { kind: "shuffle", purpose: "deck", domain: n, result: [...Array(n).keys()] },
    ]);
    if (r.status !== "closed") fail("deck probe failed");
    main = (r as Extract<HelperResponse, { status: "closed" }>).state.deck.order;
  } else if (probe.status === "closed") {
    main = probe.state.deck.order;
  } else {
    fail(`deck probe failed: ${probe.message}`);
  }
  const byUid = [...main].sort((a, b) => a.uid - b.uid);
  // the Add Panel prints: from the engine's own wake table via a scratch
  // simulator run (handle-based, cheap, discarded)
  const h = eng.create({ ...config }, 1, Math.max(2, 2));
  let addpanel: { kind: string; work: number }[] = [];
  try {
    for (let i = 0; i < 60; i++) {
      if (!eng.step(h)) break;
      const st = eng.state(h);
      if (st.deck.order.some((c) => c.kind === "addpanel")) {
        addpanel = [...st.deck.order]
          .filter((c) => c.kind === "addpanel")
          .sort((a, b) => a.uid - b.uid)
          .map(({ kind, work }) => ({ kind, work }));
        break;
      }
    }
  } finally {
    eng.free(h);
  }
  return { main: byUid.map(({ kind, work }) => ({ kind, work })), addpanel };
}

export interface DeckAnswer {
  freshShuffle: boolean; // the player just shuffled (or is told to)
  marked: { kind: string; work: number } | null; // mid-cycle: the marked card
  played: { kind: string; work: number }[]; // mid-cycle: already played this cycle
}

export interface PaperEntry {
  config: JmConfig;
  era: number;
  ageInEra: number; // completed ages of that era, 0..24
  panels: {
    panel: [number, number];
    status: "open" | "full" | "archived";
  }[];
  stackOrder: [number, number][]; // the paper Stack, front first (non-archived)
  deck: DeckAnswer;
}

// A paper world's first §6 document: the skeleton, the calendar, the deck.
// Unit detail arrives later, on demand, as overrides; this document is the
// world as first believed.
export function buildPaperState(
  eng: Engine,
  lineage: string,
  p: PaperEntry,
  rngState: string,
): { state: WorldState; rngState: string } {
  const geo: Geo = { w: p.config.panel_w ?? 5, h: p.config.panel_h ?? 6 };
  const area = geo.w * geo.h;
  const genesis: [number, number][] =
    geo.w === 5 && geo.h === 6
      ? [
          [-1, 2], [1, 2], [-2, 1], [-1, 1], [1, 1], [2, 1],
          [-2, -1], [-1, -1], [1, -1], [2, -1], [-1, -2], [1, -2],
        ]
      : [
          [-1, 1], [1, 1], [-1, -1], [1, -1],
        ];
  const have = new Set(p.panels.map((x) => key(...x.panel)));
  for (const g of genesis)
    if (!have.has(key(...g)))
      fail(`the genesis panel at ${g[0]},${g[1]} must exist on any paper map`);

  const { deck, rngState: rng2 } = buildPaperDeck(eng, p.config, p.era, p.deck, rngState);

  const panels = p.panels
    .map(
      (x) =>
        [x.panel[0], x.panel[1], x.status === "open" ? 0 : area] as [
          number,
          number,
          number,
        ],
    )
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const atlas = p.panels
    .filter((x) => x.status !== "open")
    .map((x) => x.panel)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const binder = p.panels
    .filter((x) => x.status === "archived")
    .map((x) => x.panel)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rotation = new Set(
    p.panels.filter((x) => x.status !== "archived").map((x) => key(...x.panel)),
  );
  const stackSet = new Set(p.stackOrder.map((x) => key(...x)));
  if (rotation.size !== stackSet.size || [...rotation].some((k2) => !stackSet.has(k2)))
    fail("the Stack must hold exactly the non-archived panels");

  const cfg: WorldState["config"] = {
    panel_w: geo.w,
    panel_h: geo.h,
    deck: p.config.deck ?? [
      ["extend", 1], ["basin", 3], ["ridge", 1], ["greatridge", 1],
      ["settlement", 4], ["calm", 7], ["anomaly", 1], ["freestroke", 2],
    ],
    wake_era: 2,
    alive: true,
    semi: true,
    fragile: true,
    addpanel_copies: p.config.addpanel_copies ?? 2,
    work_spread: p.config.work_spread ?? true,
    work_overrides: p.config.work_overrides ?? {},
    mood_overrides: p.config.mood_overrides ?? {},
    archive_permille: p.config.archive_permille ?? 0,
    stroke_die: p.config.stroke_die ?? 4,
    stroke_add: p.config.stroke_add ?? 1,
    greatridge_die: p.config.greatridge_die ?? 0,
    greatridge_add: p.config.greatridge_add ?? 0,
    extend_cap: p.config.extend_cap ?? 4,
    max_panels: p.config.max_panels ?? 0,
  };

  const state: WorldState = {
    schema: "jerrymap-state",
    version: 1,
    lineage,
    config: cfg,
    rng: { algo: "pcg32/stream54", state: "0" },
    time: {
      seed: 0,
      eras_wanted: 100000,
      era: p.era,
      age_in_era: p.ageInEra,
      ages_total: (p.era - 1) * 25 + p.ageInEra,
    },
    world: {
      panels,
      base: [],
      wild: [],
      marks: [],
      people: [],
      embellish: [],
      embellish_panel: [],
      atlas,
      binder,
      stack: p.stackOrder.slice(),
    },
    deck,
    chronicle: {
      era_rows: [],
      metrics: {
        cliffs: 0, nudges: 0, merges: 0, free_panels: 0, fills: 0,
        stroke_units: 0, reworks: 0, crumbles: 0, embellish: 0,
      },
      skips: {},
      firsts: {},
      genesis_panels: genesis,
      genesis_coverage: null,
      completed_per_era: {},
      added_per_era: {},
    },
    carry: { step: 0, panel: null },
  };
  return { state, rngState: rng2 };
}

// The deck section of a paper or catch-up document: the config's printed
// cards (engine-derived), the woken Add Panel copies when the era says so,
// unplayed cards first in a provisional random order — the paper's truth,
// revealed draw by draw — then this cycle's played cards, then the marker.
export function buildPaperDeck(
  eng: Engine,
  config: JmConfig,
  era: number,
  answer: DeckAnswer,
  rngState: string,
): { deck: WorldState["deck"]; rngState: string } {
  const prints = deckPrints(eng, config);
  const woken = era >= 2;
  const all = woken ? [...prints.main, ...prints.addpanel] : prints.main;
  const cards = all.map((c, i) => ({ kind: c.kind, work: c.work, uid: i }));

  let markerUid: number | null = null;
  let unplayed = cards;
  let played: typeof cards = [];
  if (!answer.freshShuffle) {
    const take = (want: { kind: string; work: number }, from: typeof cards) => {
      const at = from.findIndex((c) => c.kind === want.kind && c.work === want.work);
      if (at < 0) fail(`the deck holds no unplayed ${want.kind} (work ${want.work})`);
      const c = from[at];
      return { c, rest: from.filter((_, i) => i !== at) };
    };
    let pool = cards;
    if (answer.marked) {
      const { c, rest } = take(answer.marked, pool);
      markerUid = c.uid;
      played = [c];
      pool = rest;
    }
    for (const w of answer.played) {
      const { c, rest } = take(w, pool);
      played.push(c);
      pool = rest;
    }
    unplayed = pool;
    if (!unplayed.length) fail("a cycle cannot have every card already played");
  }

  const { perm, state } = eng.perm(unplayed.length, rngState);
  const provisional = perm.map((i) => unplayed[i]);
  return {
    deck: {
      order: [...provisional, ...played],
      marker_uid: markerUid,
      woken,
      next_uid: cards.length,
    },
    rngState: state,
  };
}

// An away-from-tool catch-up: the calendar advances by N, the deck resets to
// the player's answers, everything else stands until the paint editor says
// otherwise. Recorded as a checkpoint (a state set, with the age count).
export function buildCatchupState(
  eng: Engine,
  prev: WorldState,
  agesAdvanced: number,
  deckAnswer: DeckAnswer,
  rngState: string,
): { state: WorldState; rngState: string } {
  const s = structuredClone(prev);
  const total = s.time.age_in_era + agesAdvanced;
  s.time.era += Math.floor(total / 25);
  s.time.age_in_era = total % 25;
  s.time.ages_total += agesAdvanced;
  const { deck, rngState: rng2 } = buildPaperDeck(
    eng,
    s.config,
    s.time.era,
    deckAnswer,
    rngState,
  );
  s.deck = deck;
  s.carry = { step: 0, panel: null };
  return { state: s, rngState: rng2 };
}

// --- export / import --------------------------------------------------------

export function exportWorld(meta: {
  name: string;
  lineage: string;
  origin: Origin;
  modePref: "guided" | "proposal";
  rngState: string;
  entered: [number, number][] | null;
  open: HelperExport["open"];
  entries: HelperEntry[];
}): HelperExport {
  return {
    file: "jm-helper-world",
    version: 1,
    exported: Date.now(),
    name: meta.name,
    lineage: meta.lineage,
    origin: meta.origin,
    modePref: meta.modePref,
    rngState: meta.rngState,
    entered: meta.entered,
    entries: meta.entries,
    open: meta.open,
  };
}

// Import verifies by replaying the whole record — the identity test is the
// import path. A foreign lineage is not an error here; the caller shows the
// standing notice and the record opens read-only against this engine only if
// the engine accepts its documents (CONTRACTS §6.3 rejects foreign worlds).
export function verifyImport(eng: Engine, file: HelperExport): ReplayedEntry[] {
  if (file.file !== "jm-helper-world" || file.version !== 1)
    fail("not a Helper world this app understands");
  return replayAll(eng, file.origin, file.entries);
}

// --- the map's question overlay ---------------------------------------------

// Units to glow for a spatial question, keyed for the canvas: candidate
// index -> its units. Numbers and panels return empty (they render as
// buttons and panel outlines instead).
export function questionUnits(q: HelperQuestion): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>();
  (q.cands ?? []).forEach((c, i) => {
    if (Array.isArray(c) && q.purpose !== "panel position") {
      out.set(i, [c as [number, number]]);
    } else if (typeof c === "object" && !Array.isArray(c)) {
      out.set(i, [c.unit]);
    } else if (q.ctx && q.ctx[i]) {
      out.set(i, q.ctx[i].units);
    }
  });
  return out;
}

// Panel candidates (purpose "panel position"): index -> panel.
export function questionPanels(q: HelperQuestion): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  if (q.purpose !== "panel position") return out;
  (q.cands ?? []).forEach((c, i) => {
    if (Array.isArray(c)) out.set(i, c as [number, number]);
  });
  return out;
}

// A unit's panel origin, exported for hit-testing in the screens.
export { panelOrigin };
