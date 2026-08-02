// The whole map as a grid of thumbnails arranged by coordinate, gaps
// visible, pinch-zoom and pan on a phone. Tapping a panel opens its detail.
import { useEffect, useRef, useState } from "preact/hooks";

import { panelName } from "../../contracts/geometry";
import { STRINGS } from "../../strings";
import { go, panelHash } from "../../router";
import type { ScanMeta } from "../db";
import { coordAxis } from "../stitch";
import { activeMap, atlas, presetCoord } from "../store";

export function Atlas() {
  const a = atlas.value;
  const viewport = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  // keyed on content, not on the refs: the first render is the empty state
  // (scans still loading), and refs are only set after commit — an effect
  // depending on ref.current would never re-fire when the grid appears.
  // The map key recenters the view when another map takes the stage.
  usePinchPan(viewport, plane, a.size > 0, activeMap.value?.id ?? "");

  if (!a.size) {
    return (
      <div class="card">
        <p class="note" data-testid="atlas-empty">
          {STRINGS.mmEmptyState}
        </p>
      </div>
    );
  }

  const coords = [...a.keys()].map((k) => k.split(",").map(Number) as [number, number]);
  const cols = coordAxis(coords.map(([tx]) => tx));
  const rows = coordAxis(coords.map(([, ty]) => ty)).reverse(); // north on top

  return (
    <div class="card atlas-card">
      <div class="atlas-viewport" ref={viewport} data-testid="atlas">
        <div
          class="atlas-plane"
          ref={plane}
          style={{ gridTemplateColumns: `repeat(${cols.length}, var(--atlas-cell))` }}
        >
          {rows.map((ty) =>
            cols.map((tx) => {
              const meta = a.get(`${tx},${ty}`);
              return meta ? (
                <AtlasCell key={`${tx},${ty}`} tx={tx} ty={ty} meta={meta} />
              ) : (
                <button
                  key={`${tx},${ty}`}
                  class="atlas-gap"
                  data-testid={`atlas-gap-${tx},${ty}`}
                  onClick={() => {
                    // an empty panel invites its first scan
                    presetCoord.value = { tx, ty };
                    go("#/map/scan");
                  }}
                >
                  <span>{panelName(tx, ty)}</span>
                </button>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}

function AtlasCell({ tx, ty, meta }: { tx: number; ty: number; meta: ScanMeta }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = URL.createObjectURL(meta.thumb);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [meta.id]);
  return (
    <button
      class="atlas-cell"
      data-testid={`atlas-cell-${tx},${ty}`}
      data-scan={meta.id}
      onClick={() => go(panelHash(tx, ty))}
    >
      {url && <img src={url} alt={panelName(tx, ty)} draggable={false} />}
      <span>{panelName(tx, ty)}</span>
    </button>
  );
}

// Pinch-zoom and pan with plain pointer events: one pointer drags, two
// pinch, the wheel zooms. The transform is applied directly to the plane;
// taps that traveled are not clicks.
function usePinchPan(
  viewport: { current: HTMLDivElement | null },
  plane: { current: HTMLDivElement | null },
  enabled: boolean,
  contentKey: string,
) {
  const state = useRef({
    x: 0,
    y: 0,
    scale: 1,
    pointers: new Map<number, { x: number; y: number }>(),
    pinchDist: 0,
    moved: false,
    captured: false,
    downX: 0,
    downY: 0,
  });

  useEffect(() => {
    const vp = viewport.current;
    const pl = plane.current;
    if (!enabled || !vp || !pl) return;
    const s = state.current;

    const apply = () => {
      s.scale = Math.max(0.4, Math.min(4, s.scale));
      pl.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
    };

    // the default view holds the map in the middle of the viewport — a map
    // larger than the frame centers its overflow the same way
    s.scale = 1;
    s.x = (vp.clientWidth - pl.offsetWidth) / 2;
    s.y = (vp.clientHeight - pl.offsetHeight) / 2;
    apply();

    const down = (e: PointerEvent) => {
      s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (s.pointers.size === 1) {
        s.moved = false;
        s.captured = false;
        s.downX = e.clientX;
        s.downY = e.clientY;
      }
      if (s.pointers.size === 2) {
        const [a, b] = [...s.pointers.values()];
        s.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        // a pinch is never a tap: capture both pointers now
        for (const id of s.pointers.keys()) vp.setPointerCapture(id);
      }
      // one pointer stays uncaptured until it drags: capturing on the way
      // down would retarget the pointerup and swallow the cell's click
    };
    const move = (e: PointerEvent) => {
      const prev = s.pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      if (s.pointers.size === 1) {
        const dx = cur.x - prev.x;
        const dy = cur.y - prev.y;
        if (Math.abs(dx) + Math.abs(dy) > 0) {
          s.x += dx;
          s.y += dy;
          if (!s.moved && Math.hypot(cur.x - s.downX, cur.y - s.downY) > 6) {
            s.moved = true;
            if (!s.captured) {
              s.captured = true;
              vp.setPointerCapture(e.pointerId);
            }
          }
          apply();
        }
      } else if (s.pointers.size === 2) {
        s.pointers.set(e.pointerId, cur);
        const [a, b] = [...s.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (s.pinchDist > 0) {
          s.scale *= dist / s.pinchDist;
          s.moved = true;
          apply();
        }
        s.pinchDist = dist;
        return;
      }
      s.pointers.set(e.pointerId, cur);
    };
    const upOrCancel = (e: PointerEvent) => {
      s.pointers.delete(e.pointerId);
      s.pinchDist = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      s.scale *= e.deltaY < 0 ? 1.15 : 1 / 1.15;
      apply();
    };
    // a drag is not a tap
    const clickCapture = (e: MouseEvent) => {
      if (s.moved) {
        e.stopPropagation();
        e.preventDefault();
        s.moved = false;
      }
    };

    vp.addEventListener("pointerdown", down);
    vp.addEventListener("pointermove", move);
    vp.addEventListener("pointerup", upOrCancel);
    vp.addEventListener("pointercancel", upOrCancel);
    vp.addEventListener("wheel", wheel, { passive: false });
    vp.addEventListener("click", clickCapture, true);
    return () => {
      vp.removeEventListener("pointerdown", down);
      vp.removeEventListener("pointermove", move);
      vp.removeEventListener("pointerup", upOrCancel);
      vp.removeEventListener("pointercancel", upOrCancel);
      vp.removeEventListener("wheel", wheel);
      vp.removeEventListener("click", clickCapture, true);
    };
  }, [enabled, contentKey]);
}
