// The map: canvas rendered from engine state in the canonical palette, with
// zoom, pan (drag + pinch), N1/E1 panel labels, the current-panel highlight,
// archived-panel dimming, and the era rows alongside.
import { useEffect, useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";

import {
  centerOn,
  draw,
  fitView,
  indexWorld,
  type View,
} from "../map/render";
import { mapCanvas } from "../map/canvasRef";
import { PEOPLE_COLORS, RUNG_NAMES, RUNG_COLORS } from "../contracts/palette";
import { STRINGS } from "../strings";

// The overlays the map draws over the elevations, in ladder order (CONTRACTS
// §2.3). Labels are the stats strip's, so the two never drift apart.
const PEOPLE_LEGEND: readonly [string, string][] = [
  ["farm_lo", STRINGS.peopleFieldsLow],
  ["farm_hi", STRINGS.peopleFieldsHigh],
  ["rural", STRINGS.peopleRural],
  ["urb_lo", STRINGS.peopleUrbanLow],
  ["urb_md", STRINGS.peopleUrbanMedium],
  ["urb_hi", STRINGS.peopleUrbanHigh],
];
import {
  currentAgePanel,
  dimArchived,
  followPanel,
  showPanelNames,
  shownWorld,
  traceReworks,
  workMarks,
  workNumbers,
  world,
} from "../state";

function Toggle(props: {
  label: string;
  testid: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label class="toggle">
      <input
        type="checkbox"
        checked={props.value}
        data-testid={props.testid}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
      />
      {props.label}
    </label>
  );
}

export function MapView() {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useSignal<View | null>(null);
  const idx = useComputed(() =>
    shownWorld.value ? indexWorld(shownWorld.value) : null,
  );

  const render = () => {
    const cv = canvas.current, host = holder.current;
    if (!cv || !host) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = host.clientWidth, ch = Math.max(280, Math.min(560, cw));
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    cv.style.height = `${ch}px`;
    const ctx = cv.getContext("2d");
    if (!ctx || !idx.value) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!view.value) view.value = fitView(idx.value, cw, ch);
    let v = view.value;
    if (followPanel.value && currentAgePanel.value) {
      v = centerOn(idx.value, v, cw, ch, currentAgePanel.value);
    }
    draw(ctx, idx.value, v, cw, ch, {
      panelNames: showPanelNames.value,
      patina: traceReworks.value,
      dimArchived: dimArchived.value,
      highlight: currentAgePanel.value,
      workMarks: workNumbers.value ? workMarks.value : null,
    });
  };

  useEffect(() => {
    mapCanvas.current = canvas.current;
    const obs = new ResizeObserver(render);
    if (holder.current) obs.observe(holder.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    // a brand-new run refits; a seek within the same run keeps the view
    view.value = null;
    render();
  }, [world.value]);
  useEffect(render, [
    view.value,
    idx.value,
    showPanelNames.value,
    traceReworks.value,
    dimArchived.value,
    followPanel.value,
    currentAgePanel.value,
    workNumbers.value,
    workMarks.value,
  ]);

  const zoom = (factor: number, cx?: number, cy?: number) => {
    const v = view.value, host = holder.current;
    if (!v || !host) return;
    const cw = host.clientWidth, ch = canvas.current!.clientHeight;
    const px = cx ?? cw / 2, py = cy ?? ch / 2;
    const scale = Math.max(2, Math.min(64, v.scale * factor));
    const wx = v.x + px / v.scale, wy = v.y + py / v.scale;
    view.value = { scale, x: wx - px / scale, y: wy - py / scale };
  };

  // drag pan + two-pointer pinch
  const pointers = useRef(new Map<number, [number, number]>());
  const onPointerDown = (e: PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, [e.offsetX, e.offsetY]);
  };
  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !view.value) return;
    const now: [number, number] = [e.offsetX, e.offsetY];
    if (pointers.current.size === 1) {
      const v = view.value;
      view.value = {
        ...v,
        x: v.x - (now[0] - prev[0]) / v.scale,
        y: v.y - (now[1] - prev[1]) / v.scale,
      };
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const dPrev = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
      const dNow = Math.hypot(now[0] - other[0], now[1] - other[1]);
      if (dPrev > 0)
        zoom(dNow / dPrev, (now[0] + other[0]) / 2, (now[1] + other[1]) / 2);
    }
    pointers.current.set(e.pointerId, now);
  };
  const onPointerUp = (e: PointerEvent) => pointers.current.delete(e.pointerId);

  return (
    <section class="card">
      <div class="map-toolbar">
        <Toggle label={STRINGS.followPanel} testid="toggle-follow"
          value={followPanel.value} onChange={(v) => (followPanel.value = v)} />
        <Toggle label={STRINGS.panelNames} testid="toggle-names"
          value={showPanelNames.value} onChange={(v) => (showPanelNames.value = v)} />
        <Toggle label={STRINGS.traceReworks} testid="toggle-patina"
          value={traceReworks.value} onChange={(v) => (traceReworks.value = v)} />
        <Toggle label={STRINGS.dimArchived} testid="toggle-dim"
          value={dimArchived.value} onChange={(v) => (dimArchived.value = v)} />
        <Toggle label={STRINGS.workNumbers} testid="toggle-work-numbers"
          value={workNumbers.value} onChange={(v) => (workNumbers.value = v)} />
        <span class="map-buttons">
          <button class="ghost" aria-label={STRINGS.zoomOut} onClick={() => zoom(1 / 1.3)}>−</button>
          <button class="ghost" aria-label={STRINGS.zoomIn} onClick={() => zoom(1.3)}>+</button>
          <button class="ghost" data-testid="btn-fit" onClick={() => (view.value = null) as unknown as void}>
            {STRINGS.zoomFit}
          </button>
        </span>
      </div>
      <div class="map-holder" ref={holder}>
        <canvas
          ref={canvas}
          data-testid="map-canvas"
          onPointerDown={onPointerDown as never}
          onPointerMove={onPointerMove as never}
          onPointerUp={onPointerUp as never}
          onPointerCancel={onPointerUp as never}
          onWheel={((e: WheelEvent) => {
            e.preventDefault();
            zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY);
          }) as never}
        />
      </div>
      <div class="legend" data-testid="legend">
        <span class="legend-label">{STRINGS.legendTitle}:</span>
        {RUNG_NAMES.map((n, i) => (
          <span key={n} class="legend-item">
            <i style={`background:${RUNG_COLORS[i]}`} /> {n}
          </span>
        ))}
      </div>
      <div class="legend" data-testid="legend-people">
        <span class="legend-label">{STRINGS.peopleHeading}:</span>
        {PEOPLE_LEGEND.map(([kind, label]) => (
          <span key={kind} class="legend-item">
            <i style={`background:${PEOPLE_COLORS[kind]}`} /> {label}
          </span>
        ))}
      </div>
    </section>
  );
}
