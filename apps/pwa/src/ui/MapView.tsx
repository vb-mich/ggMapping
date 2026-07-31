// The map: canvas rendered from engine state in the canonical palette, with
// zoom, pan (drag + pinch), N1/E1 panel labels, and the era rows alongside.
import { useEffect, useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";

import { draw, fitView, indexWorld, type View } from "../map/render";
import { mapCanvas } from "../map/canvasRef";
import { RUNG_NAMES, RUNG_COLORS } from "../contracts/palette";
import { STRINGS } from "../strings";
import { world } from "../state";

export function MapView() {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useSignal<View | null>(null);
  const idx = useComputed(() => (world.value ? indexWorld(world.value) : null));

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
    draw(ctx, idx.value, view.value, cw, ch);
  };

  useEffect(() => {
    mapCanvas.current = canvas.current;
    const obs = new ResizeObserver(render);
    if (holder.current) obs.observe(holder.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    view.value = null; // a new world refits
    render();
  }, [idx.value]);
  useEffect(render, [view.value]);

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
      <div class="map-head">
        <h2>{STRINGS.mapTitle}</h2>
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
      <div class="legend">
        <span>{STRINGS.legendTitle}:</span>
        {RUNG_NAMES.map((n, i) => (
          <span key={n} class="legend-item">
            <i style={`background:${RUNG_COLORS[i]}`} /> {n}
          </span>
        ))}
      </div>
      {world.value && world.value.chronicle.era_rows.length > 0 && (
        <details class="era-rows" open>
          <summary>{STRINGS.eraRowsTitle}</summary>
          <pre data-testid="era-rows">
            {world.value.chronicle.era_rows.join("\n")}
          </pre>
        </details>
      )}
    </section>
  );
}
