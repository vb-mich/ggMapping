// Navigation: time travel over the run — transport buttons, era/age Go, and
// the timeline slider. Every position is true engine state (era snapshots
// stepped forward in the worker).
import { useSignal, useSignalEffect } from "@preact/signals";

import { STRINGS } from "../strings";
import { endPosition, position, seekTo, snapshotEras, status } from "../state";
import { Spinner } from "./Spinner";

export function NavPanel() {
  const eraBox = useSignal("1");
  const ageBox = useSignal("0");

  useSignalEffect(() => {
    const p = position.value;
    if (p) {
      eraBox.value = String(p.era);
      ageBox.value = String(p.age);
    }
  });

  const end = endPosition.value;
  const eraList = snapshotEras.value;
  if (!end || !eraList.length) return null;
  const disabled = status.value === "running";
  const firstEra = eraList[0];
  const p = position.value ?? end;

  const abs = (era: number, age: number) => (era - firstEra) * 25 + age;
  const fromAbs = (n: number) => {
    const era = firstEra + Math.floor(n / 25);
    return { era, age: n % 25 };
  };
  const absMax = abs(end.era, end.age);
  const step = (d: number) => {
    const n = Math.max(0, Math.min(absMax, abs(p.era, p.age) + d));
    const t = fromAbs(n);
    seekTo(t.era, t.age);
  };

  return (
    <section class="card nav" data-testid="nav-panel">
      <h2>{STRINGS.navTitle}</h2>
      <div class="nav-transport">
        <button class="ghost" disabled={disabled} title={STRINGS.navFirst}
          data-testid="nav-first" onClick={() => seekTo(firstEra, 0)}>⏮</button>
        <button class="ghost" disabled={disabled} title={STRINGS.navPrevEra}
          data-testid="nav-prev-era" onClick={() => seekTo(Math.max(firstEra, p.era - 1), 0)}>⏪</button>
        <button class="ghost" disabled={disabled} title={STRINGS.navPrevAge}
          data-testid="nav-prev-age" onClick={() => step(-1)}>◀</button>
        <button class="ghost" disabled={disabled} title={STRINGS.navNextAge}
          data-testid="nav-next-age" onClick={() => step(1)}>▶</button>
        <button class="ghost" disabled={disabled || p.era >= end.era} title={STRINGS.navNextEra}
          data-testid="nav-next-era" onClick={() => seekTo(p.era + 1, 0)}>⏩</button>
        <button class="ghost" disabled={disabled} title={STRINGS.navLast}
          data-testid="nav-last" onClick={() => seekTo(end.era, end.age)}>⏭</button>
      </div>
      <div class="field-row">
        <label class="field">
          <span>{STRINGS.nowEra}</span>
          <Spinner value={parseInt(eraBox.value, 10) || firstEra} min={firstEra}
            max={end.era} label={STRINGS.nowEra} testid="nav-era"
            onChange={(v) => (eraBox.value = String(v))} />
        </label>
        <label class="field">
          <span>{STRINGS.nowAge}</span>
          <Spinner value={parseInt(ageBox.value, 10) || 0} min={0} max={25}
            label={STRINGS.nowAge} testid="nav-age"
            onChange={(v) => (ageBox.value = String(v))} />
        </label>
        <button disabled={disabled} data-testid="nav-go"
          onClick={() => seekTo(parseInt(eraBox.value, 10) || firstEra, parseInt(ageBox.value, 10) || 0)}>
          {STRINGS.navGo}
        </button>
      </div>
      <input
        class="timeline"
        type="range"
        min={0}
        max={absMax}
        value={abs(p.era, p.age)}
        disabled={disabled}
        data-testid="nav-slider"
        onInput={(e) => {
          const t = fromAbs(parseInt((e.target as HTMLInputElement).value, 10));
          seekTo(t.era, t.age);
        }}
      />
    </section>
  );
}
