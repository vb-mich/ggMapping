// The Helper's screen state: signals over the session and the storage layer.
// The engine loads lazily on this thread — helper turns are single-age
// replays, milliseconds, nothing the worker must carry. Every failure path
// lands in `notice` as a sentence, never an abort.
import { signal } from "@preact/signals";

import { Engine } from "../engine/api";
import { STRINGS } from "../strings";
import type { JmConfig } from "../contracts/schema";
import {
  HelperError,
  buildPaperState,
  exportWorld,
  verifyImport,
  type DeckAnswer,
  type PaperEntry,
  type ReplayedEntry,
} from "./core";
import { HelperSession, type AgeView } from "./session";
import * as db from "./db";
import type {
  HelperExport,
  HelperWorldMeta,
  OverrideEdit,
  RowSource,
  StoredEntry,
} from "./schema";

// --- the engine (lazy, main thread) -----------------------------------------

let enginePromise: Promise<Engine> | null = null;
export const engine = (): Promise<Engine> => (enginePromise ??= Engine.load());

export const engineLineage = signal("");

// --- screen state -----------------------------------------------------------

export const worlds = signal<HelperWorldMeta[]>([]);
export const notice = signal<string | null>(null);
export const busy = signal(false);
export const storeDead = signal(false);

export const activeMeta = signal<HelperWorldMeta | null>(null);
// Foreign-lineage records open read-only under the standing notice.
export const readOnly = signal(false);
// Bumped after every session mutation; screens read it to re-derive.
export const bump = signal(0);
// Panels beyond the Spread the current view reached into (paper worlds).
export const beyondSpread = signal<[number, number][]>([]);

let session: HelperSession | null = null;
export const sessionOf = (): HelperSession | null => session;

function fail(e: unknown): void {
  if (e instanceof db.HelperStoreError && e.kind === "unavailable") {
    storeDead.value = true;
    notice.value = STRINGS.hpNoStore;
  } else if (e instanceof db.HelperStoreError && e.kind === "quota") {
    notice.value = STRINGS.hpQuotaFull;
  } else if (e instanceof HelperError) {
    notice.value = e.message;
  } else {
    notice.value = STRINGS.hpFailed.replace("{message}", (e as Error)?.message ?? String(e));
  }
}

export async function refreshWorlds(): Promise<void> {
  try {
    worlds.value = await db.listWorlds();
    const eng = await engine();
    engineLineage.value = eng.lineage();
  } catch (e) {
    fail(e);
  }
}

// --- persistence bridge -----------------------------------------------------

// After a session mutation: write the meta and every entry row whose object
// identity changed (the session updates immutably, so identity is the diff).
let lastPersisted: { entries: unknown[]; states: ReplayedEntry[] } = {
  entries: [],
  states: [],
};

async function persist(): Promise<void> {
  const meta = activeMeta.value;
  if (!meta || !session) return;
  const data = session.data();
  const states = session.committed();
  const next: HelperWorldMeta = {
    ...meta,
    origin: data.origin,
    rngState: data.rngState,
    entered: data.entered,
    open: data.open,
  };
  activeMeta.value = next;
  try {
    await db.putWorld(next);
    let from = 0;
    while (
      from < lastPersisted.entries.length &&
      from < data.entries.length &&
      lastPersisted.entries[from] === data.entries[from]
    )
      from++;
    if (from < data.entries.length || lastPersisted.entries.length > data.entries.length) {
      const rows: StoredEntry[] = [];
      for (let i = from; i < data.entries.length; i++)
        rows.push({
          worldId: meta.id,
          seq: i,
          entry: data.entries[i],
          state: states[i].state,
          events: states[i].events,
        });
      await db.putEntriesFrom(meta.id, from, rows);
    }
    lastPersisted = { entries: data.entries.slice(), states };
  } catch (e) {
    fail(e);
  }
}

// Wrap a session operation: run, auto-answer shuffles, persist, notify.
async function op<T>(f: () => T): Promise<T | null> {
  if (!session) return null;
  if (readOnly.value) {
    notice.value = STRINGS.hpReadOnly;
    return null;
  }
  try {
    const out = f();
    // a cycle completing mid-age asks for the deck's next order; that answer
    // is the Helper's own (a provisional permutation, revealed by play)
    while (session.view?.kind === "question" && session.view.question.kind === "shuffle")
      session.autoAnswer();
    beyondSpread.value = session.beyondSpread();
    bump.value++;
    await persist();
    return out;
  } catch (e) {
    fail(e);
    bump.value++;
    return null;
  }
}

// --- worlds: create, open, close, delete, export, import --------------------

async function storeNewWorld(
  name: string,
  data: ReturnType<HelperSession["data"]>,
  states: ReplayedEntry[],
  lineage: string,
): Promise<HelperWorldMeta> {
  const meta: HelperWorldMeta = {
    id: db.newId(),
    name: name.trim() || STRINGS.hpDefaultName,
    created: Date.now(),
    updated: Date.now(),
    lineage,
    origin: data.origin,
    modePref: "guided",
    rngState: data.rngState,
    entered: data.entered,
    open: data.open,
    sync: "local",
  };
  await db.putWorld(meta);
  await db.putEntriesFrom(
    meta.id,
    0,
    data.entries.map((entry, seq) => ({
      worldId: meta.id,
      seq,
      entry,
      state: states[seq].state,
      events: states[seq].events,
    })),
  );
  return meta;
}

export async function createBlank(
  name: string,
  config: JmConfig,
  seed: number,
): Promise<string | null> {
  busy.value = true;
  try {
    const eng = await engine();
    const { data } = HelperSession.createBlank(eng, config, seed, 100000, eng.rngSeed(seed));
    const s = new HelperSession(eng, data);
    const meta = await storeNewWorld(name, s.data(), s.committed(), eng.lineage());
    await refreshWorlds();
    return meta.id;
  } catch (e) {
    fail(e);
    return null;
  } finally {
    busy.value = false;
  }
}

export async function createFork(
  name: string,
  config: JmConfig,
  seed: number,
  eras: number,
  ages: number,
): Promise<string | null> {
  busy.value = true;
  try {
    const eng = await engine();
    const { data } = HelperSession.createFork(
      eng,
      config,
      seed,
      eras,
      ages,
      eng.rngSeed(seed * 31 + ages),
    );
    const s = new HelperSession(eng, data);
    const meta = await storeNewWorld(name, s.data(), s.committed(), eng.lineage());
    await refreshWorlds();
    return meta.id;
  } catch (e) {
    fail(e);
    return null;
  } finally {
    busy.value = false;
  }
}

export async function createPaper(name: string, entry: PaperEntry): Promise<string | null> {
  busy.value = true;
  try {
    const eng = await engine();
    const seedish = Date.now() % 10_000_000;
    const { state, rngState } = buildPaperState(eng, eng.lineage(), entry, eng.rngSeed(seedish));
    const s = new HelperSession(eng, {
      origin: { type: "paper", state },
      entries: [],
      rngState,
      entered: [], // nothing is detailed yet; the skeleton is belief only
      open: null,
    });
    const meta = await storeNewWorld(name, s.data(), s.committed(), eng.lineage());
    await refreshWorlds();
    return meta.id;
  } catch (e) {
    fail(e);
    return null;
  } finally {
    busy.value = false;
  }
}

export async function openWorld(id: string): Promise<boolean> {
  busy.value = true;
  try {
    const eng = await engine();
    const meta = await db.getWorld(id);
    if (!meta) {
      notice.value = STRINGS.hpNoSuchWorld;
      return false;
    }
    readOnly.value = meta.lineage !== eng.lineage();
    const rows = await db.loadEntries(id);
    const data = {
      origin: meta.origin,
      entries: rows.map((r) => r.entry),
      rngState: meta.rngState,
      entered: meta.entered,
      open: readOnly.value ? null : meta.open,
    };
    const cached: ReplayedEntry[] = rows.map((r) => ({
      entry: r.entry,
      state: r.state,
      events: r.events,
    }));
    session = readOnly.value
      ? new HelperSession(eng, { ...data, open: null }, cached)
      : new HelperSession(eng, data, cached);
    activeMeta.value = meta;
    lastPersisted = { entries: data.entries.slice(), states: session.committed() };
    beyondSpread.value = session.beyondSpread();
    bump.value++;
    return true;
  } catch (e) {
    fail(e);
    return false;
  } finally {
    busy.value = false;
  }
}

export function closeWorld(): void {
  session = null;
  activeMeta.value = null;
  readOnly.value = false;
  beyondSpread.value = [];
  bump.value++;
}

export async function removeWorld(id: string): Promise<void> {
  try {
    await db.deleteWorld(id);
    if (activeMeta.value?.id === id) closeWorld();
    await refreshWorlds();
  } catch (e) {
    fail(e);
  }
}

export async function renameWorld(id: string, name: string): Promise<void> {
  try {
    const meta = await db.getWorld(id);
    if (!meta) return;
    await db.putWorld({ ...meta, name: name.trim() || meta.name });
    if (activeMeta.value?.id === id) activeMeta.value = { ...meta, name: name.trim() };
    await refreshWorlds();
  } catch (e) {
    fail(e);
  }
}

export async function setModePref(mode: "guided" | "proposal"): Promise<void> {
  const meta = activeMeta.value;
  if (!meta) return;
  const next = { ...meta, modePref: mode };
  activeMeta.value = next;
  try {
    await db.putWorld(next);
  } catch (e) {
    fail(e);
  }
}

export async function exportActive(): Promise<void> {
  const meta = activeMeta.value;
  if (!meta || !session) return;
  const data = session.data();
  const file = exportWorld({
    name: meta.name,
    lineage: meta.lineage,
    origin: data.origin,
    modePref: meta.modePref,
    rngState: data.rngState,
    entered: data.entered,
    open: data.open,
    entries: data.entries,
  });
  const { download } = await import("../ui/download");
  const safe = meta.name.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "world";
  download(
    `${safe} - helper world.json`,
    new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }),
  );
}

// Import verifies by replaying the whole record; a foreign lineage skips the
// replay (this engine cannot speak it) and lands read-only under the notice.
export async function importFile(text: string): Promise<string | null> {
  busy.value = true;
  try {
    const eng = await engine();
    let file: HelperExport;
    try {
      file = JSON.parse(text) as HelperExport;
    } catch {
      notice.value = STRINGS.hpImportBad;
      return null;
    }
    if (file.file !== "jm-helper-world" || file.version !== 1) {
      notice.value = STRINGS.hpImportBad;
      return null;
    }
    const foreign = file.lineage !== eng.lineage();
    let states: ReplayedEntry[] = [];
    if (!foreign) states = verifyImport(eng, file);
    const meta: HelperWorldMeta = {
      id: db.newId(),
      name: file.name || STRINGS.hpDefaultName,
      created: Date.now(),
      updated: Date.now(),
      lineage: file.lineage,
      origin: file.origin,
      modePref: file.modePref ?? "guided",
      rngState: file.rngState,
      entered: file.entered,
      open: file.open,
      sync: "local",
    };
    await db.putWorld(meta);
    if (!foreign)
      await db.putEntriesFrom(
        meta.id,
        0,
        file.entries.map((entry, seq) => ({
          worldId: meta.id,
          seq,
          entry,
          state: states[seq].state,
          events: states[seq].events,
        })),
      );
    if (foreign)
      notice.value = STRINGS.hpForeignNotice
        .replace("{theirs}", file.lineage)
        .replace("{ours}", eng.lineage());
    await refreshWorlds();
    return meta.id;
  } catch (e) {
    fail(e);
    return null;
  } finally {
    busy.value = false;
  }
}

// --- play operations --------------------------------------------------------

export const beginAge = (card: { kind: string; work: number }, mode: "guided" | "proposal") =>
  op(() => session!.beginAge(card, mode));
export const drawForMe = (mode: "guided" | "proposal") => op(() => session!.drawForMe(mode));
export const answer = (result: number | boolean | number[], source: RowSource) =>
  op(() => session!.answer(result, source));
export const rollForMe = () => op(() => session!.autoAnswer());
export const undo = () => op(() => session!.undo());
export const commitAge = () => op(() => session!.commitAge());
export const reopenLast = () => op(() => session!.reopenLast());
export const takeover = (i: number) => op(() => session!.takeover(i));
export const acceptProposal = () => op(() => session!.acceptProposal());
export const addOverride = (edits: OverrideEdit[], note?: string) =>
  op(() => session!.addOverride(edits, note));
export const addCatchup = (ages: number, deck: DeckAnswer, note?: string) =>
  op(() => session!.addCatchup(ages, deck, note));
export const markEntered = (panel: [number, number]) => op(() => session!.markEntered(panel));
export const abandonAge = () => op(() => session!.abandonAge());

// The deck's printed cards for a config (engine-derived; skeleton and
// catch-up flows list them).
export async function deckPrintsFor(config: JmConfig) {
  const eng = await engine();
  const { deckPrints } = await import("./core");
  return deckPrints(eng, config);
}

export type { AgeView };
