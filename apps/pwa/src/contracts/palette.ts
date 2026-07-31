// The canonical palette, CONTRACTS §2.4 — transcribed, never invented.
// A test compares these constants against docs/CONTRACTS.md.

export const RUNG_NAMES = [
  "verydeep", "deep", "medium", "shallow", "coastal", "plain", "hills", "mountains",
] as const;

export const RUNG_COLORS: readonly string[] = [
  "#14364F", // verydeep
  "#205E82", // deep
  "#4193BC", // medium
  "#A7D5E4", // shallow
  "#E8D18F", // coastal
  "#8FBE6E", // plain
  "#B3A15E", // hills
  "#77573F", // mountains
];

export const PEOPLE_COLORS: Readonly<Record<string, string>> = {
  farm_lo: "#C9DFA0",
  farm_hi: "#5E8F45",
  rural: "#C7A472",
  urb_lo: "#D3D3D3",
  urb_md: "#A6A6A6",
  urb_hi: "#6B6B6B",
};

export const FARM_FURROW = "#00000055";
export const RURAL_HOUSE = "#6B4E2E";

export const MARK_COLORS: Readonly<Record<string, string>> = {
  marsh: "#2E5E50",
  volcano: "#C0392B",
  canyon: "#5A3E22",
  ruins: "#555555",
  star: "#B8860B",
};
export const SUNKEN_TINT = "#7FAF9C";

export const CHROME = {
  background: "#F3EFE7",
  emptyFill: "#FFFFFF",
  emptyOutline: "#D8D2C6",
  unitOutline: "#00000022",
  panelBorder: "#4A4238",
} as const;

// Patina dot rule (§2.4): up to min(density, 3) dots at these relative offsets,
// radius max(1, unit_px / 10), color = rendered base darkened per-channel ×0.55.
export const PATINA_OFFSETS: readonly [number, number][] = [
  [0.30, 0.34],
  [0.68, 0.52],
  [0.44, 0.74],
];

export function darken55(hex: string): string {
  const n = (i: number) =>
    Math.floor(parseInt(hex.slice(i, i + 2), 16) * 0.55)
      .toString(16)
      .padStart(2, "0");
  return `#${n(1)}${n(3)}${n(5)}`;
}
