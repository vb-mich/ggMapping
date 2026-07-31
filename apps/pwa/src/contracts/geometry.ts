// The coordinate convention, CONTRACTS §2 — pure math, no rules.
export interface Geo {
  w: number; // panel width (units, x)
  h: number; // panel height (units, y)
}

const txi = (tx: number) => (tx > 0 ? tx - 1 : tx);
const tyi = (ty: number) => (ty > 0 ? -ty : -ty - 1);

export function origin(geo: Geo, tx: number, ty: number): [number, number] {
  return [txi(tx) * geo.w, tyi(ty) * geo.h];
}

export function panelOf(geo: Geo, gx: number, gy: number): [number, number] {
  const xi = Math.floor(gx / geo.w);
  const yi = Math.floor(gy / geo.h);
  return [xi >= 0 ? xi + 1 : xi, yi >= 0 ? -(yi + 1) : -yi];
}

// {N|S}{|ty|}/{E|W}{|tx|} — north/south first, then east/west (§2.1).
export function panelName(tx: number, ty: number): string {
  const ns = ty > 0 ? `N${ty}` : `S${-ty}`;
  const ew = tx > 0 ? `E${tx}` : `W${-tx}`;
  return `${ns}/${ew}`;
}

// r/c, 1-based: r from the north edge, c from the west edge (§2.2).
export function rcOf(geo: Geo, gx: number, gy: number): [number, number] {
  const [tx, ty] = panelOf(geo, gx, gy);
  const [ox, oy] = origin(geo, tx, ty);
  return [gy - oy + 1, gx - ox + 1];
}
