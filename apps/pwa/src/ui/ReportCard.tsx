// The final report, rendered by the engine from state at run end.
import { STRINGS } from "../strings";
import { report } from "../state";

export function ReportCard() {
  if (!report.value) return null;
  return (
    <section class="card">
      <details class="report" open>
        <summary>{STRINGS.reportTitle}</summary>
        <pre data-testid="final-report">{report.value}</pre>
      </details>
    </section>
  );
}
