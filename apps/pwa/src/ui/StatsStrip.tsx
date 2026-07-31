// The run's vital signs, read from engine state and the event stream —
// display math only, no rules. Vocabulary law applies ("dice/age").
import { useComputed } from "@preact/signals";

import { STRINGS } from "../strings";
import { events, world } from "../state";

// §2.3 people densities, for the peak-density readout.
const DENSITY: Record<string, number> = {
  farm_lo: 0, farm_hi: 0, rural: 1, urb_lo: 2, urb_md: 3, urb_hi: 4,
};

export function StatsStrip() {
  const stats = useComputed(() => {
    const w = world.value;
    if (!w) return null;
    const painted = w.world.base.length;
    const byRung = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const [, , r] of w.world.base) byRung[r] += 1;
    const pct = (n: number) => (painted ? Math.round((n / painted) * 100) : 0);
    const dice = events.value.filter((e) => e.kind === "die").length;
    const ages = Math.max(1, w.time.ages_total);
    const peak = w.world.people.reduce(
      (m, [, , k]) => Math.max(m, DENSITY[k] ?? 0), 0,
    );
    const firsts = Object.entries(w.chronicle.firsts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, e]) => `${k} e${e}`)
      .join(", ");
    const m = w.chronicle.metrics;
    return {
      water: pct(byRung[0] + byRung[1] + byRung[2] + byRung[3]),
      coastal: pct(byRung[4]),
      plain: pct(byRung[5]),
      hills: pct(byRung[6]),
      mountains: pct(byRung[7]),
      cliffs: m.cliffs ?? 0,
      dicePerAge: (dice / ages).toFixed(1),
      peak,
      peoplePct: pct(w.world.people.length),
      reworks: m.reworks ?? 0,
      crumbles: m.crumbles ?? 0,
      embellish: m.embellish ?? 0,
      firsts: firsts || STRINGS.statNone,
      deckCards: w.deck.order.length,
    };
  });

  const s = stats.value;
  if (!s) return null;
  return (
    <section class="card stats" data-testid="stats-strip">
      <h2>{STRINGS.statsHeading}</h2>
      <div class="stats-rungs">
        {(
          [
            [STRINGS.statWater, `${s.water}%`],
            [STRINGS.statCoastal, `${s.coastal}%`],
            [STRINGS.statPlain, `${s.plain}%`],
            [STRINGS.statHills, `${s.hills}%`],
            [STRINGS.statMountains, `${s.mountains}%`],
            [STRINGS.statCliffs, String(s.cliffs)],
          ] as const
        ).map(([label, value]) => (
          <span key={label} class={`stat ${label === STRINGS.statCliffs ? "stat-accent" : ""}`}>
            <small>{label}</small>
            <b>{value}</b>
          </span>
        ))}
      </div>
      <p class="stats-line">
        {STRINGS.statDicePerAge} {s.dicePerAge} · {STRINGS.statPeakDensity}{" "}
        {s.peak} · {STRINGS.statPeople} {s.peoplePct}% · {STRINGS.statReworks}{" "}
        {s.reworks} · {STRINGS.statCrumbles} {s.crumbles} ·{" "}
        {STRINGS.statEmbellish} {s.embellish}
      </p>
      <p class="stats-line">
        {STRINGS.statFirsts}: {s.firsts} · {STRINGS.deckTitle.toLowerCase()}:{" "}
        {s.deckCards} {STRINGS.deckCards}
      </p>
    </section>
  );
}
