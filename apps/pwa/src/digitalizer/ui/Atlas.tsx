// The whole map as a grid of thumbnails arranged by coordinate, gaps
// visible, pinch-zoom and pan on a phone. Tapping a panel opens its detail.
import { useEffect, useRef, useState } from "preact/hooks";

import { panelName } from "../../contracts/geometry";
import { STRINGS } from "../../strings";
import { go, panelHash } from "../../router";
import { getScan, type ScanMeta } from "../db";
import { FULL_SCAN_ZOOM, FullScanPool } from "../fullScans";
import { atlasGrid, coordKey } from "../grid";
import { activeMap, atlas, presetCoord } from "../store";

// One pool for the screen. It holds the stored scans the atlas is currently
// showing at zoom, and nothing else.
const pool = new FullScanPool({
  load: async (id) => (await getScan(id))?.image,
  createUrl: (blob) => URL.createObjectURL(blob),
  revokeUrl: (url) => URL.revokeObjectURL(url),
});

export function Atlas() {
  const a = atlas.value;
  const viewport = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  // the zoom the cells watch: past FULL_SCAN_ZOOM they fetch their stored
  // scan, because a thumbnail stretched past its own size is the blur
  const [zoom, setZoom] = useState(1);
  // keyed on content, not on the refs: the first render is the empty state
  // (scans still loading), and refs are only set after commit — an effect
  // depending on ref.current would never re-fire when the grid appears.
  // The map key recenters the view when another map takes the stage.
  usePinchPan(viewport, plane, a.size > 0, activeMap.value?.id ?? "", setZoom);

  // another map means another set of scans: let the old ones go
  useEffect(() => () => pool.clear(), [activeMap.value?.id]);

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
  // the bounding box plus one ring: the map grows outward, so the positions
  // along its edges are offered, not only the notches inside it
  const { cols, rows, addable } = atlasGrid(coords);

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
              const meta = a.get(coordKey(tx, ty));
              if (meta)
                return (
                  <AtlasCell
                    key={coordKey(tx, ty)}
                    tx={tx}
                    ty={ty}
                    meta={meta}
                    zoom={zoom}
                    viewport={viewport}
                  />
                );
              // a position with no panel beside it holds the grid's shape
              // without inviting anything
              if (!addable.has(coordKey(tx, ty))) {
                return <div key={coordKey(tx, ty)} class="atlas-blank" />;
              }
              return (
                <button
                  key={coordKey(tx, ty)}
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

function AtlasCell({
  tx,
  ty,
  meta,
  zoom,
  viewport,
}: {
  tx: number;
  ty: number;
  meta: ScanMeta;
  zoom: number;
  viewport: { current: HTMLDivElement | null };
}) {
  const [thumbUrl, setThumbUrl] = useState("");
  const [fullUrl, setFullUrl] = useState("");
  const [onScreen, setOnScreen] = useState(false);
  const cell = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const u = URL.createObjectURL(meta.thumb);
    setThumbUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [meta.id]);

  // only cells the player can actually see are worth a full scan
  useEffect(() => {
    const el = cell.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOnScreen(true); // no observer: treat every cell as visible
      return;
    }
    const io = new IntersectionObserver(
      (entries) => setOnScreen(entries[entries.length - 1].isIntersecting),
      { root: viewport.current ?? null, rootMargin: "25%" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [meta.id, viewport.current]);

  const wantFull = zoom >= FULL_SCAN_ZOOM && onScreen;

  useEffect(() => {
    let dead = false;
    if (!wantFull) {
      setFullUrl("");
      return;
    }
    pool.request(meta.id).then((u) => {
      if (!dead && u) setFullUrl(u);
    });
    // if the pool drops this scan, fall back before the URL is revoked
    const off = pool.onEvicted((id) => {
      if (id === meta.id && !dead) setFullUrl("");
    });
    return () => {
      dead = true;
      off();
    };
  }, [meta.id, wantFull]);

  const shown = fullUrl || thumbUrl;
  return (
    <button
      ref={cell}
      class="atlas-cell"
      data-testid={`atlas-cell-${tx},${ty}`}
      data-scan={meta.id}
      data-full={fullUrl ? "yes" : "no"}
      onClick={() => go(panelHash(tx, ty))}
    >
      {shown && <img src={shown} alt={panelName(tx, ty)} draggable={false} />}
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
  onScale: (scale: number) => void,
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

    // the transform is applied on every move; the zoom is only REPORTED
    // when it changes enough to matter, so the cells do not re-render on
    // every pixel of a drag
    let reported = -1;
    const apply = () => {
      s.scale = Math.max(0.4, Math.min(4, s.scale));
      pl.style.transform = `translate(${s.x}px, ${s.y}px) scale(${s.scale})`;
      const step = Math.round(s.scale * 20) / 20;
      if (step !== reported) {
        reported = step;
        onScale(s.scale);
      }
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
