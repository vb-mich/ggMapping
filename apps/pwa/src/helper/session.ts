// A Helper session: one world's record held live — the guided loop, the
// proposal loop, reveals, overrides, checkpoints, undo, commit, reopen.
// In-memory over plain data; storage is the caller's business. The identity
// tests drive this very class, so play and replay cannot drift apart.
import type { Engine } from "../engine/api";
import type {
  HelperQuestion,
  HelperResponse,
  JmConfig,
  JmEvent,
  WorldState,
} from "../contracts/schema";
import {
  HelperError,
  ageCardOf,
  applyOverrides,
  buildCatchupState,
  canonical,
  cycleInfo,
  originState,
  panelsTouchedOutside,
  remainingCards,
  replayAll,
  replayEntry,
  revealCard,
  spreadOf,
  tapeOf,
  type DeckAnswer,
  type ReplayedEntry,
} from "./core";
import { isKnownPurpose, type HelperEntry, type Origin, type OverrideEdit, type OpenAge, type RowSource, type ScriptRow } from "./schema";

export type AgeView =
  | {
      kind: "question";
      question: HelperQuestion;
      events: JmEvent[];
      freshFrom: number; // index into events: lines newer than the last answer
    }
  | {
      kind: "closed";
      state: WorldState;
      events: JmEvent[];
      finished: boolean;
      freshFrom: number;
    };

export interface SessionData {
  origin: Origin;
  entries: HelperEntry[];
  rngState: string;
  entered: [number, number][] | null;
  open: OpenAge | null;
}

export class HelperSession {
  origin: Origin;
  entries: HelperEntry[];
  rngState: string;
  entered: [number, number][] | null;
  open: OpenAge | null;

  // post-states aligned with entries; [i] = the world after entries[i]
  private states: ReplayedEntry[] = [];
  private lastEventCount = 0;
  view: AgeView | null = null;

  // The age-start glance: ONE question before each age — "does this match
  // your paper?". The session owns the answer; every calendar movement
  // re-asks. (Component state was the wrong home: remounts and persistence
  // races made the glance flicker or vanish.)
  glanceDone = false;

  constructor(
    private eng: Engine,
    data: SessionData,
    cached?: ReplayedEntry[], // this device's stored post-states, trusted on load
  ) {
    this.origin = data.origin;
    this.entries = data.entries;
    this.rngState = data.rngState;
    this.entered = data.entered;
    this.open = data.open;
    this.states =
      cached && cached.length === data.entries.length
        ? cached
        : replayAll(this.eng, this.origin, this.entries);
    if (this.open) this.run(); // resume a mid-age session
  }

  // The world at the frontier (before the open age).
  current(): WorldState {
    if (this.states.length) return this.states[this.states.length - 1].state;
    if (this.origin.type === "blank")
      throw new HelperError("a blank world plays from its genesis entry");
    return this.origin.state;
  }

  committed(): ReplayedEntry[] {
    return this.states;
  }

  // --- lifecycle: fresh worlds ---------------------------------------------

  // A blank world's genesis: construction asks for the deck build's shuffle;
  // the Helper answers with a provisional order — the paper deck's truth,
  // revealed draw by draw (amendment happens at reveal time, not here).
  static createBlank(
    eng: Engine,
    config: JmConfig,
    seed: number,
    eras: number,
    rngState: string,
  ): { data: SessionData; rngState: string } {
    const ask = eng.helperCreate(config, seed, eras, []);
    if (ask.status !== "question" || ask.question.kind !== "shuffle")
      throw new HelperError("construction did not ask for the deck shuffle");
    const { perm, state } = eng.perm(ask.question.domain, rngState);
    const genesis: HelperEntry = {
      type: "genesis",
      script: [
        {
          rec: {
            kind: "shuffle",
            purpose: "deck",
            domain: ask.question.domain,
            result: perm,
          },
          source: "auto",
        },
      ],
    };
    return {
      data: {
        origin: { type: "blank", config, seed, eras },
        entries: [genesis],
        rngState: state,
        entered: null,
        open: null,
      },
      rngState: state,
    };
  }

  // Fork a simulator world: run it to the requested age, then hand the paper
  // player a fresh cycle — their physical deck starts unshuffled in their
  // hands, so the order becomes provisional (revealed by play) and the
  // marker clears; the next card played marks the new cycle.
  static createFork(
    eng: Engine,
    config: JmConfig,
    seed: number,
    eras: number,
    ages: number,
    rngState: string,
  ): { data: SessionData; rngState: string } {
    const h = eng.create(config, seed, eras);
    try {
      for (let i = 0; i < ages; i++) if (!eng.step(h)) break;
      const doc = eng.state(h);
      doc.rng.state = "0"; // scripted from here on; the sim's rng retires
      doc.time.eras_wanted = 100000; // the Helper's game is open-ended
      const { perm, state } = eng.perm(doc.deck.order.length, rngState);
      doc.deck.order = perm.map((i) => doc.deck.order[i]);
      doc.deck.marker_uid = null;
      const forkedAtAges = doc.time.ages_total;
      return {
        data: {
          origin: { type: "fork", config, seed, eras, forkedAtAges, state: doc },
          entries: [],
          rngState: state,
          entered: null,
          open: null,
        },
        rngState: state,
      };
    } finally {
      eng.free(h);
    }
  }

  // --- the deck ------------------------------------------------------------

  remaining() {
    return remainingCards(this.entries, this.origin, this.current());
  }

  cycle() {
    return cycleInfo(this.entries, this.origin);
  }

  // The player confirmed the glance: the map matches the paper.
  confirmGlance(): void {
    this.glanceDone = true;
  }

  // --- the age loop ---------------------------------------------------------

  // Begin an age: reveal the card (amending the governing provisional order
  // when the paper draw disagrees with the engine's), then run to the first
  // open decision.
  beginAge(card: { kind: string; work: number }, mode: "guided" | "proposal"): AgeView {
    if (this.open) throw new HelperError("an age is already open");
    const r = revealCard(this.entries, this.origin, this.current(), card);
    if (r.amendedFrom !== null) {
      this.origin = r.origin;
      this.entries = r.entries;
      this.recompute(r.amendedFrom);
      const front = this.current().deck.order[0];
      if (front.kind !== card.kind || front.work !== card.work)
        throw new HelperError("the reveal did not reach the front of the deck");
    }
    this.open = { card, mode, script: [], proposal: null };
    this.lastEventCount = 0;
    return mode === "proposal" ? this.propose() : this.run();
  }

  // Draw-for-me: a uniform draw among the cycle's unrevealed cards (the
  // cycle's forced final draw needs no die), then the same reveal path.
  drawForMe(mode: "guided" | "proposal"): { card: { kind: string; work: number }; view: AgeView } {
    const ci = this.cycle();
    let index = 0;
    if (ci.unrevealed > 1) {
      const roll = this.eng.roll(ci.unrevealed, this.rngState);
      this.rngState = roll.state;
      index = roll.value - 1;
    }
    const pick = this.current().deck.order[index];
    const card = { kind: pick.kind, work: pick.work };
    return { card, view: this.beginAge(card, mode) };
  }

  // Run the open age's script to its frontier (guided mode's engine turn).
  private run(): AgeView {
    const open = this.open;
    if (!open) throw new HelperError("no age is open");
    const r = this.eng.helperAge(canonical(this.current()), tapeOf(open.script), "guided");
    return this.absorb(r, open.script.length);
  }

  private absorb(r: HelperResponse, scriptLen: number): AgeView {
    if (r.status === "error") {
      // an override may have shifted the ground under a recorded answer —
      // truncate at the diverging record and ask again from there
      const m = /divergence at record (\d+)/.exec(r.message);
      if (m && this.open && this.open.script.length > Number(m[1])) {
        this.open.script = this.open.script.slice(0, Number(m[1]));
        return this.run();
      }
      throw new HelperError(r.message);
    }
    const freshFrom = Math.min(this.lastEventCount, r.events.length);
    this.lastEventCount = r.events.length;
    if (r.status === "question") {
      if (!isKnownPurpose(r.question.kind, r.question.purpose))
        throw new HelperError(
          `unknown decision "${r.question.purpose}" (${r.question.kind}) — the UI must not guess`,
        );
      this.view = { kind: "question", question: r.question, events: r.events, freshFrom };
      return this.view;
    }
    if (r.consumed !== scriptLen)
      throw new HelperError(`the age consumed ${r.consumed} of ${scriptLen} records`);
    this.view = {
      kind: "closed",
      state: r.state,
      events: r.events,
      finished: r.finished,
      freshFrom,
    };
    return this.view;
  }

  // Answer the pending question. Shuffle questions (a cycle completing
  // mid-age) are answered by the Helper itself with a provisional order.
  answer(result: number | boolean | number[], source: RowSource): AgeView {
    const open = this.open;
    if (!open || !this.view || this.view.kind !== "question")
      throw new HelperError("nothing is asking");
    const q = this.view.question;
    open.script = [
      ...open.script,
      { rec: { kind: q.kind, purpose: q.purpose, domain: q.domain, result }, source },
    ];
    return this.run();
  }

  // The Helper's own answers: roll a die / take the chance roll / shuffle.
  autoAnswer(): AgeView {
    if (!this.view || this.view.kind !== "question") throw new HelperError("nothing is asking");
    const q = this.view.question;
    if (q.kind === "die") {
      const r = this.eng.roll(q.domain, this.rngState);
      this.rngState = r.state;
      return this.answer(r.value, "rolled");
    }
    if (q.kind === "chance") {
      // permille via the engine's die over 1000: hit iff roll <= permille
      const r = this.eng.roll(1000, this.rngState);
      this.rngState = r.state;
      return this.answer(r.value <= q.domain, "rolled");
    }
    const r = this.eng.perm(q.domain, this.rngState);
    this.rngState = r.state;
    return this.answer(r.perm, "auto");
  }

  // Undo pops whole decisions: the last player-visible row and everything
  // the Helper answered for itself after it.
  undo(): AgeView {
    const open = this.open;
    if (!open) throw new HelperError("no age is open");
    let cut = open.script.length - 1;
    while (cut >= 0 && open.script[cut].source === "auto") cut--;
    if (cut < 0) throw new HelperError("nothing to undo");
    open.script = open.script.slice(0, cut);
    return this.run();
  }

  // --- proposal mode ---------------------------------------------------------

  // Resolve the whole age with the simulator's policies; nothing commits.
  private propose(): AgeView {
    const open = this.open;
    if (!open) throw new HelperError("no age is open");
    const r = this.eng.helperAge(
      canonical(this.current()),
      tapeOf(open.script),
      "propose",
      this.rngState,
    );
    if (r.status !== "closed") {
      if (r.status === "error") throw new HelperError(r.message);
      throw new HelperError("a proposal cannot stop at a question");
    }
    this.rngState = r.policy_state ?? this.rngState;
    for (const f of r.fresh ?? [])
      if (!isKnownPurpose(f.kind, f.purpose))
        throw new HelperError(`unknown decision "${f.purpose}" (${f.kind}) — the UI must not guess`);
    open.proposal = {
      fresh: (r.fresh ?? []).map((f) => ({
        rec: { kind: f.kind, purpose: f.purpose, domain: f.domain, result: f.result },
        source: f.kind === "shuffle" ? "auto" : "policy",
      })),
      takeoverAt: null,
    };
    this.lastEventCount = 0;
    this.view = {
      kind: "closed",
      state: r.state,
      events: r.events,
      finished: r.finished,
      freshFrom: 0,
    };
    return this.view;
  }

  // The proposal's rows with their candidate witness, for display.
  proposalRows(): ScriptRow[] {
    return this.open?.proposal?.fresh ?? [];
  }

  // Take one step over: the age drops into guided mode from that decision
  // forward — the proposal before it becomes script, the rest dissolves.
  takeover(decisionIndex: number): AgeView {
    const open = this.open;
    if (!open || !open.proposal) throw new HelperError("no proposal to take over");
    const kept = open.proposal.fresh.slice(0, decisionIndex);
    open.mode = "guided";
    open.script = [...open.script, ...kept];
    open.proposal = { fresh: open.proposal.fresh, takeoverAt: decisionIndex };
    this.lastEventCount = 0;
    return this.run();
  }

  // Accept the proposal whole: its rows become the age's script, and the
  // record is shaped exactly as a guided age's (the modes may never diverge).
  acceptProposal(): AgeView {
    const open = this.open;
    if (!open || !open.proposal) throw new HelperError("no proposal to accept");
    open.script = [...open.script, ...open.proposal.fresh];
    open.proposal = null;
    return this.run();
  }

  // --- commit / reopen -------------------------------------------------------

  // Commit the closed age: the calendar advances, the record grows one entry.
  commitAge(): void {
    const open = this.open;
    if (!open || !this.view || this.view.kind !== "closed")
      throw new HelperError("the age has open questions");
    const events = this.view.events;
    const drawn = ageCardOf(events);
    if (!drawn || drawn.kind !== open.card.kind)
      throw new HelperError("the committed age drew a different card than revealed");
    const entry: HelperEntry = {
      type: "age",
      card: open.card,
      mode: open.mode,
      script: open.script,
    };
    this.entries = [...this.entries, entry];
    this.states = [...this.states, { entry, state: this.view.state, events }];
    this.open = null;
    this.view = null;
    this.lastEventCount = 0;
    this.glanceDone = false; // a new age, a new "does this match your paper?"
  }

  // Walk away from the open age without committing (the player finishes it
  // on paper and catches up; nothing enters the record).
  abandonAge(): void {
    this.open = null;
    this.view = null;
    this.lastEventCount = 0;
  }

  // Reopen the last age (legal until the next one opens): its entry leaves
  // the record and its script returns to the table.
  reopenLast(): AgeView {
    if (this.open) throw new HelperError("close the open age first");
    const last = this.entries[this.entries.length - 1];
    if (!last || last.type !== "age") throw new HelperError("no age to reopen");
    this.entries = this.entries.slice(0, -1);
    this.states = this.states.slice(0, -1);
    this.open = { card: last.card, mode: last.mode, script: last.script, proposal: null };
    this.lastEventCount = 0;
    return this.run();
  }

  // --- overrides, checkpoints, entry ----------------------------------------

  // The paint editor's edits, recorded. With an age open the edit lands
  // BEFORE it (the age replays over the corrected ground; answers that no
  // longer fit are truncated at the divergence and asked again).
  addOverride(edits: OverrideEdit[], note?: string): void {
    const entry: HelperEntry = { type: "override", edits, note };
    const prev = this.current();
    this.entries = [...this.entries, entry];
    this.states = [...this.states, { entry, state: applyOverrides(prev, edits) }];
    if (this.open) {
      this.lastEventCount = 0;
      this.run();
    }
  }

  // The catch-up: advance the calendar by N, reset the deck to the player's
  // answers, then let the paint editor touch up. A checkpoint entry.
  addCatchup(agesAdvanced: number, deck: DeckAnswer, note?: string): void {
    if (this.open) throw new HelperError("close the open age first");
    const { state, rngState } = buildCatchupState(
      this.eng,
      this.current(),
      agesAdvanced,
      deck,
      this.rngState,
    );
    this.rngState = rngState;
    const entry: HelperEntry = { type: "checkpoint", state, agesAdvanced, note };
    this.entries = [...this.entries, entry];
    this.states = [...this.states, { entry, state }];
    this.glanceDone = false; // the world moved while the tool was away
  }

  // Mark a panel's units as entered (detail-on-demand bookkeeping).
  markEntered(panel: [number, number]): void {
    if (!this.entered) return;
    const k = `${panel[0]},${panel[1]}`;
    if (!this.entered.some(([tx, ty]) => `${tx},${ty}` === k))
      this.entered = [...this.entered, panel];
  }

  // The Spread the next age needs, and which of it still wants detail.
  spreadNeeds(): { spread: [number, number][]; missing: [number, number][] } {
    const spread = spreadOf(this.current());
    if (!this.entered) return { spread, missing: [] };
    const have = new Set(this.entered.map(([tx, ty]) => `${tx},${ty}`));
    return { spread, missing: spread.filter(([tx, ty]) => !have.has(`${tx},${ty}`)) };
  }

  // Beyond-Spread reach in the current view (events or offered candidates).
  beyondSpread(): [number, number][] {
    if (!this.view) return [];
    return panelsTouchedOutside(
      this.entered,
      this.current(),
      this.view.events,
      this.view.kind === "question" ? this.view.question : null,
    );
  }

  // --- bookkeeping -----------------------------------------------------------

  data(): SessionData {
    return {
      origin: this.origin,
      entries: this.entries,
      rngState: this.rngState,
      entered: this.entered,
      open: this.open,
    };
  }

  private recompute(fromEntry: number): void {
    if (fromEntry < 0) {
      this.states = replayAll(this.eng, this.origin, this.entries);
      return;
    }
    const kept = this.states.slice(0, fromEntry);
    let prev: WorldState | null =
      fromEntry > 0
        ? kept[fromEntry - 1].state
        : this.origin.type === "blank"
          ? null
          : this.origin.state;
    for (let i = fromEntry; i < this.entries.length; i++) {
      const rep = replayEntry(this.eng, prev, this.origin, this.entries[i]);
      kept.push(rep);
      prev = rep.state;
    }
    this.states = kept;
  }

  // The whole record's age-zero view, for exports and tests.
  originView(): { state: WorldState; events: JmEvent[] } {
    return originState(
      this.eng,
      this.origin,
      this.entries.find((e) => e.type === "genesis"),
    );
  }
}
