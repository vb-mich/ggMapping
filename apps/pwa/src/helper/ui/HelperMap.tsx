// The Helper's map: the engine-state canvas (shared renderer, canonical
// palette) with the tool's signature interaction on top — the LEGAL
// CANDIDATES of an open choice glow, and the player taps one. Also numbers
// the age's steps (proposals wear their sequence) and forwards plain unit
// taps for the paint editor and the glance.
import { useEffect, useRef } from "preact/hooks";
import { useComputed, useSignal } from "@preact/signals";

import { centerOn, draw, fitView, indexWorld, type View } from "../../map/render";
import { origin as panelOrigin } from "../../contracts/geometry";
import { MARK_COLORS } from "../../contracts/palette";
import type { WorldState } from "../../contracts/schema";

export interface MapOverlay {
  // candidate index -> the units that select it (glowing)
  units: Map<number, [number, number][]>;
  // candidate index -> a panel position that selects it (outlined)
  panels: Map<number, [number, number]>;
  // the currently hovered/selected candidate, drawn brighter
  active: number | null;
}

const GLOW = "#ffd54a";

export function HelperMap(props: {
  world: WorldState;
  patina: Map<string, number>;
  highlight: [number, number] | null;
  overlay: MapOverlay | null;
  workMarks: { units: Map<string, number[]>; panels: Map<string, number[]> } | null;
  onPickCandidate?: (index: number) => void;
  onTapUnit?: (unit: [number, number]) => void;
  testid?: string;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useSignal<View | null>(null);
  const idx = useComputed(() => indexWorld(props.world, props.patina));

  const render = () => {
    const cv = canvas.current, host = holder.current;
    if (!cv || !host) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = host.clientWidth, ch = Math.max(260, Math.min(480, cw));
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(ch * dpr);
    cv.style.height = `${ch}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!view.value) {
      let v = fitView(idx.value, cw, ch);
      if (props.highlight) {
        v = { ...v, scale: Math.max(v.scale, 14) };
        v = centerOn(idx.value, v, cw, ch, props.highlight);
      }
      view.value = v;
    }
    const v = view.value;
    draw(ctx, idx.value, v, cw, ch, {
      panelNames: true,
      patina: true,
      dimArchived: true,
      highlight: props.highlight,
      workMarks: props.workMarks,
    });

    // the candidates' glow, over everything the shared renderer drew
    const o = props.overlay;
    if (o) {
      const s = v.scale;
      const px = (gx: number) => (gx - v.x) * s;
      const py = (gy: number) => (gy - v.y) * s;
      for (const [i, units] of o.units) {
        const bright = o.active === null || o.active === i;
        ctx.globalAlpha = bright ? 0.85 : 0.3;
        ctx.strokeStyle = GLOW;
        ctx.lineWidth = Math.max(2, s / 6);
        ctx.fillStyle = "#ffd54a44";
        for (const [gx, gy] of units) {
          ctx.fillRect(px(gx), py(gy), s, s);
          ctx.strokeRect(px(gx) + 1, py(gy) + 1, s - 2, s - 2);
        }
      }
      const geo = idx.value.geo;
      for (const [i, [tx, ty]] of o.panels) {
        const bright = o.active === null || o.active === i;
        ctx.globalAlpha = bright ? 0.9 : 0.35;
        const [ox, oy] = panelOrigin(geo, tx, ty);
        ctx.strokeStyle = GLOW;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = Math.max(2, s / 6);
        ctx.strokeRect(px(ox), py(oy), geo.w * s, geo.h * s);
        ctx.setLineDash([]);
        ctx.fillStyle = "#ffd54a22";
        ctx.fillRect(px(ox), py(oy), geo.w * s, geo.h * s);
      }
      ctx.globalAlpha = 1;
    }

    // proposal step badges are workMarks (the shared renderer draws them);
    // the current-panel outline uses the palette's volcano red already
    void MARK_COLORS;

    // the view transform, exposed for tests: unit (gx,gy) sits at pixel
    // ((gx - x) * scale, (gy - y) * scale)
    cv.dataset.view = `${v.scale},${v.x},${v.y}`;
  };

  useEffect(() => {
    const obs = new ResizeObserver(render);
    if (holder.current) obs.observe(holder.current);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    view.value = null; // a different world (or panel focus) refits
    render();
  }, [props.world, props.highlight?.[0], props.highlight?.[1]]);
  useEffect(render, [view.value, idx.value, props.overlay, props.workMarks, props.patina]);

  const zoom = (factor: number, cx?: number, cy?: number) => {
    const v = view.value, host = holder.current;
    if (!v || !host) return;
    const cw = host.clientWidth, ch = canvas.current!.clientHeight;
    const pxAt = cx ?? cw / 2, pyAt = cy ?? ch / 2;
    const scale = Math.max(2, Math.min(64, v.scale * factor));
    const wx = v.x + pxAt / v.scale, wy = v.y + pyAt / v.scale;
    view.value = { scale, x: wx - pxAt / scale, y: wy - pyAt / scale };
  };

  // drag pan + pinch; a low-motion pointerup is a tap
  const pointers = useRef(new Map<number, [number, number]>());
  const downAt = useRef<[number, number] | null>(null);
  const moved = useRef(false);

  const onPointerDown = (e: PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, [e.offsetX, e.offsetY]);
    downAt.current = [e.offsetX, e.offsetY];
    moved.current = false;
  };
  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !view.value) return;
    const now: [number, number] = [e.offsetX, e.offsetY];
    if (Math.hypot(now[0] - (downAt.current?.[0] ?? 0), now[1] - (downAt.current?.[1] ?? 0)) > 6)
      moved.current = true;
    if (pointers.current.size === 1 && moved.current) {
      const v = view.value;
      view.value = {
        ...v,
        x: v.x - (now[0] - prev[0]) / v.scale,
        y: v.y - (now[1] - prev[1]) / v.scale,
      };
    } else if (pointers.current.size === 2) {
      moved.current = true;
      const [a, b] = [...pointers.current.entries()];
      const other = a[0] === e.pointerId ? b[1] : a[1];
      const dPrev = Math.hypot(prev[0] - other[0], prev[1] - other[1]);
      const dNow = Math.hypot(now[0] - other[0], now[1] - other[1]);
      if (dPrev > 0) zoom(dNow / dPrev, (now[0] + other[0]) / 2, (now[1] + other[1]) / 2);
    }
    pointers.current.set(e.pointerId, now);
  };
  const onPointerUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (moved.current || !view.value) return;
    const v = view.value;
    const gx = Math.floor(v.x + e.offsetX / v.scale);
    const gy = Math.floor(v.y + e.offsetY / v.scale);
    const o = props.overlay;
    if (o && props.onPickCandidate) {
      for (const [i, units] of o.units)
        if (units.some(([x, y]) => x === gx && y === gy)) {
          props.onPickCandidate(i);
          return;
        }
      const geo = idx.value.geo;
      for (const [i, [tx, ty]] of o.panels) {
        const [ox, oy] = panelOrigin(geo, tx, ty);
        if (gx >= ox && gx < ox + geo.w && gy >= oy && gy < oy + geo.h) {
          props.onPickCandidate(i);
          return;
        }
      }
    }
    props.onTapUnit?.([gx, gy]);
  };

  return (
    <div class="map-holder helper-map" ref={holder} data-testid={props.testid ?? "helper-map"}>
      <canvas
        ref={canvas}
        data-testid="helper-canvas"
        onPointerDown={onPointerDown as never}
        onPointerMove={onPointerMove as never}
        onPointerUp={onPointerUp as never}
        onPointerCancel={((e: PointerEvent) => pointers.current.delete(e.pointerId)) as never}
        onWheel={((e: WheelEvent) => {
          e.preventDefault();
          zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY);
        }) as never}
      />
      <div class="map-buttons helper-map-zoom">
        <button class="ghost" aria-label="zoom out" onClick={() => zoom(1 / 1.3)}>−</button>
        <button class="ghost" aria-label="zoom in" onClick={() => zoom(1.3)}>+</button>
        <button class="ghost" data-testid="helper-map-fit" onClick={() => (view.value = null) as unknown as void}>⌖</button>
      </div>
    </div>
  );
}
