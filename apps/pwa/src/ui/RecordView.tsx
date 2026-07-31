// The record: the structured event stream rendered as the familiar log —
// every line is engine-rendered text; the app only groups and filters.
import { useComputed, useSignal } from "@preact/signals";

import { panelName, panelOf } from "../contracts/geometry";
import { STRINGS } from "../strings";
import { events, report, world } from "../state";

const LINE_CAP = 4000;

interface Annotated {
  era: number;
  age: number;
  panel: string | null;
  text: string[];
}

export function RecordView() {
  const filterEra = useSignal(0); // 0 = all
  const filterAge = useSignal(0);
  const filterPanel = useSignal("all");

  const annotated = useComputed<Annotated[]>(() => {
    const w = world.value;
    const geo = w ? { w: w.config.panel_w, h: w.config.panel_h } : { w: 5, h: 6 };
    let era = 0, age = 0;
    let agePanel: string | null = null;
    return events.value.map((e) => {
      if (e.kind === "era_start" || e.kind === "run_start") {
        era = (e.payload.era as number) ?? era;
        age = 0;
        agePanel = null;
      } else if (e.kind === "age_start") {
        era = e.payload.era as number;
        age = e.payload.age as number;
        agePanel = e.panel ? panelName(e.panel[0], e.panel[1]) : null;
      }
      const panel = e.panel
        ? panelName(e.panel[0], e.panel[1])
        : e.unit
          ? panelName(...panelOf(geo, e.unit[0], e.unit[1]))
          : agePanel;
      return { era, age, panel, text: e.text };
    });
  });

  const eraMax = useComputed(() =>
    annotated.value.reduce((m, a) => Math.max(m, a.era), 0),
  );
  const panels = useComputed(() => {
    const s = new Set<string>();
    for (const a of annotated.value) if (a.panel) s.add(a.panel);
    return [...s].sort();
  });

  const filtered = useComputed(() => {
    const fe = filterEra.value, fa = filterAge.value, fp = filterPanel.value;
    const lines: string[] = [];
    for (const a of annotated.value) {
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
      <h2>{STRINGS.recordTitle}</h2>
      {events.value.length === 0 ? (
        <p class="note">{STRINGS.recordEmpty}</p>
      ) : (
        <>
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
