// My map's screen state: signals over the storage layer. Every failure path
// lands in `notice` as a sentence, never an abort — the error-path culture
// applies to this screen from birth.
import { signal } from "@preact/signals";

import { STRINGS } from "../strings";
import * as db from "./db";

export const maps = signal<db.MapRecord[]>([]);
export const activeMap = signal<db.MapRecord | null>(null);
// Every scan of the current map, oldest first (the storage layer's order).
export const scans = signal<db.ScanMeta[]>([]);
// The atlas: each scanned panel's newest scan, keyed "tx,ty".
export const atlas = signal<Map<string, db.ScanMeta>>(new Map());
export const facts = signal<db.StorageFacts | null>(null);
// One graceful notice at a time; null when all is well.
export const notice = signal<string | null>(null);
// True when IndexedDB itself is unusable (some private-browsing modes).
export const storeDead = signal(false);
// Set before navigating to the scan flow to preselect a coordinate.
export const presetCoord = signal<{ tx: number; ty: number } | null>(null);

function fail(e: unknown): void {
  if (e instanceof db.StoreError && e.kind === "unavailable") {
    storeDead.value = true;
    notice.value = STRINGS.mmNoStore;
  } else if (e instanceof db.StoreError && e.kind === "quota") {
    notice.value = STRINGS.mmQuotaFull;
  } else {
    notice.value = STRINGS.mmStoreFailed.replace(
      "{message}",
      (e as Error)?.message ?? String(e),
    );
  }
}

export async function refresh(): Promise<void> {
  try {
    const m = await db.currentMap(STRINGS.mmDefaultMapName);
    activeMap.value = m;
    maps.value = await db.listMaps();
    scans.value = await db.listScans(m.id);
    atlas.value = await db.latestPerPanel(m.id);
    facts.value = await db.storageFacts();
    storeDead.value = false;
  } catch (e) {
    fail(e);
  }
}

export async function switchMap(id: string): Promise<void> {
  try {
    await db.setCurrentMap(id);
  } catch (e) {
    fail(e);
  }
  await refresh();
}

export async function newMap(name: string): Promise<void> {
  try {
    await db.createMap(name || STRINGS.mmDefaultMapName);
  } catch (e) {
    fail(e);
  }
  await refresh();
}

export interface SaveArgs {
  tx: number;
  ty: number;
  note: string;
  mime: string;
  width: number;
  height: number;
  image: Blob;
  thumb: Blob;
}

// Save one scan; on the archive's first save ask the browser for persistent
// storage and let the footer surface the answer. Returns false on failure
// (the notice explains).
export async function saveScan(args: SaveArgs): Promise<boolean> {
  const m = activeMap.value;
  if (!m) return false;
  try {
    await db.addScan({ ...args, mapId: m.id });
    await db.requestPersistence();
  } catch (e) {
    fail(e);
    return false;
  }
  await refresh();
  return true;
}

export async function removeScan(id: string): Promise<boolean> {
  try {
    await db.deleteScan(id);
  } catch (e) {
    fail(e);
    return false;
  }
  await refresh();
  return true;
}

export function versionsOf(tx: number, ty: number): db.ScanMeta[] {
  return scans.value
    .filter((s) => s.tx === tx && s.ty === ty)
    .sort((a, b) => b.created - a.created);
}

export function fmtBytes(n: number): string {
  if (n <= 0) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
