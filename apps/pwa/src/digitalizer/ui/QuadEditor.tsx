// The four crop vertices, always user-adjustable: the photo below, an SVG
// overlay above, one draggable handle per corner. Coordinates live in image
// space; the overlay scales with the element.
import { useEffect, useRef } from "preact/hooks";

import type { Pt, Quad } from "../geometry";
import type { Raster } from "../raster";
import { toImageData } from "../pipeline";

interface Props {
  raster: Raster;
  quad: Quad;
  onChange: (q: Quad) => void;
}

export function QuadEditor({ raster, quad, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef<number>(-1);

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

  const down = (i: number) => (e: PointerEvent) => {
    dragging.current = i;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    const i = dragging.current;
    if (i < 0) return;
    const p = toImage(e);
    const next = quad.map((q, j) => (j === i ? p : q)) as Quad;
    onChange(next);
  };
  const up = () => (dragging.current = -1);

  const r = Math.max(raster.width, raster.height) * 0.028;
  const points = quad.map((p) => `${p.x},${p.y}`).join(" ");

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
              onPointerDown={down(i)}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
