// THE HEADLINE TEST (HELPER_DESIGN "Identity and tests"): a full game played
// through the Helper's decision pipeline, then the stored record replayed
// through the PLAIN ScriptedDecider — byte-identical logs and states,
// checkpoints included. Around it: the per-card sweep, the crafted cliff and
// waymark, the override, the fork, the custom geometry, the adopter's path,
// and the proposal-mode identity (the two modes may never diverge in what
// they write).
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { Engine } from "../src/engine/api";
import {
  buildPaperState,
  canonical,
  fullLog,
  panelsTouchedOutside,
  replayAll,
  verifyImport,
  exportWorld,
} from "../src/helper/core";
import { HelperSession } from "../src/helper/session";
import type { JmEvent } from "../src/contracts/schema";

const ROOT = join(__dirname, "..", "..", "..");
const ENGINE = join(ROOT, "engine", "wasm", "prebuilt", "jerrymap.mjs");

let eng: Engine;

beforeAll(async () => {
  const mod = await import(/* @vite-ignore */ pathToFileURL(ENGINE).href);
  const m = await mod.default();
  eng = new (Engine as unknown as new (m: unknown) => Engine)(m);
});

// Drive the open age to closure the way a player would: dice and chances
// roll, picks take an rng-chosen candidate. Purposes seen are collected.
function drive(s: HelperSession, rng: { state: string }, seen?: Set<string>): void {
  let guard = 0;
  while (s.view && s.view.kind === "question") {
    if (++guard > 900) throw new Error("age would not close");
    const q = s.view.question;
    seen?.add(`${q.kind}:${q.purpose}`);
    if (q.kind === "pick") {
      const r = eng.roll(q.domain, rng.state);
      rng.state = r.state;
      s.answer(r.value - 1, "player");
    } else {
      s.autoAnswer();
    }
  }
}

// The identity check: replay the whole record through the plain
// ScriptedDecider and compare every state and every rendered line.
function expectIdentity(s: HelperSession): void {
  const replayed = replayAll(eng, s.origin, s.entries);
  const live = s.committed();
  expect(replayed.length).toBe(live.length);
  for (let i = 0; i < live.length; i++)
    expect(canonical(replayed[i].state)).toBe(canonical(live[i].state));
  expect(fullLog(replayed)).toBe(fullLog(live));
}

describe("the headline identity", () => {
  it("a full game through the pipeline replays byte-identical, checkpoints included", () => {
    const { data } = HelperSession.createBlank(eng, {}, 42, 2, eng.rngSeed(42));
    const s = new HelperSession(eng, data);
    const rng = { state: eng.rngSeed(9001) };
    const kinds = new Set<string>();
    const purposes = new Set<string>();
    let overrideDone = false;
    let checkpointDone = false;

    for (let i = 0; s.current().time.era <= 2; i++) {
      if (i > 200) throw new Error("the game would not finish");
      if (i === 10 && !checkpointDone) {
        // an away-from-tool age: the calendar advances, the deck resets —
        // a checkpoint entry, replayed as a state set
        s.addCatchup(1, { freshShuffle: true, marked: null, played: [] }, "test catch-up");
        checkpointDone = true;
      }
      if (i === 6 && !overrideDone) {
        // the paint editor: paper won somewhere the tool had not looked
        const st = s.current();
        const painted = new Set(st.world.base.map(([x, y]) => `${x},${y}`));
        const [tx, ty] = st.world.stack[0];
        const geo = { w: st.config.panel_w, h: st.config.panel_h };
        const xi = tx > 0 ? tx - 1 : tx;
        const yi = ty > 0 ? -ty : -ty - 1;
        let unit: [number, number] | null = null;
        for (let dy = 0; dy < geo.h && !unit; dy++)
          for (let dx = 0; dx < geo.w && !unit; dx++)
            if (!painted.has(`${xi * geo.w + dx},${yi * geo.h + dy}`))
              unit = [xi * geo.w + dx, yi * geo.h + dy];
        if (unit) s.addOverride([{ op: "base", unit, elevation: 5 }], "test override");
        overrideDone = true;
      }

      const mode = i % 2 ? "proposal" : "guided";
      if (i % 5 === 4) {
        // name a card that is NOT at the front: the reveal amends the
        // governing provisional order mid-game
        const front = s.current().deck.order[0];
        const rem = s.remaining();
        const named =
          rem.find((c) => !(c.kind === front.kind && c.work === front.work)) ?? rem[0];
        s.beginAge({ kind: named.kind, work: named.work }, mode);
      } else {
        s.drawForMe(mode);
      }

      if (mode === "proposal") {
        const rows = s.proposalRows();
        if (i % 4 === 1 && rows.length > 1) {
          s.takeover(Math.floor(rows.length / 2)); // one step taken over by hand
          drive(s, rng, purposes);
        } else {
          s.acceptProposal();
          drive(s, rng, purposes);
        }
      } else {
        drive(s, rng, purposes);
      }
      kinds.add(s.open!.card.kind);
      s.commitAge();
    }

    // every instruction kind of the deck came to the table
    for (const k of [
      "extend", "basin", "ridge", "greatridge", "settlement",
      "calm", "anomaly", "freestroke", "addpanel",
    ])
      expect(kinds, `card kind ${k} was never played`).toContain(k);

    // the record holds ages of both modes, an override, and a checkpoint
    const types = s.entries.map((e) => e.type);
    expect(types).toContain("override");
    expect(types).toContain("checkpoint");
    const modes = new Set(
      s.entries.filter((e) => e.type === "age").map((e) => (e as { mode: string }).mode),
    );
    expect(modes).toEqual(new Set(["guided", "proposal"]));

    expectIdentity(s);

    // and the export/import path is the same identity test
    const file = exportWorld({
      name: "headline",
      lineage: eng.lineage(),
      origin: s.origin,
      modePref: "guided",
      rngState: s.rngState,
      entered: s.entered,
      open: null,
      entries: s.entries,
    });
    const reimported = verifyImport(eng, JSON.parse(JSON.stringify(file)));
    expect(canonical(reimported[reimported.length - 1].state)).toBe(
      canonical(s.current()),
    );
  }, 120_000);

  it("both modes write records of identical shape", () => {
    const { data } = HelperSession.createBlank(eng, {}, 77, 100000, eng.rngSeed(77));
    const s = new HelperSession(eng, data);
    const rng = { state: eng.rngSeed(3) };
    s.drawForMe("guided");
    drive(s, rng);
    s.commitAge();
    s.drawForMe("proposal");
    s.acceptProposal();
    drive(s, rng);
    s.commitAge();
    const ages = s.entries.filter((e) => e.type === "age") as Extract<
      (typeof s.entries)[number],
      { type: "age" }
    >[];
    expect(ages).toHaveLength(2);
    for (const age of ages) {
      expect(Object.keys(age).sort()).toEqual(["card", "mode", "script", "type"]);
      for (const row of age.script) {
        expect(Object.keys(row).sort()).toEqual(["rec", "source"]);
        expect(Object.keys(row.rec).sort()).toEqual(["domain", "kind", "purpose", "result"]);
      }
    }
    expectIdentity(s);
  });
});

describe("crafted ages: the cliff and the waymark", () => {
  // A paper world whose working panel is painted to force the wanted event.
  function craft(
    paint: [number, number, number][], // r, c, elevation on the front panel N2/W1
    fullFront = false,
  ): HelperSession {
    const genesis: [number, number][] = [
      [-1, 2], [1, 2], [-2, 1], [-1, 1], [1, 1], [2, 1],
      [-2, -1], [-1, -1], [1, -1], [2, -1], [-1, -2], [1, -2],
    ];
    const { state } = buildPaperState(
      eng,
      eng.lineage(),
      {
        config: {},
        era: 1,
        ageInEra: 0,
        panels: genesis.map((panel) => ({
          panel,
          status: fullFront && panel[0] === -1 && panel[1] === 2 ? "full" : "open",
        })),
        stackOrder: [[-1, 2], ...genesis.filter(([tx, ty]) => !(tx === -1 && ty === 2))],
        deck: { freshShuffle: true, marked: null, played: [] },
      },
      eng.rngSeed(500),
    );
    const s = new HelperSession(eng, {
      origin: { type: "paper", state },
      entries: [],
      rngState: eng.rngSeed(501),
      entered: [[-1, 2]],
      open: null,
    });
    // N2/W1 = (-1,2): origin unit (-5, -12) for 5x6 geometry
    s.addOverride(
      paint.map(([r, c, elevation]) => ({
        op: "base" as const,
        unit: [-5 + (c - 1), -12 + (r - 1)] as [number, number],
        elevation,
      })),
      "crafted",
    );
    return s;
  }

  it("a fill between mountains and verydeep is a CLIFF", () => {
    // r1c2 mountains, r2c1 verydeep: the empty corner r1c1 is the only
    // twice-neighbored empty, and no elevation can be its neighbor
    const s = craft([
      [1, 2, 7],
      [2, 1, 0],
    ]);
    const rng = { state: eng.rngSeed(7) };
    s.beginAge({ kind: "calm", work: 6 }, "guided");
    drive(s, rng);
    expect(s.view?.kind).toBe("closed");
    const events = (s.view as { events: JmEvent[] }).events;
    expect(events.some((e) => e.kind === "cliff")).toBe(true);
    const text = events.flatMap((e) => e.text).join("\n");
    expect(text).toContain("CLIFF");
    s.commitAge();
    expectIdentity(s);
  });

  it("a settlement with no legal home leaves its waymark", () => {
    // the front panel painted full of hills: no plain, no coastal, no home —
    // the rolled unit takes the waymark (a rework trace in settlement's name)
    const paint: [number, number, number][] = [];
    for (let r = 1; r <= 6; r++) for (let c = 1; c <= 5; c++) paint.push([r, c, 6]);
    const s = craft(paint, true);
    const rng = { state: eng.rngSeed(8) };
    s.beginAge({ kind: "settlement", work: 7 }, "guided");
    drive(s, rng);
    expect(s.view?.kind).toBe("closed");
    const events = (s.view as { events: JmEvent[] }).events;
    const traces = events.filter((e) => e.kind === "trace");
    expect(traces.some((e) => (e.payload.label as string) === "settlement")).toBe(true);
    s.commitAge();
    expectIdentity(s);
  });
});

describe("origins", () => {
  it("a fork from seed 42 at age 30 plays on and replays byte-identical", () => {
    const { data } = HelperSession.createFork(eng, {}, 42, 20, 30, eng.rngSeed(2));
    const s = new HelperSession(eng, data);
    const rng = { state: eng.rngSeed(4) };
    s.drawForMe("guided");
    drive(s, rng);
    s.commitAge();
    s.drawForMe("proposal");
    s.acceptProposal();
    drive(s, rng);
    s.commitAge();
    expect(s.current().time.ages_total).toBe(32);
    expectIdentity(s);
  });

  it("a custom-geometry world asks the choice-shaped row and column questions", () => {
    // 3x5: neither side is a die, so landing a unit is the player's choice
    const { data } = HelperSession.createBlank(
      eng,
      { panel_w: 3, panel_h: 5 },
      13,
      100000,
      eng.rngSeed(13),
    );
    const s = new HelperSession(eng, data);
    const rng = { state: eng.rngSeed(14) };
    const purposes = new Set<string>();
    for (let i = 0; i < 8; i++) {
      s.drawForMe("guided");
      drive(s, rng, purposes);
      s.commitAge();
    }
    expect([...purposes].some((p) => p === "pick:row (choice)" || p === "pick:column (choice)"),
      `saw only: ${[...purposes].join(", ")}`).toBe(true);
    expectIdentity(s);
  });
});

describe("the adopter's path", () => {
  it("skeleton-only entry, detail on demand, a played age, a 3-age catch-up — replayed whole", () => {
    const genesis: [number, number][] = [
      [-1, 2], [1, 2], [-2, 1], [-1, 1], [1, 1], [2, 1],
      [-2, -1], [-1, -1], [1, -1], [2, -1], [-1, -2], [1, -2],
    ];
    // era 4, mid-cycle: the marked card and two played this cycle
    const { state } = buildPaperState(
      eng,
      eng.lineage(),
      {
        config: {},
        era: 4,
        ageInEra: 7,
        panels: genesis.map((panel) => ({
          panel,
          status: panel[0] === 1 && panel[1] === 2 ? "full" : "open",
        })),
        stackOrder: [[-1, 1], ...genesis.filter(([tx, ty]) => !(tx === -1 && ty === 1))],
        deck: {
          freshShuffle: false,
          marked: { kind: "calm", work: 6 },
          played: [
            { kind: "basin", work: 7 },
            { kind: "settlement", work: 7 },
          ],
        },
      },
      eng.rngSeed(600),
    );
    expect(state.time.ages_total).toBe(82);
    expect(state.deck.woken).toBe(true);
    expect(state.deck.marker_uid).not.toBeNull();

    const s = new HelperSession(eng, {
      origin: { type: "paper", state },
      entries: [],
      rngState: eng.rngSeed(601),
      entered: [],
      open: null,
    });

    // the working panel and its Spread want detail before the age
    const needs = s.spreadNeeds();
    expect(needs.missing.length).toBeGreaterThan(0);

    // detail ONE panel on demand (its first Spread appearance): believed paint
    for (const p of needs.spread) {
      if (p[0] === -1 && p[1] === 1) {
        s.addOverride(
          [
            { op: "base", unit: [-5, -6], elevation: 5 },
            { op: "base", unit: [-4, -6], elevation: 5 },
            { op: "base", unit: [-4, -5], elevation: 4 },
          ],
          "detail on demand",
        );
      }
      s.markEntered(p);
    }
    expect(s.spreadNeeds().missing).toHaveLength(0);

    // one age played guided
    const rng = { state: eng.rngSeed(602) };
    s.drawForMe("guided");
    drive(s, rng);
    s.commitAge();
    expect(s.current().time.ages_total).toBe(83);

    // three ages painted away from the tool: one catch-up checkpoint
    s.addCatchup(3, { freshShuffle: true, marked: null, played: [] }, "away from tool");
    expect(s.current().time.ages_total).toBe(86);
    expect(s.current().time.era).toBe(4);
    expect(s.current().time.age_in_era).toBe(11);

    // and play continues after the catch-up
    s.drawForMe("guided");
    drive(s, rng);
    s.commitAge();
    expect(s.current().time.ages_total).toBe(87);

    // the whole record — overrides, ages, the checkpoint — replays whole
    const kinds = s.entries.map((e) => e.type);
    expect(kinds.filter((k) => k === "checkpoint")).toHaveLength(1);
    expectIdentity(s);
  });

  it("beyond-Spread reach is detected from events and candidates", () => {
    const entered: [number, number][] = [[-1, 2]];
    const { state } = buildPaperState(
      eng,
      eng.lineage(),
      {
        config: {},
        era: 1,
        ageInEra: 0,
        panels: [
          { panel: [-1, 2], status: "open" },
          { panel: [1, 2], status: "open" },
          { panel: [-2, 1], status: "open" },
          { panel: [-1, 1], status: "open" },
          { panel: [1, 1], status: "open" },
          { panel: [2, 1], status: "open" },
          { panel: [-2, -1], status: "open" },
          { panel: [-1, -1], status: "open" },
          { panel: [1, -1], status: "open" },
          { panel: [2, -1], status: "open" },
          { panel: [-1, -2], status: "open" },
          { panel: [1, -2], status: "open" },
        ],
        stackOrder: [
          [-1, 2], [1, 2], [-2, 1], [-1, 1], [1, 1], [2, 1],
          [-2, -1], [-1, -1], [1, -1], [2, -1], [-1, -2], [1, -2],
        ],
        deck: { freshShuffle: true, marked: null, played: [] },
      },
      eng.rngSeed(700),
    );
    // an event on N1/W1 (un-entered) is beyond the entered set
    const events = [
      {
        seq: 0,
        kind: "paint",
        panel: null,
        unit: [-3, -6] as [number, number],
        payload: {},
        text: [],
      },
    ];
    const out = panelsTouchedOutside(entered, state, events as never, null);
    expect(out).toEqual([[-1, 1]]);
    // the same units inside the entered panel are not flagged
    const inside = panelsTouchedOutside(
      entered,
      state,
      [{ ...events[0], unit: [-5, -12] as [number, number] }] as never,
      null,
    );
    expect(inside).toEqual([]);
  });
});
