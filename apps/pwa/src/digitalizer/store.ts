// My map's screen state: signals over the storage layer. Every failure path
// lands in `notice` as a sentence, never an abort — the error-path culture
// applies to this screen from birth.
import { computed, signal } from "@preact/signals";

import { STRINGS } from "../strings";
import * as db from "./db";

export const maps = signal<db.MapRecord[]>([]);
export const activeMap = signal<db.MapRecord | null>(null);
// Every scan of the current map, oldest first (the storage layer's order).
export const scans = signal<db.ScanMeta[]>([]);
// The timeline position: an epoch-ms moment, or null for now. The map at
// that moment is DERIVED, never stored (db.mapAt).
export const timelineT = signal<number | null>(null);
// The named moments of the current map's timeline.
export const bookmarks = signal<db.BookmarkRecord[]>([]);
// The atlas: each panel's newest scan AT THE TIMELINE POSITION, keyed
// "tx,ty" — scrubbing the timeline repaints this derivation.
export const atlas = computed<Map<string, db.ScanMeta>>(() =>
  db.mapAt(scans.value, timelineT.value),
);
// The bookmark the timeline is standing on exactly, if any.
export const standingBookmark = computed<db.BookmarkRecord | null>(
  () => bookmarks.value.find((b) => timelineT.value !== null && b.at === timelineT.value) ?? null,
);
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
    bookmarks.value = await db.listBookmarks(m.id);
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
  timelineT.value = null; // another map, another timeline
  await refresh();
}

export async function newMap(name: string): Promise<void> {
  try {
    await db.createMap(name || STRINGS.mmDefaultMapName);
  } catch (e) {
    fail(e);
  }
  timelineT.value = null;
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
  // a fresh scan lands at now — snap the timeline there so it is visible
  timelineT.value = null;
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

// The one after-save edit a scan allows: its note.
export async function editNote(id: string, note: string): Promise<boolean> {
  try {
    await db.updateScanNote(id, note.trim());
  } catch (e) {
    fail(e);
    return false;
  }
  await refresh();
  return true;
}

// --- the timeline's named moments -------------------------------------------

export async function markMoment(name: string): Promise<void> {
  const m = activeMap.value;
  if (!m) return;
  const at = timelineT.value ?? Date.now();
  try {
    await db.addBookmark(m.id, name || new Date(at).toLocaleString(), at);
    bookmarks.value = await db.listBookmarks(m.id);
  } catch (e) {
    fail(e);
  }
}

export async function removeBookmark(id: string): Promise<void> {
  const m = activeMap.value;
  if (!m) return;
  try {
    await db.deleteBookmark(id); // a name goes; every scan stays
    bookmarks.value = await db.listBookmarks(m.id);
  } catch (e) {
    fail(e);
  }
}

export function seekBookmark(b: db.BookmarkRecord): void {
  timelineT.value = b.at;
}

// --- the archive (backup before act two) -------------------------------------

export async function backupArchive(scope: "current" | "all"): Promise<boolean> {
  const m = activeMap.value;
  if (!m) return false;
  const ids = scope === "current" ? [m.id] : maps.value.map((x) => x.id);
  try {
    const { manifest, files } = await db.exportArchive(ids);
    const { buildZip } = await import("./zip");
    const entries = [
      {
        name: "manifest.json",
        data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      },
    ];
    for (const f of files) {
      entries.push({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) });
    }
    const zip = buildZip(entries);
    const base = scope === "current" ? safeFileName(m.name) : "all maps";
    const { download } = await import("../ui/download");
    download(`${base} - backup.zip`, new Blob([zip as BlobPart], { type: "application/zip" }));
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

const extMime = (name: string) =>
  name.endsWith(".webp") ? "image/webp" : name.endsWith(".jpg") ? "image/jpeg" : "application/octet-stream";

export async function restoreArchiveFile(file: File): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { parseZip } = await import("./zip");
    const entries = await parseZip(bytes);
    const manifestBytes = entries.get("manifest.json");
    if (!manifestBytes) throw new Error("no manifest inside");
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    const blobs = new Map<string, Blob>();
    for (const [name, data] of entries) {
      if (name === "manifest.json") continue;
      blobs.set(name, new Blob([data as BlobPart], { type: extMime(name) }));
    }
    const summary = await db.restoreArchive(manifest, blobs);
    timelineT.value = null;
    await refresh();
    notice.value = STRINGS.mmRestored
      .replace("{maps}", String(summary.maps))
      .replace("{scans}", String(summary.scans));
    return true;
  } catch (e) {
    // one graceful sentence, whatever broke: zip, JSON, manifest, storage
    notice.value = STRINGS.mmArchiveBad.replace(
      "{message}",
      (e as Error)?.message ?? String(e),
    );
    return false;
  }
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "map";
}

export function fmtBytes(n: number): string {
  if (n <= 0) return "0 KB";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
