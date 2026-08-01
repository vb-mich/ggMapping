// The whole-map export's geometry, pure: panels stitched at their map
// coordinates with a 1 px gap, every cell the map's median scan aspect,
// each scan contain-fitted. The longest edge is capped so the canvas stays
// inside what mobile browsers allow — iOS Safari's canvas ceiling is
// ~16.7 million pixels (4096²), the binding constraint among the mobile
// engines, so the cap is 4096: any output within it is square-or-smaller in
// area and safe everywhere.

export const EXPORT_CAP = 4096;
export const EXPORT_GAP = 1;

// Coordinate values lo..hi with the (nonexistent) zero skipped.
export function coordAxis(values: number[]): number[] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const out: number[] = [];
  for (let v = lo; v <= hi; v++) if (v !== 0) out.push(v);
  return out;
}

export function medianAspect(items: { width: number; height: number }[]): number {
  const ratios = items
    .map((s) => s.width / s.height)
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b);
  if (!ratios.length) return 5 / 6;
  return ratios[ratios.length >> 1];
}

export interface StitchItem {
  tx: number;
  ty: number;
  width: number; // the source scan's pixels (thumb or full)
  height: number;
}

export interface StitchCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StitchLayout {
  width: number;
  height: number;
  cellW: number;
  cellH: number;
  cols: number[]; // west → east
  rows: number[]; // north → south
  cells: Map<string, StitchCell>; // "tx,ty" → its rect, occupied panels only
  capped: boolean;
}

export function stitchLayout(
  items: StitchItem[],
  baseCellH: number,
  cap = EXPORT_CAP,
): StitchLayout {
  if (!items.length) throw new Error("nothing to stitch");
  const cols = coordAxis(items.map((s) => s.tx));
  const rows = coordAxis(items.map((s) => s.ty)).reverse(); // north on top
  const aspect = medianAspect(items);

  let cellH = Math.max(8, Math.round(baseCellH));
  let cellW = Math.max(8, Math.round(cellH * aspect));
  const widthOf = (cw: number) => cols.length * cw + (cols.length - 1) * EXPORT_GAP;
  const heightOf = (ch: number) => rows.length * ch + (rows.length - 1) * EXPORT_GAP;

  // the gaps stay 1 px; only the cells scale down to honor the cap
  const scale = Math.min(
    1,
    (cap - (cols.length - 1) * EXPORT_GAP) / (cols.length * cellW),
    (cap - (rows.length - 1) * EXPORT_GAP) / (rows.length * cellH),
  );
  const capped = scale < 1;
  if (capped) {
    cellW = Math.max(8, Math.floor(cellW * scale));
    cellH = Math.max(8, Math.floor(cellH * scale));
  }

  const cells = new Map<string, StitchCell>();
  for (const s of items) {
    const ci = cols.indexOf(s.tx);
    const ri = rows.indexOf(s.ty);
    cells.set(`${s.tx},${s.ty}`, {
      x: ci * (cellW + EXPORT_GAP),
      y: ri * (cellH + EXPORT_GAP),
      w: cellW,
      h: cellH,
    });
  }
  return {
    width: widthOf(cellW),
    height: heightOf(cellH),
    cellW,
    cellH,
    cols,
    rows,
    cells,
    capped,
  };
}

// Contain-fit a source into a cell: centered, aspect kept.
export function containFit(
  srcW: number,
  srcH: number,
  cell: StitchCell,
): { x: number; y: number; w: number; h: number } {
  const s = Math.min(cell.w / srcW, cell.h / srcH);
  const w = Math.max(1, Math.round(srcW * s));
  const h = Math.max(1, Math.round(srcH * s));
  return { x: cell.x + Math.round((cell.w - w) / 2), y: cell.y + Math.round((cell.h - h) / 2), w, h };
}
