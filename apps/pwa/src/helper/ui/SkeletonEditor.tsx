// Lazy state entry, step one: the SKELETON — one quick grid screen: which
// coordinates hold panels, which are full or archived. Plus the paper
// Stack's order, the calendar, and where the deck stands. Minutes, not
// hours; unit detail waits for its day.
import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";

import { STRINGS } from "../../strings";
import { panelName } from "../../contracts/geometry";
import type { JmConfig } from "../../contracts/schema";
import type { DeckAnswer, PaperEntry } from "../core";
import { deckPrintsFor } from "../store";
import { CARD_NAMES } from "./labels";

type PanelStatus = "none" | "open" | "full" | "archived";
const CYCLE: PanelStatus[] = ["none", "open", "full", "archived"];
const STATUS_LABEL: Record<PanelStatus, string> = {
  none: STRINGS.hpSkeletonState0,
  open: STRINGS.hpSkeletonState1,
  full: STRINGS.hpSkeletonState2,
  archived: STRINGS.hpSkeletonState3,
};

const genesisFor = (w: number, h: number): [number, number][] =>
  w === 5 && h === 6
    ? [
        [-1, 2], [1, 2], [-2, 1], [-1, 1], [1, 1], [2, 1],
        [-2, -1], [-1, -1], [1, -1], [2, -1], [-1, -2], [1, -2],
      ]
    : [
        [-1, 1], [1, 1], [-1, -1], [1, -1],
      ];

const key = (tx: number, ty: number) => `${tx},${ty}`;

// The deck section: fresh shuffle, or mid-cycle answers (marked card +
// played set), listing the config's printed cards from the engine.
export function DeckAnswerForm(props: {
  config: JmConfig;
  woken: boolean;
  value: DeckAnswer;
  onChange: (v: DeckAnswer) => void;
}) {
  const prints = useSignal<{ kind: string; work: number }[]>([]);
  useEffect(() => {
    void deckPrintsFor(props.config).then((p) => {
      prints.value = props.woken ? [...p.main, ...p.addpanel] : p.main;
    });
  }, [props.woken]);

  const counts = new Map<string, { kind: string; work: number; total: number }>();
  for (const c of prints.value) {
    const k = `${c.kind}|${c.work}`;
    const g = counts.get(k);
    if (g) g.total += 1;
    else counts.set(k, { ...c, total: 1 });
  }
  const used = new Map<string, number>();
  if (props.value.marked)
    used.set(`${props.value.marked.kind}|${props.value.marked.work}`, 1);
  for (const p of props.value.played) {
    const k = `${p.kind}|${p.work}`;
    used.set(k, (used.get(k) ?? 0) + 1);
  }

  const v = props.value;
  return (
    <div class="deck-answer" data-testid="deck-answer">
      <h4>{STRINGS.hpDeckTitle}</h4>
      <div class="row">
        <button
          class={v.freshShuffle ? "primary" : ""}
          data-testid="deck-fresh"
          onClick={() => props.onChange({ freshShuffle: true, marked: null, played: [] })}
        >
          {STRINGS.hpDeckFresh}
        </button>
        <button
          class={!v.freshShuffle ? "primary" : ""}
          data-testid="deck-midcycle"
          onClick={() => props.onChange({ ...v, freshShuffle: false })}
        >
          {STRINGS.hpDeckMidCycle}
        </button>
      </div>
      {!v.freshShuffle && (
        <>
          <p class="hint">{STRINGS.hpDeckMarked}:</p>
          <div class="picker-cards">
            {[...counts.values()].map((c) => (
              <button
                key={`m-${c.kind}-${c.work}`}
                class={
                  v.marked?.kind === c.kind && v.marked?.work === c.work
                    ? "picker-card active"
                    : "picker-card"
                }
                data-testid={`marked-${c.kind}-${c.work}`}
                onClick={() =>
                  props.onChange({ ...v, marked: { kind: c.kind, work: c.work } })
                }
              >
                <b>{CARD_NAMES[c.kind] ?? c.kind}</b>
                <span class="work">{c.work}</span>
              </button>
            ))}
          </div>
          <p class="hint">
            {STRINGS.hpDeckPlayed} ({v.played.length || STRINGS.hpDeckNone}):
          </p>
          <div class="picker-cards">
            {[...counts.values()].map((c) => {
              const k = `${c.kind}|${c.work}`;
              const taken = used.get(k) ?? 0;
              const canAdd = taken < c.total;
              const inPlayed = v.played.filter(
                (p) => p.kind === c.kind && p.work === c.work,
              ).length;
              return (
                <button
                  key={`p-${c.kind}-${c.work}`}
                  class={inPlayed ? "picker-card active" : "picker-card"}
                  data-testid={`played-${c.kind}-${c.work}`}
                  onClick={() => {
                    if (inPlayed)
                      props.onChange({
                        ...v,
                        played: v.played.filter(
                          (p, i) =>
                            !(p.kind === c.kind && p.work === c.work &&
                              i === v.played.findIndex((q) => q.kind === c.kind && q.work === c.work)),
                        ),
                      });
                    else if (canAdd)
                      props.onChange({
                        ...v,
                        played: [...v.played, { kind: c.kind, work: c.work }],
                      });
                  }}
                >
                  <b>{CARD_NAMES[c.kind] ?? c.kind}</b>
                  <span class="work">{c.work}</span>
                  {inPlayed > 0 && <span class="count">×{inPlayed}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function SkeletonEditor(props: {
  config: JmConfig;
  onDone: (entry: Omit<PaperEntry, "config">) => void;
  onCancel: () => void;
}) {
  const w = props.config.panel_w ?? 5;
  const h = props.config.panel_h ?? 6;
  const genesis = genesisFor(w, h);
  const status = useSignal<Map<string, PanelStatus>>(
    new Map(genesis.map((g) => [key(...g), "open" as PanelStatus])),
  );
  const stack = useSignal<[number, number][]>([]);
  const era = useSignal(1);
  const age = useSignal(0);
  const deck = useSignal<DeckAnswer>({ freshShuffle: true, marked: null, played: [] });
  const reach = useSignal(3);

  const coords: number[] = [];
  for (let i = -reach.value; i <= reach.value; i++) if (i !== 0) coords.push(i);

  const cycleCell = (tx: number, ty: number) => {
    const k = key(tx, ty);
    const cur = status.value.get(k) ?? "none";
    const isGenesis = genesis.some(([gx, gy]) => gx === tx && gy === ty);
    let next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
    if (isGenesis && next === "none") next = "open"; // genesis panels always exist
    const m = new Map(status.value);
    m.set(k, next);
    status.value = m;
    stack.value = stack.value.filter(([sx, sy]) => key(sx, sy) !== k);
  };

  const rotation = [...status.value.entries()]
    .filter(([, s]) => s === "open" || s === "full")
    .map(([k2]) => k2.split(",").map(Number) as [number, number]);
  const inStack = new Set(stack.value.map(([tx, ty]) => key(tx, ty)));
  const pool = rotation.filter(([tx, ty]) => !inStack.has(key(tx, ty)));
  const ready = pool.length === 0 && rotation.length > 0;

  const done = () => {
    props.onDone({
      era: era.value,
      ageInEra: age.value,
      panels: [...status.value.entries()]
        .filter(([, s]) => s !== "none")
        .map(([k2, s]) => ({
          panel: k2.split(",").map(Number) as [number, number],
          status: s === "archived" ? ("archived" as const) : s === "full" ? ("full" as const) : ("open" as const),
        })),
      stackOrder: stack.value,
      deck: deck.value,
    });
  };

  return (
    <div class="card skeleton-editor" data-testid="skeleton-editor">
      <h3>{STRINGS.hpSkeletonTitle}</h3>
      <p class="hint">{STRINGS.hpSkeletonHint}</p>
      <div class="skeleton-grid" style={`grid-template-columns: repeat(${coords.length}, 1fr)`}>
        {coords
          .slice()
          .reverse()
          .map((ty) =>
            coords.map((tx) => {
              const s = status.value.get(key(tx, ty)) ?? "none";
              return (
                <button
                  key={key(tx, ty)}
                  class={`skeleton-cell s-${s}`}
                  data-testid={`skeleton-${tx}-${ty}`}
                  title={`${panelName(tx, ty)}: ${STATUS_LABEL[s]}`}
                  onClick={() => cycleCell(tx, ty)}
                >
                  {s !== "none" ? panelName(tx, ty) : ""}
                </button>
              );
            }),
          )}
      </div>
      <button class="ghost" onClick={() => (reach.value = reach.value + 1)}>
        +
      </button>

      <h4>{STRINGS.hpStackTitle}</h4>
      <p class="hint">{STRINGS.hpStackHint}</p>
      <div class="row wrap" data-testid="stack-pool">
        {pool.map(([tx, ty]) => (
          <button
            key={key(tx, ty)}
            class="chip"
            data-testid={`stack-add-${tx}-${ty}`}
            onClick={() => (stack.value = [...stack.value, [tx, ty]])}
          >
            {panelName(tx, ty)}
          </button>
        ))}
      </div>
      <div class="row wrap" data-testid="stack-order">
        {stack.value.map(([tx, ty], i) => (
          <span key={key(tx, ty)} class="chip ordered">
            {i + 1}. {panelName(tx, ty)}
          </span>
        ))}
        {stack.value.length > 0 && (
          <button class="ghost" data-testid="stack-reset" onClick={() => (stack.value = [])}>
            {STRINGS.hpStackReset}
          </button>
        )}
      </div>

      <h4>{STRINGS.hpCalendarTitle}</h4>
      <p class="hint">{STRINGS.hpCalendarHint}</p>
      <div class="row">
        <label class="field">
          <span>{STRINGS.hpEra}</span>
          <input
            type="number"
            min={1}
            max={9999}
            value={era.value}
            data-testid="paper-era"
            onInput={(e) => (era.value = Math.max(1, Number((e.target as HTMLInputElement).value) || 1))}
          />
        </label>
        <label class="field">
          <span>{STRINGS.hpAge}</span>
          <input
            type="number"
            min={0}
            max={24}
            value={age.value}
            data-testid="paper-age"
            onInput={(e) =>
              (age.value = Math.min(24, Math.max(0, Number((e.target as HTMLInputElement).value) || 0)))
            }
          />
        </label>
      </div>

      <DeckAnswerForm
        config={props.config}
        woken={era.value >= 2}
        value={deck.value}
        onChange={(v) => (deck.value = v)}
      />

      <div class="row">
        <button class="primary" disabled={!ready} data-testid="skeleton-done" onClick={done}>
          {STRINGS.hpCreate}
        </button>
        <button class="ghost" onClick={props.onCancel}>
          {STRINGS.hpCancelEdits}
        </button>
        {!ready && (
          <span class="hint" data-testid="skeleton-waiting">
            {STRINGS.hpSkeletonWaiting}
          </span>
        )}
      </div>
    </div>
  );
}
