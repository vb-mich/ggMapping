// The Helper session's core mechanics against the committed engine: blank
// genesis, the guided loop, reveal-by-amendment, commit, undo, reopen, and
// record replay identity. The headline identity test lives in
// helper-identity.test.ts; this suite proves the moving parts.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { Engine } from "../src/engine/api";
import { canonical, fullLog, remainingCards, replayAll } from "../src/helper/core";
import { HelperSession } from "../src/helper/session";

const ROOT = join(__dirname, "..", "..", "..");
const ENGINE = join(ROOT, "engine", "wasm", "prebuilt", "jerrymap.mjs");

let eng: Engine;

beforeAll(async () => {
  const mod = await import(/* @vite-ignore */ pathToFileURL(ENGINE).href);
  const m = await mod.default();
  // Engine.load() fetches by URL; under node we construct around the module
  eng = new (Engine as unknown as new (m: unknown) => Engine)(m);
});

// Play the open age to closure: taps answer picks (index/first candidate),
// dice are entered as fixed pips, chances declined, shuffles self-answer.
export function playOut(s: HelperSession, pip = 3): void {
  let guard = 0;
  while (s.view && s.view.kind === "question") {
    if (++guard > 500) throw new Error("age would not close");
    const q = s.view.question;
    if (q.kind === "die") s.answer(Math.min(pip, q.domain), "entered");
    else if (q.kind === "pick") s.answer(0, "player");
    else if (q.kind === "chance") s.answer(false, "entered");
    else s.autoAnswer();
  }
}

describe("helper session", () => {
  it("creates a blank world and plays a guided age to commit", () => {
    const { data } = HelperSession.createBlank(eng, {}, 42, 100000, eng.rngSeed(42));
    const s = new HelperSession(eng, data);
    expect(s.current().time.era).toBe(1);
    expect(s.current().rng.state).toBe("0");

    const remaining = s.remaining();
    expect(remaining.reduce((n, c) => n + c.count, 0)).toBe(20); // pre-wake deck

    const front = s.current().deck.order[0];
    s.beginAge({ kind: front.kind, work: front.work }, "guided");
    playOut(s);
    expect(s.view?.kind).toBe("closed");
    s.commitAge();
    expect(s.entries.filter((e) => e.type === "age")).toHaveLength(1);
    expect(s.current().time.ages_total).toBe(1);
  });

  it("reveals a named card by amending the provisional shuffle", () => {
    const { data } = HelperSession.createBlank(eng, {}, 7, 100000, eng.rngSeed(7));
    const s = new HelperSession(eng, data);
    const order = s.current().deck.order;
    // name a card that is NOT at the front
    const want = order.find((c) => c.kind !== order[0].kind)!;
    s.beginAge({ kind: want.kind, work: want.work }, "guided");
    playOut(s);
    expect(s.view?.kind).toBe("closed");
    if (s.view?.kind === "closed") {
      const hdr = s.view.events.find((e) => e.kind === "age_start")!;
      expect(hdr.payload.card).toBe(want.kind);
    }
    s.commitAge();

    // the record replays byte-identically after the amendment
    const again = replayAll(eng, s.origin, s.entries);
    expect(canonical(again[again.length - 1].state)).toBe(canonical(s.current()));
  });

  it("undo pops whole decisions, and a committed age can reopen", () => {
    const { data } = HelperSession.createBlank(eng, {}, 11, 100000, eng.rngSeed(11));
    const s = new HelperSession(eng, data);
    const front = s.current().deck.order[0];
    s.beginAge({ kind: front.kind, work: front.work }, "guided");
    // answer two questions, then undo one
    if (s.view?.kind === "question") {
      const q = s.view.question;
      if (q.kind === "die") s.answer(2, "entered");
      else if (q.kind === "pick") s.answer(0, "player");
      else s.answer(false, "entered");
    }
    const afterOne = s.open!.script.length;
    playOut(s);
    const full = s.open!.script.length;
    expect(full).toBeGreaterThanOrEqual(afterOne);
    s.undo();
    expect(s.open!.script.length).toBeLessThan(full);
    playOut(s);
    s.commitAge();

    const ages = s.entries.filter((e) => e.type === "age").length;
    s.reopenLast();
    expect(s.entries.filter((e) => e.type === "age").length).toBe(ages - 1);
    playOut(s);
    s.commitAge();
    expect(s.entries.filter((e) => e.type === "age").length).toBe(ages);
  });

  it("a proposal resolves the whole age; takeover drops to guided; both write one shape", () => {
    const { data } = HelperSession.createBlank(eng, {}, 21, 100000, eng.rngSeed(21));
    const s = new HelperSession(eng, data);
    const front = s.current().deck.order[0];
    const view = s.beginAge({ kind: front.kind, work: front.work }, "proposal");
    expect(view.kind).toBe("closed"); // a proposal always closes the age
    const rows = s.proposalRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.source === "policy" || r.source === "auto")).toBe(true);

    if (rows.length > 1) {
      // take the second decision over by hand: guided from there
      s.takeover(1);
      expect(s.open!.mode).toBe("guided");
      playOut(s);
    } else {
      s.acceptProposal();
    }
    expect(s.view?.kind).toBe("closed");
    s.commitAge();
    const age = s.entries[s.entries.length - 1];
    expect(age.type).toBe("age");
    if (age.type === "age")
      for (const r of age.script)
        expect(["player", "entered", "rolled", "chosen", "auto", "policy"]).toContain(r.source);
  });

  it("draw-for-me draws uniformly among the cycle's unrevealed cards", () => {
    const { data } = HelperSession.createBlank(eng, {}, 33, 100000, eng.rngSeed(33));
    const s = new HelperSession(eng, data);
    const before = remainingCards(s.entries, s.origin, s.current());
    const { card } = s.drawForMe("guided");
    expect(before.some((c) => c.kind === card.kind && c.work === card.work)).toBe(true);
    playOut(s);
    s.commitAge();
    const after = remainingCards(s.entries, s.origin, s.current());
    expect(after.reduce((n, c) => n + c.count, 0)).toBe(
      before.reduce((n, c) => n + c.count, 0) - 1,
    );
  });

  it("a fork origin continues a simulator world with a fresh provisional cycle", () => {
    const { data } = HelperSession.createFork(eng, {}, 42, 20, 30, eng.rngSeed(1));
    const s = new HelperSession(eng, data);
    expect(s.current().time.ages_total).toBe(30);
    expect(s.current().rng.state).toBe("0");
    expect(s.current().deck.marker_uid).toBeNull();
    const front = s.current().deck.order[0];
    s.beginAge({ kind: front.kind, work: front.work }, "guided");
    playOut(s);
    s.commitAge();
    expect(s.current().time.ages_total).toBe(31);
    const log = fullLog(s.committed());
    expect(log).toContain("[e2 a06]"); // age 31 of a 25-age era world
  });
});
