// The map renderer: canvas, drawn from ENGINE STATE (never from log text),
// in the canonical palette (CONTRACTS §2.4). Pure functions; the component
// owns the canvas and the view.
import {
  CHROME,
  FARM_FURROW,
  MARK_COLORS,
  PATINA_OFFSETS,
  PEOPLE_COLORS,
  RUNG_COLORS,
  RURAL_HOUSE,
  SUNKEN_TINT,
  darken55,
} from "../contracts/palette";
import { origin, panelName, type Geo } from "../contracts/geometry";

import type { WorldState } from "../contracts/schema";

export interface View {
  scale: number; // device px per unit
  x: number; // world-unit coords of the canvas top-left
  y: number;
}

export interface WorldIndex {
  geo: Geo;
  panels: [number, number][];
  base: Map<string, number>;
  people: Map<string, string>;
  marks: Map<string, string>;
  patina: Map<string, number>; // combined density per §2.4
  binder: Set<string>; // archived panels, "tx,ty"
  bounds: { x0: number; y0: number; x1: number; y1: number }; // unit box, exclusive max
}

export interface DrawOptions {
  panelNames: boolean;
  patina: boolean;
  dimArchived: boolean;
  highlight: [number, number] | null; // the current panel, outlined
}

const key = (x: number, y: number) => `${x},${y}`;

export function indexWorld(w: WorldState): WorldIndex {
  const geo: Geo = { w: w.config.panel_w, h: w.config.panel_h };
  const panels = w.world.panels.map(([tx, ty]) => [tx, ty] as [number, number]);
  const base = new Map(w.world.base.map(([x, y, r]) => [key(x, y), r]));
  const people = new Map(w.world.people.map(([x, y, k]) => [key(x, y), k]));
  const marks = new Map(w.world.marks.map(([x, y, m]) => [key(x, y), m]));
  const binder = new Set(w.world.binder.map(([tx, ty]) => key(tx, ty)));

  // Patina density: per-unit embellish plus the panel-level count distributed
  // round-robin over the panel's units sorted by (gx, gy) — CONTRACTS §2.4.
  const patina = new Map<string, number>();
  for (const [x, y, n] of w.world.embellish) patina.set(key(x, y), n);
  for (const [tx, ty, n] of w.world.embellish_panel) {
    const [ox, oy] = origin(geo, tx, ty);
    const units: [number, number][] = [];
    for (let dx = 0; dx < geo.w; dx++)
      for (let dy = 0; dy < geo.h; dy++) units.push([ox + dx, oy + dy]);
    units.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (let i = 0; i < n; i++) {
      const [ux, uy] = units[i % units.length];
      patina.set(key(ux, uy), (patina.get(key(ux, uy)) ?? 0) + 1);
    }
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [tx, ty] of panels) {
    const [ox, oy] = origin(geo, tx, ty);
    x0 = Math.min(x0, ox);
    y0 = Math.min(y0, oy);
    x1 = Math.max(x1, ox + geo.w);
    y1 = Math.max(y1, oy + geo.h);
  }
  if (!panels.length) { x0 = y0 = 0; x1 = y1 = 1; }
  return { geo, panels, base, people, marks, patina, binder, bounds: { x0, y0, x1, y1 } };
}

// The same scale, re-centered on a panel (the follow-current-panel mode).
export function centerOn(
  idx: WorldIndex,
  view: View,
  cw: number,
  ch: number,
  panel: [number, number],
): View {
  const [ox, oy] = origin(idx.geo, panel[0], panel[1]);
  const cx = ox + idx.geo.w / 2;
  const cy = oy + idx.geo.h / 2;
  return { ...view, x: cx - cw / view.scale / 2, y: cy - ch / view.scale / 2 };
}

export function fitView(idx: WorldIndex, cw: number, ch: number): View {
  const { x0, y0, x1, y1 } = idx.bounds;
  const scale = Math.max(
    2,
    Math.floor(Math.min(cw / (x1 - x0 + 2), ch / (y1 - y0 + 2))),
  );
  return {
    scale,
    x: x0 - (cw / scale - (x1 - x0)) / 2,
    y: y0 - (ch / scale - (y1 - y0)) / 2,
  };
}

export function draw(
  ctx: CanvasRenderingContext2D,
  idx: WorldIndex,
  view: View,
  cw: number,
  ch: number,
  opts: DrawOptions,
): void {
  const { geo } = idx;
  const s = view.scale;
  const px = (gx: number) => (gx - view.x) * s;
  const py = (gy: number) => (gy - view.y) * s;

  ctx.fillStyle = CHROME.background;
  ctx.fillRect(0, 0, cw, ch);

  for (const [tx, ty] of idx.panels) {
    const [ox, oy] = origin(geo, tx, ty);
    if (px(ox + geo.w) < 0 || px(ox) > cw || py(oy + geo.h) < 0 || py(oy) > ch)
      continue;
    for (let dx = 0; dx < geo.w; dx++) {
      for (let dy = 0; dy < geo.h; dy++) {
        const gx = ox + dx, gy = oy + dy;
        const k = key(gx, gy);
        const x = px(gx), y = py(gy);
        const rung = idx.base.get(k);
        if (rung !== undefined) {
          const col = idx.marks.get(k) === "sunken" ? SUNKEN_TINT : RUNG_COLORS[rung];
          ctx.fillStyle = col;
          ctx.fillRect(x, y, s, s);
          if (s >= 8) {
            ctx.strokeStyle = CHROME.unitOutline;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
          }
          const density = opts.patina ? (idx.patina.get(k) ?? 0) : 0;
          if (density > 0 && s >= 6) {
            const r = Math.max(1, s / 10);
            ctx.fillStyle = darken55(col);
            for (let i = 0; i < Math.min(density, 3); i++) {
              const [fx, fy] = PATINA_OFFSETS[i];
              ctx.beginPath();
              ctx.arc(x + fx * s, y + fy * s, r, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        } else {
          ctx.fillStyle = CHROME.emptyFill;
          ctx.fillRect(x, y, s, s);
          if (s >= 8) {
            ctx.strokeStyle = CHROME.emptyOutline;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);
          }
        }
        const person = idx.people.get(k);
        if (person) {
          ctx.fillStyle = PEOPLE_COLORS[person];
          ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
          if (s >= 8 && person.startsWith("farm")) {
            ctx.strokeStyle = FARM_FURROW;
            ctx.lineWidth = 1;
            for (const i of [1, 2]) {
              ctx.beginPath();
              ctx.moveTo(x + 2, y + (i * s) / 3);
              ctx.lineTo(x + s - 2, y + (i * s) / 3);
              ctx.stroke();
            }
          }
          if (s >= 8 && person === "rural") {
            ctx.fillStyle = RURAL_HOUSE;
            ctx.fillRect(x + s / 3, y + s / 2, s / 3, s / 2 - 3);
          }
        }
        const mark = s >= 8 ? idx.marks.get(k) : undefined;
        if (mark && mark !== "sunken") drawMark(ctx, mark, x, y, s);
      }
    }
  }

  // archived panels rest under a veil of the map background
  if (opts.dimArchived && idx.binder.size) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = CHROME.background;
    for (const [tx, ty] of idx.panels) {
      if (!idx.binder.has(`${tx},${ty}`)) continue;
      const [ox, oy] = origin(geo, tx, ty);
      ctx.fillRect(px(ox), py(oy), geo.w * s, geo.h * s);
    }
    ctx.globalAlpha = 1;
  }

  // panel borders + N1/E1 labels
  ctx.strokeStyle = CHROME.panelBorder;
  for (const [tx, ty] of idx.panels) {
    const [ox, oy] = origin(geo, tx, ty);
    ctx.lineWidth = s >= 8 ? 2 : 1;
    ctx.strokeRect(px(ox), py(oy), geo.w * s, geo.h * s);
    if (opts.panelNames && s >= 7) {
      ctx.fillStyle = CHROME.panelBorder;
      ctx.font = `${Math.max(9, Math.min(13, s))}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(panelName(tx, ty), px(ox) + 3, py(oy) + 2);
    }
  }

  // the current panel, outlined (volcano red from the canonical palette)
  if (opts.highlight) {
    const [ox, oy] = origin(geo, opts.highlight[0], opts.highlight[1]);
    ctx.strokeStyle = MARK_COLORS.volcano;
    ctx.lineWidth = Math.max(2, s / 5);
    ctx.strokeRect(px(ox), py(oy), geo.w * s, geo.h * s);
  }
}

function drawMark(
  ctx: CanvasRenderingContext2D,
  mark: string,
  x: number,
  y: number,
  s: number,
): void {
  ctx.lineWidth = Math.max(1, s / 8);
  switch (mark) {
    case "marsh":
      ctx.strokeStyle = MARK_COLORS.marsh;
      ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + 3 + i * (s / 4), y + s - s / 4);
        ctx.lineTo(x + 3 + i * (s / 4), y + s - s / 2);
        ctx.stroke();
      }
      break;
    case "volcano":
      ctx.fillStyle = MARK_COLORS.volcano;
      ctx.beginPath();
      ctx.moveTo(x + s / 2, y + 2);
      ctx.lineTo(x + 3, y + s / 2);
      ctx.lineTo(x + s - 3, y + s / 2);
      ctx.closePath();
      ctx.fill();
      break;
    case "canyon":
      ctx.strokeStyle = MARK_COLORS.canyon;
      ctx.beginPath();
      ctx.moveTo(x + 2, y + s - 3);
      ctx.lineTo(x + s / 2, y + 3);
      ctx.lineTo(x + s - 2, y + s - 3);
      ctx.stroke();
      break;
    case "ruins":
      ctx.strokeStyle = MARK_COLORS.ruins;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 3);
      ctx.lineTo(x + s - 3, y + s - 3);
      ctx.moveTo(x + 3, y + s - 3);
      ctx.lineTo(x + s - 3, y + 3);
      ctx.stroke();
      break;
    case "star": {
      ctx.strokeStyle = MARK_COLORS.star;
      const cx = x + s / 2, cy = y + s / 2, d = s / 3;
      for (const [dx, dy] of [[0, d], [d, 0], [d * 0.8, d * 0.8], [-d * 0.8, d * 0.8]]) {
        ctx.beginPath();
        ctx.moveTo(cx - dx, cy - dy);
        ctx.lineTo(cx + dx, cy + dy);
        ctx.stroke();
      }
      break;
    }
  }
}
