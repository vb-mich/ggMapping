// The timeline bar: a slider from the first scan to now, defaulting to now.
// The map at the chosen moment is derived, never stored; scrubbing repaints
// the atlas. Named moments render as tick marks and a list; tapping one
// seeks. The past is visually distinct from now, in the same spirit as the
// Simulator's viewing-the-past chip.
import { useState } from "preact/hooks";

import { STRINGS } from "../../strings";
import type { BookmarkRecord } from "../db";
import {
  bookmarks,
  markMoment,
  removeBookmark,
  scans,
  seekBookmark,
  timelineT,
} from "../store";

const fmtMoment = (t: number) => new Date(t).toLocaleString();

export function Timeline() {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const list = scans.value;
  if (!list.length) return null;

  const first = list[0].created;
  const now = Date.now();
  const max = Math.max(now, first + 1);
  const t = timelineT.value ?? max;
  const past = timelineT.value !== null;

  const seek = (v: number) => {
    timelineT.value = v >= max ? null : v;
  };
  const pct = (at: number) => `${(Math.min(Math.max(at, first), max) - first) / (max - first) * 100}%`;

  const onMark = async () => {
    await markMoment(name.trim());
    setName("");
    setNaming(false);
  };

  return (
    <div class="card timeline-card" data-testid="timeline">
      <div class="timeline-head">
        <h2>{STRINGS.mmTimeline}</h2>
        {past ? (
          <span class="chip viewing-chip" data-testid="timeline-chip" data-past="true">
            {STRINGS.mmViewing} {fmtMoment(t)}
          </span>
        ) : (
          <span class="chip now-chip" data-testid="timeline-chip" data-past="false">
            {STRINGS.mmNow}
          </span>
        )}
      </div>
      <div class="timeline-bar">
        <input
          type="range"
          class={past ? "timeline-slider past" : "timeline-slider"}
          min={first}
          max={max}
          value={t}
          data-testid="timeline-slider"
          onInput={(e) => seek(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <div class="timeline-ticks">
          {bookmarks.value.map((b) => (
            <button
              key={b.id}
              class="timeline-tick"
              style={{ left: pct(b.at) }}
              title={`${b.name} — ${fmtMoment(b.at)}`}
              data-testid={`tick-${b.name}`}
              onClick={() => seekBookmark(b)}
            />
          ))}
        </div>
      </div>
      <div class="moment-row">
        {!naming ? (
          <button class="ghost" data-testid="btn-mark-moment" onClick={() => setNaming(true)}>
            {STRINGS.mmMarkMoment}
          </button>
        ) : (
          <span class="map-create">
            <input
              type="text"
              placeholder={STRINGS.mmMapName}
              value={name}
              data-testid="input-moment-name"
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
            />
            <button data-testid="btn-moment-save" onClick={onMark}>
              {STRINGS.mmCreate}
            </button>
          </span>
        )}
        {bookmarks.value.map((b, i) => (
          <MomentChip key={b.id} b={b} index={i} />
        ))}
      </div>
    </div>
  );
}

function MomentChip({ b, index }: { b: BookmarkRecord; index: number }) {
  const standing = timelineT.value === b.at;
  return (
    <span class={standing ? "moment-chip standing" : "moment-chip"}>
      <button
        class="moment-seek"
        data-testid={`moment-${index}`}
        title={fmtMoment(b.at)}
        onClick={() => seekBookmark(b)}
      >
        {b.name}
      </button>
      <button
        class="moment-del"
        aria-label={`${STRINGS.mmRemove} ${b.name}`}
        data-testid={`btn-moment-del-${index}`}
        onClick={() => removeBookmark(b.id)}
      >
        ×
      </button>
    </span>
  );
}
