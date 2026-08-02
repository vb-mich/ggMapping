// The timeline bar: one stop per UPDATE, equally spaced — the bar walks the
// map's history by its actual updates, never by wall-clock distance. The
// last stop is now. The map at any stop is derived, never stored. Named
// moments render as tick marks and chips; tapping one seeks. A play button
// walks the stops automatically at the profile's playback speed. The past
// is visually distinct from now, in the same spirit as the Simulator's
// viewing-the-past chip.
import { useEffect, useRef, useState } from "preact/hooks";

import { STRINGS } from "../../strings";
import type { BookmarkRecord } from "../db";
import { stopIndexAt } from "../db";
import {
  bookmarks,
  markMoment,
  playbackMs,
  removeBookmark,
  scans,
  seekBookmark,
  seekIndex,
  timelineIndex,
  timelineStops,
  timelineT,
} from "../store";

const fmtMoment = (t: number) => new Date(t).toLocaleString();

export function Timeline() {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPlayback = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
  };
  useEffect(() => stopPlayback, []); // unmount cleans up

  const list = scans.value;
  const stops = timelineStops.value;
  const idx = timelineIndex.value;
  const last = stops.length - 1;
  const past = timelineT.value !== null;

  if (!list.length) return null;

  const onPlay = () => {
    if (playing) {
      stopPlayback();
      return;
    }
    // from the end, replay from the first update; otherwise continue
    if (idx >= last) seekIndex(0);
    setPlaying(true);
    timer.current = setInterval(() => {
      const cur = stopIndexAt(timelineStops.value, timelineT.value);
      if (cur >= timelineStops.value.length - 1) {
        stopPlayback();
        return;
      }
      seekIndex(cur + 1);
    }, playbackMs.value);
  };

  const onScrub = (v: number) => {
    stopPlayback(); // a hand on the bar takes over
    seekIndex(v);
  };

  const onMark = async () => {
    await markMoment(name.trim());
    setName("");
    setNaming(false);
  };

  const tickPct = (at: number) =>
    last === 0 ? "0%" : `${(stopIndexAt(stops, at) / last) * 100}%`;

  return (
    <div class="card timeline-card" data-testid="timeline">
      <div class="timeline-head">
        <h2>{STRINGS.mmTimeline}</h2>
        {past ? (
          <span class="chip viewing-chip" data-testid="timeline-chip" data-past="true">
            {STRINGS.mmViewing} {fmtMoment(timelineT.value!)}
          </span>
        ) : (
          <span class="chip now-chip" data-testid="timeline-chip" data-past="false">
            {STRINGS.mmNow}
          </span>
        )}
      </div>
      <div class="timeline-row">
        <button
          class={playing ? "play-btn playing" : "play-btn"}
          data-testid="btn-play"
          disabled={stops.length < 2}
          aria-label={playing ? STRINGS.mmPause : STRINGS.mmPlay}
          onClick={onPlay}
        >
          {playing ? "⏸" : "⏵"}
        </button>
        <div class="timeline-bar">
          <input
            type="range"
            class={past ? "timeline-slider past" : "timeline-slider"}
            min={0}
            max={Math.max(1, last)}
            step={1}
            value={idx}
            disabled={stops.length < 2}
            data-testid="timeline-slider"
            onInput={(e) => onScrub(Number((e.currentTarget as HTMLInputElement).value))}
          />
          <div class="timeline-ticks">
            {bookmarks.value.map((b) => (
              <button
                key={b.id}
                class="timeline-tick"
                style={{ left: tickPct(b.at) }}
                title={`${b.name} — ${fmtMoment(b.at)}`}
                data-testid={`tick-${b.name}`}
                onClick={() => {
                  stopPlayback();
                  seekBookmark(b);
                }}
              />
            ))}
          </div>
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
          <MomentChip key={b.id} b={b} index={i} onSeek={stopPlayback} />
        ))}
      </div>
    </div>
  );
}

function MomentChip({
  b,
  index,
  onSeek,
}: {
  b: BookmarkRecord;
  index: number;
  onSeek: () => void;
}) {
  const standing = timelineT.value === b.at;
  return (
    <span class={standing ? "moment-chip standing" : "moment-chip"}>
      <button
        class="moment-seek"
        data-testid={`moment-${index}`}
        title={fmtMoment(b.at)}
        onClick={() => {
          onSeek();
          seekBookmark(b);
        }}
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
