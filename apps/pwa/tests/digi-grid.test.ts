// The atlas grid's law: a map grows outward, so click-to-add reaches every
// open position beside a panel — the edges, not only the notches — and the
// grid keeps the coordinate rule's missing zero row and column.
import { describe, expect, it } from "vitest";

import { atlasGrid, coordKey, extendAxis } from "../src/digitalizer/grid";

const addableOf = (coords: [number, number][]) =>
  [...atlasGrid(coords).addable].sort();

describe("extendAxis", () => {
  it("adds one position at each end, stepping over the missing zero", () => {
    expect(extendAxis([1])).toEqual([-1, 1, 2]); // west of E1 is W1
    expect(extendAxis([-1])).toEqual([-2, -1, 1]); // east of W1 is E1
    expect(extendAxis([2, 3])).toEqual([1, 2, 3, 4]);
    expect(extendAxis([-2, -1, 1])).toEqual([-3, -2, -1, 1, 2]);
    expect(extendAxis([])).toEqual([]);
  });
});

describe("atlasGrid", () => {
  it("offers all four sides of a lone panel, and nothing diagonal", () => {
    const g = atlasGrid([[1, 1]]);
    expect(g.cols).toEqual([-1, 1, 2]);
    expect(g.rows).toEqual([2, 1, -1]); // north on top
    expect([...g.addable].sort()).toEqual(
      [coordKey(-1, 1), coordKey(1, -1), coordKey(1, 2), coordKey(2, 1)].sort(),
    );
    // the four diagonals stay silent
    for (const [tx, ty] of [[-1, 2], [2, 2], [-1, -1], [2, -1]] as [number, number][]) {
      expect(g.addable.has(coordKey(tx, ty))).toBe(false);
    }
  });

  it("offers the outer EDGES of a filled block, not only its corners", () => {
    // a 2×2 block has no notch at all: before, it offered nothing
    const block: [number, number][] = [
      [1, 1],
      [2, 1],
      [1, -1],
      [2, -1],
    ];
    const addable = addableOf(block);
    expect(addable).toEqual(
      [
        coordKey(1, 2), coordKey(2, 2), // north edge
        coordKey(1, -2), coordKey(2, -2), // south edge
        coordKey(-1, 1), coordKey(-1, -1), // west edge
        coordKey(3, 1), coordKey(3, -1), // east edge
      ].sort(),
    );
    expect(addable).toHaveLength(8);
  });

  it("keeps offering the notch inside an L, and adds its edges", () => {
    const l: [number, number][] = [
      [1, 1],
      [2, 1],
      [1, -1],
    ];
    const g = atlasGrid(l);
    expect(g.addable.has(coordKey(2, -1))).toBe(true); // the notch, as before
    expect(g.addable.has(coordKey(1, 2))).toBe(true); // and now the edges
    expect(g.addable.has(coordKey(3, 1))).toBe(true);
    expect(g.addable.has(coordKey(1, -2))).toBe(true);
  });

  it("never narrows: an interior gap with no panel beside it stays offered", () => {
    // two panels six rows apart — the middle holes touch nothing
    const g = atlasGrid([
      [1, 3],
      [1, -3],
    ]);
    for (const ty of [2, 1, -1, -2]) {
      expect(g.addable.has(coordKey(1, ty))).toBe(true);
    }
  });

  it("crosses the missing zero column when a map spans it", () => {
    const g = atlasGrid([[-1, 1]]);
    expect(g.addable.has(coordKey(1, 1))).toBe(true); // E1 sits beside W1
    expect(g.cols).toEqual([-2, -1, 1]);
  });

  it("is empty for an empty map", () => {
    const g = atlasGrid([]);
    expect(g.cols).toEqual([]);
    expect(g.rows).toEqual([]);
    expect(g.addable.size).toBe(0);
  });
});
