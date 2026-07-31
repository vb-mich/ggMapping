// The deck editor: add, remove, and edit cards at the CONTRACTS §6 config
// granularity. Printed work numbers come from the engine's own deck preview.
// Chapter 10's recommendations appear as soft warnings — never blocks.
import { useComputed } from "@preact/signals";

import { DEFAULT_MOODS, DEFAULT_WORK_AVG, KINDS, KIND_LABELS, type Kind } from "../deck";
import { STRINGS } from "../strings";
import {
  addpanelCopies,
  deckCopies,
  deckPreview,
  moodOverrides,
  warnings,
  workOverrides,
} from "../state";

function Stepper(props: { kind: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <span class="stepper" data-testid={`deck-copies-${props.kind}`}>
      <button
        class="ghost"
        aria-label={`${KIND_LABELS[props.kind]} -`}
        data-testid={`deck-dec-${props.kind}`}
        onClick={() => props.onChange(Math.max(0, props.value - 1))}
      >
        −
      </button>
      <b>{props.value}</b>
      <button
        class="ghost"
        aria-label={`${KIND_LABELS[props.kind]} +`}
        data-testid={`deck-inc-${props.kind}`}
        onClick={() => props.onChange(Math.min(props.max, props.value + 1))}
      >
        +
      </button>
    </span>
  );
}

function MoodSelect(props: { kind: string }) {
  const current = moodOverrides.value[props.kind] ?? "";
  return (
    <select
      value={current}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        moodOverrides.value = { ...moodOverrides.value, [props.kind]: v || undefined };
      }}
    >
      <option value="">{`${STRINGS.moodDefault} (${DEFAULT_MOODS[props.kind]})`}</option>
      <option value="settle">{STRINGS.moodSettle}</option>
      <option value="level">{STRINGS.moodLevel}</option>
      <option value="rise">{STRINGS.moodRise}</option>
    </select>
  );
}

function WorkInput(props: { kind: string }) {
  const v = workOverrides.value[props.kind];
  return (
    <input
      type="number"
      min={3}
      max={12}
      class="work"
      placeholder={String(DEFAULT_WORK_AVG[props.kind])}
      value={v ?? ""}
      data-testid={`deck-work-${props.kind}`}
      onInput={(e) => {
        const raw = (e.target as HTMLInputElement).value;
        const n = parseInt(raw, 10);
        workOverrides.value = {
          ...workOverrides.value,
          [props.kind]: raw === "" || Number.isNaN(n) ? undefined : n,
        };
      }}
    />
  );
}

export function DeckEditor() {
  const printed = useComputed(() => {
    const by: Record<string, number[]> = {};
    for (const c of deckPreview.value) (by[c.kind] ??= []).push(c.work);
    for (const k of Object.keys(by)) by[k].sort((a, b) => a - b);
    return by;
  });
  const totals = useComputed(() => {
    let cards = addpanelCopies.value;
    let sum = addpanelCopies.value * (workOverrides.value["addpanel"] ?? DEFAULT_WORK_AVG["addpanel"]);
    for (const k of KINDS) {
      cards += deckCopies.value[k];
      sum += deckCopies.value[k] * (workOverrides.value[k] ?? DEFAULT_WORK_AVG[k]);
    }
    return { cards, avg: cards ? sum / cards : 0 };
  });

  const setCopies = (k: Kind, v: number) =>
    (deckCopies.value = { ...deckCopies.value, [k]: v });

  return (
    <section class="card">
      <h2>{STRINGS.deckTitle}</h2>
      <p class="deck-totals" data-testid="deck-totals">
        {totals.value.cards} {STRINGS.deckCards} · {STRINGS.deckAvgWork}{" "}
        {totals.value.avg.toFixed(2)}
      </p>
      <div class="table-scroll">
      <table class="deck-table">
        <thead>
          <tr>
            <th />
            <th>{STRINGS.deckCopies}</th>
            <th>{STRINGS.deckWork}</th>
            <th>{STRINGS.deckMood}</th>
            <th>{STRINGS.deckWorkNumbers}</th>
          </tr>
        </thead>
        <tbody>
          {KINDS.map((k) => (
            <tr key={k}>
              <td>{KIND_LABELS[k]}</td>
              <td>
                <Stepper kind={k} value={deckCopies.value[k]} max={12}
                  onChange={(v) => setCopies(k, v)} />
              </td>
              <td><WorkInput kind={k} /></td>
              <td><MoodSelect kind={k} /></td>
              <td class="printed">{(printed.value[k] ?? []).join(", ")}</td>
            </tr>
          ))}
          <tr class="addpanel-row">
            <td>{KIND_LABELS.addpanel}</td>
            <td>
              <Stepper kind="addpanel" value={addpanelCopies.value} max={4}
                onChange={(v) => (addpanelCopies.value = v)} />
            </td>
            <td><WorkInput kind="addpanel" /></td>
            <td><MoodSelect kind="addpanel" /></td>
            <td class="printed" />
          </tr>
        </tbody>
      </table>
      </div>
      <p class="note">{STRINGS.deckNoteAddpanel}</p>
      <p class="note">{STRINGS.deckNoteRemoveCard}</p>
      {warnings.value.length > 0 && (
        <ul class="warnings" data-testid="deck-warnings">
          {warnings.value.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
