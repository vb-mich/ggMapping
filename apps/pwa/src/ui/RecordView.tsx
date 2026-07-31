// The record: the structured event stream rendered as the familiar log —
// every line is engine-rendered text; the app only groups and filters.
// Compact by default (run frame + era summaries); Age details opens the full
// stream with era/age/panel filters.
import { useComputed, useSignal } from "@preact/signals";

import { STRINGS } from "../strings";
import { ageDetails, annotatedEvents, events, report } from "../state";

const LINE_CAP = 4000;
const COMPACT_KINDS = new Set(["run_start", "era_summary", "addpanel_wake"]);

export function RecordView() {
  const filterEra = useSignal(0); // 0 = all
  const filterAge = useSignal(0);
  const filterPanel = useSignal("all");

  const eraMax = useComputed(() =>
    annotatedEvents.value.reduce((m, a) => Math.max(m, a.era), 0),
  );
  const panels = useComputed(() => {
    const s = new Set<string>();
    for (const a of annotatedEvents.value) if (a.panel) s.add(a.panel);
    return [...s].sort();
  });

  const filtered = useComputed(() => {
    const details = ageDetails.value;
    const fe = filterEra.value, fa = filterAge.value, fp = filterPanel.value;
    const lines: string[] = [];
    for (const a of annotatedEvents.value) {
      if (!details) {
        if (COMPACT_KINDS.has(a.kind)) lines.push(...a.text);
        continue;
      }
      if (fe && a.era !== fe) continue;
      if (fa && a.age !== fa) continue;
      if (fp !== "all" && a.panel !== fp) continue;
      lines.push(...a.text);
      if (lines.length > LINE_CAP) break;
    }
    return lines;
  });

  return (
    <section class="card">
      <div class="record-head">
        <h2>{STRINGS.recordTitle}</h2>
        {events.value.length > 0 && (
          <label class="toggle">
            <input
              type="checkbox"
              checked={ageDetails.value}
              data-testid="toggle-details"
              onChange={(e) =>
                (ageDetails.value = (e.target as HTMLInputElement).checked)
              }
            />
            {STRINGS.ageDetails}
          </label>
        )}
      </div>
      {events.value.length === 0 ? (
        <p class="note">{STRINGS.recordEmpty}</p>
      ) : (
        <>
          {ageDetails.value && (
            <div class="field-row">
              <label class="field">
                <span>{STRINGS.filterEra}</span>
                <select
                  data-testid="filter-era"
                  value={filterEra.value}
                  onChange={(e) => (filterEra.value = parseInt((e.target as HTMLSelectElement).value, 10))}
                >
                  <option value={0}>{STRINGS.filterAll}</option>
                  {Array.from({ length: eraMax.value }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>{STRINGS.filterAge}</span>
                <select
                  data-testid="filter-age"
                  value={filterAge.value}
                  onChange={(e) => (filterAge.value = parseInt((e.target as HTMLSelectElement).value, 10))}
                >
                  <option value={0}>{STRINGS.filterAll}</option>
                  {Array.from({ length: 25 }, (_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
              </label>
              <label class="field">
                <span>{STRINGS.filterPanel}</span>
                <select
                  data-testid="filter-panel"
                  value={filterPanel.value}
                  onChange={(e) => (filterPanel.value = (e.target as HTMLSelectElement).value)}
                >
                  <option value="all">{STRINGS.filterAll}</option>
                  {panels.value.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <pre class="record" data-testid="record-list">
            {filtered.value.slice(0, LINE_CAP).join("\n")}
          </pre>
        </>
      )}
      {report.value && (
        <details class="report" open>
          <summary>{STRINGS.reportTitle}</summary>
          <pre data-testid="final-report">{report.value}</pre>
        </details>
      )}
    </section>
  );
}
