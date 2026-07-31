// The deck editor: add, remove, and edit cards at the CONTRACTS §6 config
// granularity. Printed work numbers come from the engine's own deck preview.
// A row's label turns bold dark-orange when it leaves the handbook's canon.
// Chapter 10's recommendations appear as soft warnings — never blocks.
import { useComputed } from "@preact/signals";

import { DEFAULT_COPIES, DEFAULT_MOODS, DEFAULT_WORK_AVG, KINDS, KIND_LABELS, type Kind } from "../deck";
import { STRINGS } from "../strings";
import {
  addpanelCopies,
  deckCopies,
  deckExportJson,
  deckPreview,
  flatWork,
  moodOverrides,
  warnings,
  workOverrides,
} from "../state";
import { download } from "./download";
import { Spinner } from "./Spinner";

function MoodSelect(props: { kind: string }) {
  const effective = moodOverrides.value[props.kind] ?? DEFAULT_MOODS[props.kind];
  return (
    <select
      value={effective}
      data-testid={`deck-mood-${props.kind}`}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        moodOverrides.value = {
          ...moodOverrides.value,
          [props.kind]: v === DEFAULT_MOODS[props.kind] ? undefined : v,
        };
      }}
    >
      <option value="settle">{STRINGS.moodSettle}</option>
      <option value="level">{STRINGS.moodLevel}</option>
      <option value="rise">{STRINGS.moodRise}</option>
    </select>
  );
}

function WorkSpinner(props: { kind: string }) {
  const effective = workOverrides.value[props.kind] ?? DEFAULT_WORK_AVG[props.kind];
  return (
    <Spinner
      value={effective}
      min={3}
      max={12}
      label={`${KIND_LABELS[props.kind]} ${STRINGS.deckWork}`}
      testid={`deck-work-${props.kind}`}
      onChange={(v) => {
        workOverrides.value = {
          ...workOverrides.value,
          [props.kind]: v === DEFAULT_WORK_AVG[props.kind] ? undefined : v,
        };
      }}
    />
  );
}

function offCanon(kind: string, copies: number, defaultCopies: number): boolean {
  return (
    copies !== defaultCopies ||
    workOverrides.value[kind] != null ||
    (moodOverrides.value[kind] != null &&
      moodOverrides.value[kind] !== DEFAULT_MOODS[kind])
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
        {totals.value.cards} {STRINGS.deckCards} (
        {totals.value.cards - addpanelCopies.value} {STRINGS.deckInEraOne}) ·{" "}
        {STRINGS.deckAvgWork} {totals.value.avg.toFixed(2)} ·{" "}
        {STRINGS.deckEraLength}
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
              <td class={offCanon(k, deckCopies.value[k], DEFAULT_COPIES[k]) ? "off-canon" : ""}>
                {KIND_LABELS[k]}
              </td>
              <td>
                <Spinner value={deckCopies.value[k]} min={0} max={12}
                  label={KIND_LABELS[k]}
                  incTestid={`deck-inc-${k}`} decTestid={`deck-dec-${k}`}
                  onChange={(v) => setCopies(k, v)} />
              </td>
              <td><WorkSpinner kind={k} /></td>
              <td><MoodSelect kind={k} /></td>
              <td class="printed">{(printed.value[k] ?? []).join(", ")}</td>
            </tr>
          ))}
          <tr class="addpanel-row">
            <td class={offCanon("addpanel", addpanelCopies.value, 1) ? "off-canon" : ""}>
              {KIND_LABELS.addpanel}
            </td>
            <td>
              <Spinner value={addpanelCopies.value} min={0} max={4}
                label={KIND_LABELS.addpanel}
                incTestid="deck-inc-addpanel" decTestid="deck-dec-addpanel"
                onChange={(v) => (addpanelCopies.value = v)} />
            </td>
            <td><WorkSpinner kind="addpanel" /></td>
            <td><MoodSelect kind="addpanel" /></td>
            <td class="printed" />
          </tr>
        </tbody>
      </table>
      </div>
      <label class={`toggle ${flatWork.value ? "off-canon" : ""}`}>
        <input
          type="checkbox"
          checked={flatWork.value}
          data-testid="toggle-flat-work"
          onChange={(e) => (flatWork.value = (e.target as HTMLInputElement).checked)}
        />
        {STRINGS.flatWork}
      </label>
      <p class="note">{STRINGS.deckNoteAddpanel}</p>
      <p class="note">{STRINGS.deckNoteRemoveCard}</p>
      {warnings.value.length === 0 ? (
        <p class="deck-ok" data-testid="deck-ok">{STRINGS.deckOk}</p>
      ) : (
        <ul class="warnings" data-testid="deck-warnings">
          {warnings.value.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <button
        data-testid="btn-export-deck"
        onClick={() =>
          download("jm-deck.json", new Blob([deckExportJson()], { type: "application/json" }))
        }
      >
        {STRINGS.exportDeck}
      </button>
    </section>
  );
}
