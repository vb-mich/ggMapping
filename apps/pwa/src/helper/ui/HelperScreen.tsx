// The Helper's screens: the world list with its three origins, and the
// table screen — the map with glowing candidates, the age flow, the paint
// editor, catch-ups, and the record. Mobile-first: this tool lives at a
// table next to paper.
import { useEffect, useMemo } from "preact/hooks";
import { useSignal } from "@preact/signals";

import { STRINGS } from "../../strings";
import { go, helperWorldHash, type Route } from "../../router";
import { panelName } from "../../contracts/geometry";
import type { JmConfig, JmEvent } from "../../contracts/schema";
import { canonical, geoOf, questionPanels, questionUnits } from "../core";
import type { DeckAnswer, PaperEntry } from "../core";
import type { HelperSession } from "../session";
import {
  abandonAge,
  activeMeta,
  addCatchup,
  addOverride,
  answer,
  beyondSpread,
  bump,
  busy,
  closeWorld,
  confirmGlance,
  engine,
  exportActive,
  importFile,
  markEntered,
  notice,
  openWorld,
  readOnly,
  refreshWorlds,
  removeWorld,
  sessionOf,
  worlds,
} from "../store";
import { AgeFlow } from "./AgeFlow";
import { HelperMap, type MapOverlay } from "./HelperMap";
import { PaintEditor } from "./PaintEditor";
import { DeckAnswerForm, SkeletonEditor } from "./SkeletonEditor";

const geometryConfig = (choice: string, cw: number, ch: number): JmConfig =>
  choice === "8x10"
    ? { panel_w: 8, panel_h: 10 }
    : choice === "custom"
      ? { panel_w: cw, panel_h: ch }
      : {};

function CreateForms(props: { onCreated: (id: string) => void }) {
  const which = useSignal<"blank" | "fork" | "paper" | null>(null);
  const name = useSignal("");
  const seed = useSignal(1 + Math.floor(Math.random() * 10_000_000));
  const eras = useSignal(20);
  const ages = useSignal(25);
  const geometry = useSignal<"5x6" | "8x10" | "custom">("5x6");
  const customW = useSignal(5);
  const customH = useSignal(6);

  const cfg = () => geometryConfig(geometry.value, customW.value, customH.value);

  const create = async () => {
    const { createBlank, createFork } = await import("../store");
    const id =
      which.value === "blank"
        ? await createBlank(name.value, cfg(), seed.value)
        : await createFork(name.value, cfg(), seed.value, eras.value, ages.value);
    if (id) props.onCreated(id);
  };

  const createPaper = async (entry: Omit<PaperEntry, "config">) => {
    const { createPaper: doCreate } = await import("../store");
    const id = await doCreate(name.value, { ...entry, config: cfg() });
    if (id) props.onCreated(id);
  };

  const geometryRow = (
    <div class="row">
      <label class="field">
        <span>{STRINGS.hpGeometry}</span>
        <select
          value={geometry.value}
          data-testid="new-geometry"
          onChange={(e) => (geometry.value = (e.target as HTMLSelectElement).value as never)}
        >
          <option value="5x6">{STRINGS.panelSizeMini}</option>
          <option value="8x10">{STRINGS.panelSizeFull}</option>
          <option value="custom">{STRINGS.panelSizeCustom}</option>
        </select>
      </label>
      {geometry.value === "custom" && (
        <>
          <label class="field">
            <span>{STRINGS.customW}</span>
            <input type="number" min={2} max={12} value={customW.value} data-testid="new-custom-w"
              onInput={(e) => (customW.value = Number((e.target as HTMLInputElement).value) || 5)} />
          </label>
          <label class="field">
            <span>{STRINGS.customH}</span>
            <input type="number" min={2} max={12} value={customH.value} data-testid="new-custom-h"
              onInput={(e) => (customH.value = Number((e.target as HTMLInputElement).value) || 6)} />
          </label>
        </>
      )}
    </div>
  );

  return (
    <section class="card" data-testid="helper-create">
      <h2>{STRINGS.hpNewWorld}</h2>
      <div class="origin-buttons">
        {(
          [
            ["blank", STRINGS.hpOriginBlank, STRINGS.hpOriginBlankHint],
            ["fork", STRINGS.hpOriginFork, STRINGS.hpOriginForkHint],
            ["paper", STRINGS.hpOriginPaper, STRINGS.hpOriginPaperHint],
          ] as const
        ).map(([id, label, hint]) => (
          <button
            key={id}
            class={which.value === id ? "origin active" : "origin"}
            data-testid={`origin-${id}`}
            onClick={() => (which.value = which.value === id ? null : id)}
          >
            <b>{label}</b>
            <small>{hint}</small>
          </button>
        ))}
      </div>
      {which.value && (
        <label class="field">
          <span>{STRINGS.hpWorldName}</span>
          <input
            value={name.value}
            data-testid="new-name"
            placeholder={STRINGS.hpDefaultName}
            onInput={(e) => (name.value = (e.target as HTMLInputElement).value)}
          />
        </label>
      )}
      {(which.value === "blank" || which.value === "fork") && (
        <>
          {geometryRow}
          <div class="row">
            <label class="field">
              <span>{STRINGS.hpSeed}</span>
              <input type="number" value={seed.value} data-testid="new-seed"
                onInput={(e) => (seed.value = Number((e.target as HTMLInputElement).value) || 1)} />
            </label>
            {which.value === "fork" && (
              <>
                <label class="field">
                  <span>{STRINGS.hpEras}</span>
                  <input type="number" min={1} max={40} value={eras.value} data-testid="new-eras"
                    onInput={(e) => (eras.value = Number((e.target as HTMLInputElement).value) || 20)} />
                </label>
                <label class="field">
                  <span>{STRINGS.hpForkAges}</span>
                  <input type="number" min={0} max={999} value={ages.value} data-testid="new-ages"
                    onInput={(e) => (ages.value = Number((e.target as HTMLInputElement).value) || 0)} />
                </label>
              </>
            )}
          </div>
          <button class="primary" disabled={busy.value} data-testid="btn-create" onClick={create}>
            {STRINGS.hpCreate}
          </button>
        </>
      )}
      {which.value === "paper" && (
        <>
          {geometryRow}
          <SkeletonEditor
            config={cfg()}
            onDone={(entry) => void createPaper(entry)}
            onCancel={() => (which.value = null)}
          />
        </>
      )}
    </section>
  );
}

function WorldList() {
  const confirmDelete = useSignal<string | null>(null);
  useEffect(() => {
    void refreshWorlds();
  }, []);

  const onImport = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    void f.text().then(async (text) => {
      const id = await importFile(text);
      input.value = "";
      if (id) go(helperWorldHash(id));
    });
  };

  return (
    <main class="helper" data-testid="helper-list">
      <section class="card">
        <h2>{STRINGS.hpTitle}</h2>
        <p class="hint">{STRINGS.hpTagline}</p>
        {worlds.value.length === 0 && <p data-testid="helper-empty">{STRINGS.hpEmptyList}</p>}
        <ul class="world-list">
          {worlds.value.map((w) => (
            <li key={w.id} class="world-row" data-testid={`world-${w.id}`}>
              <button class="world-open" data-testid={`open-${w.id}`}
                onClick={() => go(helperWorldHash(w.id))}>
                <b>{w.name}</b>
                <small>
                  {w.origin.type} · {new Date(w.updated).toLocaleDateString()}
                </small>
              </button>
              {confirmDelete.value === w.id ? (
                <span class="row">
                  <small>{STRINGS.hpDeleteWarn.replace("{name}", w.name)}</small>
                  <button class="danger" data-testid={`really-delete-${w.id}`}
                    onClick={() => void removeWorld(w.id)}>
                    {STRINGS.hpDelete}
                  </button>
                  <button class="ghost" onClick={() => (confirmDelete.value = null)}>
                    {STRINGS.hpCancelEdits}
                  </button>
                </span>
              ) : (
                <button class="ghost" data-testid={`delete-${w.id}`}
                  onClick={() => (confirmDelete.value = w.id)}>
                  {STRINGS.hpDelete}
                </button>
              )}
            </li>
          ))}
        </ul>
        <label class="ghost file-button">
          {STRINGS.hpImport}
          <input type="file" accept=".json,application/json" data-testid="import-world" onChange={onImport} />
        </label>
      </section>
      <CreateForms onCreated={(id) => go(helperWorldHash(id))} />
    </main>
  );
}

function CatchupCard(props: { onClose: () => void; config: JmConfig; era: number }) {
  const ages = useSignal(1);
  const deck = useSignal<DeckAnswer>({ freshShuffle: true, marked: null, played: [] });
  const eraAfter = props.era + Math.floor(ages.value / 25) + 1; // upper bound for wake
  return (
    <section class="card" data-testid="catchup-card">
      <h3>{STRINGS.hpCatchupTitle}</h3>
      <p class="hint">{STRINGS.hpCatchupHint}</p>
      <label class="field">
        <span>{STRINGS.hpCatchupAges}</span>
        <input type="number" min={1} max={200} value={ages.value} data-testid="catchup-ages"
          onInput={(e) => (ages.value = Math.max(1, Number((e.target as HTMLInputElement).value) || 1))} />
      </label>
      <DeckAnswerForm
        config={props.config}
        woken={eraAfter >= 2}
        value={deck.value}
        onChange={(v) => (deck.value = v)}
      />
      <div class="row">
        <button class="primary" data-testid="catchup-go"
          onClick={() => {
            void addCatchup(ages.value, deck.value, STRINGS.hpCheckpointNote).then(props.onClose);
          }}>
          {STRINGS.hpCatchupGo}
        </button>
        <button class="ghost" onClick={props.onClose}>{STRINGS.hpCancelEdits}</button>
      </div>
    </section>
  );
}

function WorldScreen(props: { id: string }) {
  void bump.value; // re-derive on every session mutation
  const loadedFor = useSignal<string | null>(null);

  useEffect(() => {
    if (loadedFor.value !== props.id) {
      loadedFor.value = props.id;
      void openWorld(props.id);
    }
  }, [props.id]);

  const meta = activeMeta.value;
  const s = sessionOf();
  if (!meta || meta.id !== props.id || !s) {
    return (
      <main class="helper" data-testid="helper-loading">
        <section class="card">{STRINGS.mmWorking}</section>
      </main>
    );
  }
  return <WorldBody meta={meta} s={s} />;
}

function WorldBody(props: { meta: NonNullable<typeof activeMeta.value>; s: HelperSession }) {
  void bump.value;
  const { meta, s } = props;
  const editing = useSignal<{ panel: [number, number]; preselect: [number, number] | null } | null>(null);
  const showCatchup = useSignal(false);
  const patina = useSignal<Map<string, number>>(new Map());
  // The record IS a timeline: replay stored every age's closing state, so a
  // view of any past moment is free. null = now; play always snaps back.
  const viewAt = useSignal<number | null>(null);

  const view = s.view;
  if (view && viewAt.value !== null) viewAt.value = null;
  const committed = s.committed();
  const past = viewAt.value !== null ? committed[viewAt.value]?.state : null;
  const shown =
    past ??
    (view && (view.kind === "question" || view.kind === "closed")
      ? view.kind === "closed"
        ? view.state
        : s.current()
      : s.current());

  // the engine's patina for the shown document
  const shownJson = canonical(shown);
  useEffect(() => {
    let live = true;
    void engine().then((eng) => {
      if (live) patina.value = new Map(eng.patina(shownJson).map(([x, y, n]) => [`${x},${y}`, n]));
    });
    return () => {
      live = false;
    };
  }, [shownJson]);

  // map overlay: the open question's candidates
  const overlay: MapOverlay | null = useMemo(() => {
    if (view?.kind !== "question" || view.question.kind !== "pick") return null;
    return {
      units: questionUnits(view.question),
      panels: questionPanels(view.question),
      active: null,
    };
  }, [view]);

  // the age's numbered steps (guided closed + proposal review)
  const workMarks = useMemo(() => {
    if (!view) return null;
    const units = new Map<string, number[]>();
    const panels = new Map<string, number[]>();
    const add = (m: Map<string, number[]>, k: string, n: number) => {
      const at = m.get(k);
      if (at) {
        if (!at.includes(n)) at.push(n);
      } else m.set(k, [n]);
    };
    for (const e of view.events as JmEvent[]) {
      const step = e.payload.step as number | undefined;
      if (!step) continue;
      if (e.unit) add(units, `${e.unit[0]},${e.unit[1]}`, step);
      else if (e.panel) add(panels, `${e.panel[0]},${e.panel[1]}`, step);
    }
    return units.size || panels.size ? { units, panels } : null;
  }, [view]);

  const t = shown.time;
  // the panel on show: the OPEN age's own panel (its header names it), else
  // the next age's working panel — the front of the Stack
  const ageHeader = view?.events.find((e) => e.kind === "age_start");
  const workingPanel: [number, number] | null = ageHeader
    ? (ageHeader.panel ??
      (view!.events.find((e) => e.kind === "new_panel")?.panel ?? null))
    : (s.current().world.stack[0] ?? null);
  const needs = s.spreadNeeds();
  const glanceOk = s.glanceDone || s.open !== null;
  const beyond = beyondSpread.value;

  return (
    <main class="helper" data-testid="helper-world">
      <section class="card helper-head">
        <button class="ghost" data-testid="btn-back" onClick={() => { closeWorld(); go("#/helper"); }}>
          ← {STRINGS.hpTitle}
        </button>
        <h2 data-testid="world-name">{meta.name}</h2>
        <span class="chip" data-testid="chip-era">
          {STRINGS.hpEra} {t.era} · {STRINGS.hpAge} {t.age_in_era}
        </span>
        <span class="chip" data-testid="chip-cycle">
          {s.remaining().reduce((n, c) => n + c.count, 0)} {STRINGS.hpCycle}
        </span>
        <span class="row">
          <button class="ghost" data-testid="btn-export" onClick={() => void exportActive()}>
            {STRINGS.hpExport}
          </button>
          <button class="ghost" data-testid="btn-edit-map"
            onClick={() => (editing.value = { panel: workingPanel ?? [1, 1], preselect: null })}>
            {STRINGS.hpEditMap}
          </button>
          {!s.open && (
            <button class="ghost" data-testid="btn-catchup" onClick={() => (showCatchup.value = true)}>
              {STRINGS.hpCatchupTitle}
            </button>
          )}
        </span>
      </section>

      {notice.value && (
        <div class="card notice" role="status" data-testid="helper-notice">
          <span>{notice.value}</span>
          <button class="ghost" onClick={() => (notice.value = null)}>{STRINGS.dismiss}</button>
        </div>
      )}
      {readOnly.value && (
        <div class="card notice" data-testid="readonly-notice">
          <span>
            {STRINGS.hpForeignNotice
              .replace("{theirs}", meta.lineage)
              .replace("{ours}", "this engine's")}
          </span>
        </div>
      )}

      <section class="card">
        <HelperMap
          world={shown}
          patina={patina.value}
          highlight={workingPanel}
          overlay={overlay}
          workMarks={workMarks}
          onPickCandidate={(i) => void answer(i, "player")}
          onTapUnit={(u) => {
            if (view?.kind === "question") return;
            const geo = geoOf(shown);
            const xi = Math.floor(u[0] / geo.w);
            const yi = Math.floor(u[1] / geo.h);
            const panel: [number, number] = [xi >= 0 ? xi + 1 : xi, yi >= 0 ? -(yi + 1) : -yi];
            if (shown.world.panels.some(([tx, ty]) => tx === panel[0] && ty === panel[1]))
              editing.value = { panel, preselect: u };
          }}
        />
      </section>

      {!s.open && !view && committed.length > 1 && (
        <section class="card record-scrubber" data-testid="record-scrubber">
          <span class="legend-label">{STRINGS.hpLogTitle}</span>
          <input
            type="range"
            min={0}
            max={committed.length - 1}
            value={viewAt.value ?? committed.length - 1}
            data-testid="scrub-range"
            onInput={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              viewAt.value = v >= committed.length - 1 ? null : v;
            }}
          />
          {viewAt.value !== null && (
            <span class="chip" data-testid="scrub-chip">
              {STRINGS.hpEra} {committed[viewAt.value].state.time.era} ·{" "}
              {STRINGS.hpAge} {committed[viewAt.value].state.time.age_in_era}
            </span>
          )}
        </section>
      )}

      {beyond.length > 0 && (
        <section class="card notice" data-testid="beyond-spread">
          <span>
            {STRINGS.hpBeyondSpread.replace(
              "{name}",
              beyond.map(([tx, ty]) => panelName(tx, ty)).join(", "),
            )}
          </span>
          <span class="row">
            <button data-testid="beyond-enter"
              onClick={() => (editing.value = { panel: beyond[0], preselect: null })}>
              {STRINGS.hpEnterNow}
            </button>
            <button class="ghost" data-testid="beyond-paper"
              onClick={() => {
                void abandonAge().then(() => (showCatchup.value = true));
              }}>
              {STRINGS.hpFinishOnPaper}
            </button>
          </span>
        </section>
      )}

      {viewAt.value !== null ? null : editing.value ? (
        <PaintEditor
          world={s.current()}
          panel={editing.value.panel}
          preselect={editing.value.preselect}
          onSave={(edits) => {
            const panel = editing.value!.panel;
            editing.value = null;
            void (edits.length ? addOverride(edits, STRINGS.hpOverrideNote) : Promise.resolve()).then(
              () => void markEntered(panel),
            );
          }}
          onCancel={() => (editing.value = null)}
        />
      ) : showCatchup.value ? (
        <CatchupCard
          onClose={() => (showCatchup.value = false)}
          config={s.current().config}
          era={s.current().time.era}
        />
      ) : (
        <AgeFlow
          s={s}
          mode={meta.modePref}
          readOnly={readOnly.value}
          glanceOk={glanceOk}
          onGlanceOk={() => void confirmGlance()}
          missingSpread={needs.missing}
          onEnterPanel={(panel) => (editing.value = { panel, preselect: null })}
        />
      )}
    </main>
  );
}

export function HelperScreen(props: { route: Route }) {
  const r = props.route;
  if (r.screen === "helper-world") return <WorldScreen id={r.id} />;
  return <WorldList />;
}
