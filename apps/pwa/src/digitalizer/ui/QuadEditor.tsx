// The crop vertices, always user-adjustable: the photo below, an SVG overlay
// above. Four corner handles, four mid-edge handles (dragging a mid-edge
// translates its whole edge), and — while anything drags — a magnifier loupe
// pinned to a top corner of the stage, because on a phone the finger covers
// exactly the spot being adjusted. Coordinates live in image space; the
// overlay scales with the element.
import { useEffect, useRef, useState } from "preact/hooks";

import type { Pt, Quad } from "../geometry";
import type { Raster } from "../raster";
import { toImageData } from "../pipeline";

interface Props {
  raster: Raster;
  quad: Quad;
  onChange: (q: Quad) => void;
}

type Grip = { kind: "corner"; i: number } | { kind: "edge"; i: number };

const LOUPE_CSS = 120; // on-screen size (px)
const LOUPE_PX = 240; // canvas backing size
const LOUPE_ZOOM = 2.5; // relative to the on-screen image scale

export function QuadEditor({ raster, quad, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const grip = useRef<Grip | null>(null);
  const lastPt = useRef<Pt>({ x: 0, y: 0 });
  const quadRef = useRef(quad);
  quadRef.current = quad;
  const [dragging, setDragging] = useState(false);
  const [loupeSide, setLoupeSide] = useState<"left" | "right">("left");

  useEffect(() => {
    const cv = canvasRef.current!;
    cv.width = raster.width;
    cv.height = raster.height;
    cv.getContext("2d")!.putImageData(toImageData(raster), 0, 0);
  }, [raster]);

  const toImage = (e: PointerEvent): Pt => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * raster.width;
    const y = ((e.clientY - rect.top) / rect.height) * raster.height;
    return {
      x: Math.max(0, Math.min(raster.width, x)),
      y: Math.max(0, Math.min(raster.height, y)),
    };
  };

  const drawLoupe = (center: Pt) => {
    const cv = loupeRef.current;
    const src = canvasRef.current;
    const svg = svgRef.current;
    if (!cv || !src || !svg) return;
    const rect = svg.getBoundingClientRect();
    const displayScale = rect.width / raster.width; // css px per image px
    const srcSide = LOUPE_CSS / (displayScale * LOUPE_ZOOM);
    const g = cv.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, LOUPE_PX, LOUPE_PX);
    g.drawImage(
      src,
      center.x - srcSide / 2,
      center.y - srcSide / 2,
      srcSide,
      srcSide,
      0,
      0,
      LOUPE_PX,
      LOUPE_PX,
    );
    // the quad's edges through the loupe, like the outline on the image
    const toLoupe = (p: Pt) => ({
      x: ((p.x - (center.x - srcSide / 2)) / srcSide) * LOUPE_PX,
      y: ((p.y - (center.y - srcSide / 2)) / srcSide) * LOUPE_PX,
    });
    const q = quadRef.current;
    g.strokeStyle = "#4193bc";
    g.lineWidth = 4;
    g.beginPath();
    q.forEach((p, i) => {
      const l = toLoupe(p);
      if (i === 0) g.moveTo(l.x, l.y);
      else g.lineTo(l.x, l.y);
    });
    g.closePath();
    g.stroke();
    // crosshair
    g.strokeStyle = "rgba(255,255,255,0.85)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(LOUPE_PX / 2, 0);
    g.lineTo(LOUPE_PX / 2, LOUPE_PX);
    g.moveTo(0, LOUPE_PX / 2);
    g.lineTo(LOUPE_PX, LOUPE_PX / 2);
    g.stroke();
    // keep the loupe out from under the finger: it lives top-left, and hops
    // to the top-right while the pointer works that quadrant
    const cssX = (center.x / raster.width) * rect.width;
    const cssY = (center.y / raster.height) * rect.height;
    setLoupeSide(cssX < LOUPE_CSS + 48 && cssY < LOUPE_CSS + 48 ? "right" : "left");
  };

  const down = (g: Grip) => (e: PointerEvent) => {
    grip.current = g;
    lastPt.current = toImage(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDragging(true);
    drawLoupe(lastPt.current);
    e.preventDefault();
  };

  const move = (e: PointerEvent) => {
    const g = grip.current;
    if (!g) return;
    const p = toImage(e);
    const q = quadRef.current;
    if (g.kind === "corner") {
      onChange(q.map((c, j) => (j === g.i ? p : c)) as Quad);
    } else {
      // translate the whole edge, clamped so both corners stay in frame
      const a = q[g.i];
      const b = q[(g.i + 1) % 4];
      let dx = p.x - lastPt.current.x;
      let dy = p.y - lastPt.current.y;
      dx = Math.max(-Math.min(a.x, b.x), Math.min(raster.width - Math.max(a.x, b.x), dx));
      dy = Math.max(-Math.min(a.y, b.y), Math.min(raster.height - Math.max(a.y, b.y), dy));
      onChange(
        q.map((c, j) =>
          j === g.i || j === (g.i + 1) % 4 ? { x: c.x + dx, y: c.y + dy } : c,
        ) as Quad,
      );
    }
    lastPt.current = p;
    drawLoupe(p);
  };

  const up = () => {
    grip.current = null;
    setDragging(false);
  };

  const r = Math.max(raster.width, raster.height) * 0.028;
  const points = quad.map((p) => `${p.x},${p.y}`).join(" ");
  const mids = quad.map((p, i) => {
    const n = quad[(i + 1) % 4];
    return { x: (p.x + n.x) / 2, y: (p.y + n.y) / 2 };
  });

  return (
    <div class="crop-stage">
      <canvas ref={canvasRef} class="crop-canvas" />
      <svg
        ref={svgRef}
        class="crop-overlay"
        viewBox={`0 0 ${raster.width} ${raster.height}`}
        data-testid="quad-editor"
        data-w={raster.width}
        data-h={raster.height}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <polygon class="crop-outline" points={points} data-testid="quad-outline" />
        {mids.map((m, i) => (
          <g key={`m${i}`}>
            <rect
              class="crop-mid"
              x={m.x - r * 0.32}
              y={m.y - r * 0.32}
              width={r * 0.64}
              height={r * 0.64}
            />
            <rect
              class="crop-hit"
              x={m.x - r}
              y={m.y - r}
              width={r * 2}
              height={r * 2}
              data-testid={`quad-mid-${i}`}
              data-x={Math.round(m.x)}
              data-y={Math.round(m.y)}
              onPointerDown={down({ kind: "edge", i })}
            />
          </g>
        ))}
        {quad.map((p, i) => (
          <g key={i}>
            <circle class="crop-handle" cx={p.x} cy={p.y} r={r * 0.45} />
            <circle
              class="crop-hit"
              cx={p.x}
              cy={p.y}
              r={r}
              data-testid={`quad-handle-${i}`}
              data-x={Math.round(p.x)}
              data-y={Math.round(p.y)}
              onPointerDown={down({ kind: "corner", i })}
            />
          </g>
        ))}
      </svg>
      <canvas
        ref={loupeRef}
        class={`drag-loupe ${loupeSide}`}
        width={LOUPE_PX}
        height={LOUPE_PX}
        data-testid="drag-loupe"
        hidden={!dragging}
      />
    </div>
  );
}
