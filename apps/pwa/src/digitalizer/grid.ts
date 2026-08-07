// The atlas's grid, pure. A map grows OUTWARD in every direction, so the
// grid is the panels' bounding box plus one ring, and click-to-add is
// offered at every open position that shares a SIDE with a panel — the
// edges people actually grow along, not only the notches inside the shape.
// Positions already offered (open cells within the bounding box) stay
// offered: this widens the path, it never narrows it.
import { stepCoord } from "./db";
import { coordAxis } from "./stitch";

export const coordKey = (tx: number, ty: number) => `${tx},${ty}`;

// One position further at each end. The grid has no zero row or column, so
// the step across the origin is the coordinate rule's, not arithmetic's.
export function extendAxis(axis: number[]): number[] {
  if (!axis.length) return [];
  return [stepCoord(axis[0], -1), ...axis, stepCoord(axis[axis.length - 1], 1)];
}

export interface AtlasGrid {
  cols: number[]; // west → east
  rows: number[]; // north → south, as the atlas draws them
  addable: Set<string>; // open positions that invite a first scan
}

export function atlasGrid(coords: [number, number][]): AtlasGrid {
  if (!coords.length) return { cols: [], rows: [], addable: new Set() };

  const filled = new Set(coords.map(([tx, ty]) => coordKey(tx, ty)));
  const innerCols = coordAxis(coords.map(([tx]) => tx));
  const innerRows = coordAxis(coords.map(([, ty]) => ty));
  const withinBox = (tx: number, ty: number) =>
    innerCols.includes(tx) && innerRows.includes(ty);

  const cols = extendAxis(innerCols);
  const rows = extendAxis(innerRows);

  const addable = new Set<string>();
  for (const tx of cols) {
    for (const ty of rows) {
      if (filled.has(coordKey(tx, ty))) continue;
      const sideAdjacent =
        filled.has(coordKey(stepCoord(tx, 1), ty)) ||
        filled.has(coordKey(stepCoord(tx, -1), ty)) ||
        filled.has(coordKey(tx, stepCoord(ty, 1))) ||
        filled.has(coordKey(tx, stepCoord(ty, -1)));
      if (sideAdjacent || withinBox(tx, ty)) addable.add(coordKey(tx, ty));
    }
  }
  return { cols, rows: [...rows].reverse(), addable };
}
