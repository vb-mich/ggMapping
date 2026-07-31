// "Now": where the shown age stands — era, age, panel count, the card at
// work — and the age's own slice of the engine-rendered record.
import { useComputed } from "@preact/signals";

import { STRINGS } from "../strings";
import { annotatedEvents, position, shownWorld } from "../state";

export function NowPanel() {
  const p = position.value;
  const w = shownWorld.value;

  const ageEvents = useComputed(() => {
    const pos = position.value;
    if (!pos) return [];
    return annotatedEvents.value.filter(
      (a) => a.era === pos.era && a.age === pos.age,
    );
  });

  if (!p || !w) return null;

  const ageStart = ageEvents.value.find((a) => a.kind === "age_start");
  const work = ageEvents.value.find((a) => a.kind === "work");
  const headline = ageStart
    ? `${String(ageStart.payload.card).toUpperCase()}` +
      (work ? ` (${STRINGS.nowWork} ${work.payload.quota})` : "") +
      (ageStart.panel ? ` ${STRINGS.nowOn} ${ageStart.panel}` : "")
    : STRINGS.nowGenesis;

  return (
    <section class="card now" data-testid="now-panel">
      <h2>{STRINGS.nowTitle}</h2>
      <p class="now-line" data-testid="now-line">
        <b>
          {STRINGS.nowEra} {p.era} · {STRINGS.nowAge} {p.age}/25 ·{" "}
          {w.world.panels.length} {STRINGS.nowPanels}
        </b>
      </p>
      <p class="now-headline">{headline}</p>
      <pre class="now-excerpt" data-testid="now-excerpt">
        {ageEvents.value.flatMap((a) => a.text).join("\n")}
      </pre>
    </section>
  );
}
