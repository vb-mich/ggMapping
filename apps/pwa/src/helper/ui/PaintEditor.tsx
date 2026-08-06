// The paint editor: one panel's units, editable inline — the truth
// hierarchy's hands (paper wins; overrides are first-class recorded events).
// Serves the age-start glance's corrections, detail-on-demand for a panel
// entering play, beyond-Spread border entry, and free editing at any time.
import { useMemo } from "preact/hooks";
import { useSignal } from "@preact/signals";

import {
  PEOPLE_COLORS,
  RUNG_COLORS,
  RUNG_NAMES,
  SUNKEN_TINT,
} from "../../contracts/palette";
import { origin as panelOrigin, panelName, type Geo } from "../../contracts/geometry";
import { STRINGS } from "../../strings";
import type { WorldState } from "../../contracts/schema";
import type { OverrideEdit } from "../schema";
import { PEOPLE_NAMES } from "./labels";

interface CellState {
  elevation: number | null;
  people: string | null;
  mark: string | null;
}

type Brush =
  | { t: "elevation"; v: number }
  | { t: "erase" }
  | { t: "people"; v: string | null }
  | { t: "mark"; v: string | null };

const MARKS = ["sunken", "marsh", "volcano", "canyon", "ruins", "star"] as const;
const PEOPLE = ["farm_lo", "farm_hi", "rural", "urb_lo", "urb_md", "urb_hi"] as const;

export function PaintEditor(props: {
  world: WorldState;
  panel: [number, number];
  preselect?: [number, number] | null;
  onSave: (edits: OverrideEdit[]) => void;
  onCancel: () => void;
}) {
  const geo: Geo = { w: props.world.config.panel_w, h: props.world.config.panel_h };
  const [ox, oy] = panelOrigin(geo, props.panel[0], props.panel[1]);

  const original = useMemo(() => {
    const base = new Map(props.world.world.base.map(([x, y, r]) => [`${x},${y}`, r]));
    const people = new Map(props.world.world.people.map(([x, y, k]) => [`${x},${y}`, k]));
    const marks = new Map(props.world.world.marks.map(([x, y, m]) => [`${x},${y}`, m]));
    const cells = new Map<string, CellState>();
    for (let dy = 0; dy < geo.h; dy++)
      for (let dx = 0; dx < geo.w; dx++) {
        const k = `${ox + dx},${oy + dy}`;
        cells.set(k, {
          elevation: base.get(k) ?? null,
          people: people.get(k) ?? null,
          mark: marks.get(k) ?? null,
        });
      }
    return cells;
  }, [props.world, props.panel[0], props.panel[1]]);

  const cells = useSignal(new Map(original));
  const brush = useSignal<Brush>({ t: "elevation", v: 5 });

  const applyBrush = (k: string) => {
    const next = new Map(cells.value);
    const c = { ...next.get(k)! };
    const b = brush.value;
    if (b.t === "elevation") c.elevation = c.elevation === b.v ? null : b.v;
    else if (b.t === "erase") {
      c.elevation = null;
      c.people = null;
      c.mark = null;
    } else if (b.t === "people") c.people = c.people === b.v ? null : b.v;
    else c.mark = c.mark === b.v ? null : b.v;
    next.set(k, c);
    cells.value = next;
  };

  // The Step Rule, kindly (HELPER_DESIGN truth hierarchy): neighbors may
  // differ by one elevation step. An edit that breaks it is FLAGGED and
  // followed anyway — the paper wins; this line only explains. Advisory
  // text, never a rule the record depends on.
  const stepRuleNotes = (): string[] => {
    const notes: string[] = [];
    const outerBase = new Map(
      props.world.world.base.map(([x, y, r]) => [`${x},${y}`, r]),
    );
    const wildSet = new Set(props.world.world.wild.map(([x, y]) => `${x},${y}`));
    const at = (x: number, y: number): number | null => {
      const k = `${x},${y}`;
      if (wildSet.has(k)) return null; // anomalies stand outside the rule
      const inCell = cells.value.get(k);
      if (inCell) return inCell.mark ? null : inCell.elevation;
      return outerBase.get(k) ?? null;
    };
    for (let dy = 0; dy < geo.h; dy++)
      for (let dx = 0; dx < geo.w; dx++) {
        const x = ox + dx, y = oy + dy;
        const here = at(x, y);
        if (here === null) continue;
        for (const [nx, ny] of [
          [x + 1, y],
          [x, y + 1],
        ] as const) {
          const there = at(nx, ny);
          if (there !== null && Math.abs(here - there) > 1) {
            notes.push(
              `r${dy + 1}c${dx + 1}: ${RUNG_NAMES[here]} beside ${RUNG_NAMES[there]}`,
            );
          }
        }
      }
    return notes.slice(0, 4);
  };

  const save = () => {
    const edits: OverrideEdit[] = [];
    for (const [k, now] of cells.value) {
      const was = original.get(k)!;
      const unit = k.split(",").map(Number) as [number, number];
      if (now.elevation !== was.elevation)
        edits.push({ op: "base", unit, elevation: now.elevation });
      if (now.people !== was.people) edits.push({ op: "people", unit, kind: now.people });
      if (now.mark !== was.mark) edits.push({ op: "mark", unit, mark: now.mark });
    }
    props.onSave(edits);
  };

  const swatch = (c: CellState) => {
    const bg =
      c.mark === "sunken"
        ? SUNKEN_TINT
        : c.elevation !== null
          ? RUNG_COLORS[c.elevation]
          : "transparent";
    return bg;
  };

  return (
    <div class="card paint-editor" data-testid="paint-editor">
      <h3>
        {STRINGS.hpPaintTitle} — {panelName(props.panel[0], props.panel[1])}
      </h3>
      <p class="hint">{STRINGS.hpPaintHint}</p>
      <div
        class="paint-grid"
        style={`grid-template-columns: repeat(${geo.w}, 1fr); max-width:${geo.w * 44}px`}
      >
        {[...Array(geo.h).keys()].map((dy) =>
          [...Array(geo.w).keys()].map((dx) => {
            const k = `${ox + dx},${oy + dy}`;
            const c = cells.value.get(k)!;
            const pre =
              props.preselect && props.preselect[0] === ox + dx && props.preselect[1] === oy + dy;
            return (
              <button
                key={k}
                class={`paint-cell${pre ? " preselect" : ""}`}
                style={`background:${swatch(c)}`}
                data-testid={`paint-cell-${dy + 1}-${dx + 1}`}
                title={`r${dy + 1}c${dx + 1}`}
                onClick={() => applyBrush(k)}
              >
                {c.people && (
                  <i class="paint-people" style={`background:${PEOPLE_COLORS[c.people]}`} />
                )}
                {c.mark && c.mark !== "sunken" && <em class="paint-mark">{c.mark[0]}</em>}
              </button>
            );
          }),
        )}
      </div>
      <div class="paint-tools">
        {RUNG_NAMES.map((n, i) => (
          <button
            key={n}
            class={
              brush.value.t === "elevation" && brush.value.v === i ? "tool active" : "tool"
            }
            style={`background:${RUNG_COLORS[i]}`}
            title={n}
            data-testid={`brush-${n}`}
            onClick={() => (brush.value = { t: "elevation", v: i })}
          />
        ))}
        <button
          class={brush.value.t === "erase" ? "tool erase active" : "tool erase"}
          data-testid="brush-erase"
          onClick={() => (brush.value = { t: "erase" })}
        >
          {STRINGS.hpErase}
        </button>
      </div>
      <div class="paint-tools">
        <span class="legend-label">{STRINGS.hpPeople}:</span>
        {PEOPLE.map((p) => (
          <button
            key={p}
            class={
              brush.value.t === "people" && brush.value.v === p ? "tool active" : "tool"
            }
            style={`background:${PEOPLE_COLORS[p]}`}
            title={PEOPLE_NAMES[p]}
            data-testid={`brush-${p}`}
            onClick={() => (brush.value = { t: "people", v: p })}
          />
        ))}
      </div>
      <div class="paint-tools">
        <span class="legend-label">{STRINGS.hpMarks}:</span>
        {MARKS.map((m) => (
          <button
            key={m}
            class={brush.value.t === "mark" && brush.value.v === m ? "tool chip active" : "tool chip"}
            data-testid={`brush-${m}`}
            onClick={() => (brush.value = { t: "mark", v: m })}
          >
            {m}
          </button>
        ))}
      </div>
      {stepRuleNotes().length > 0 && (
        <p class="hint" data-testid="step-rule-note" role="status">
          {STRINGS.hpStepRule.replace("{places}", stepRuleNotes().join("; "))}
        </p>
      )}
      <div class="row">
        <button class="primary" data-testid="paint-save" onClick={save}>
          {STRINGS.hpSaveEdits}
        </button>
        <button class="ghost" data-testid="paint-cancel" onClick={props.onCancel}>
          {STRINGS.hpCancelEdits}
        </button>
      </div>
    </div>
  );
}
