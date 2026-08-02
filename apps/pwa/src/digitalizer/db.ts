// The scan archive: IndexedDB, Blobs stored natively — never localStorage,
// never base64. This module is the storage interface act two builds on: every
// mutation of the archive goes through here and nowhere else, every scan has a
// local id and a sync status, and the (empty, act-one) outbox store is where a
// future sync layer will queue mutations. Swapping "local-only" for "synced"
// must not change a caller.
//
// Act two provisions, deliberately present now:
//   * ScanRecord.sync — always "local" in act one; a sync layer will move it
//     through "queued" → "sent" without touching callers.
//   * the `outbox` store — act one never writes it; act two enqueues every
//     mutation {op, scanId, at} here and drains it against the backend.
//   * maps — a player will hold several maps under one account; every scan
//     already belongs to exactly one map.

export type SyncStatus = "local"; // act two widens this union

export interface MapRecord {
  id: string;
  name: string;
  created: number; // epoch ms
}

export interface ScanRecord {
  id: string; // local id, minted here — act two maps it to a remote id
  mapId: string;
  tx: number; // panel coordinate, CONTRACTS §2.1 (no zero row or column)
  ty: number;
  created: number; // epoch ms; versions of a panel order by this, newest first
  note: string;
  sync: SyncStatus;
  mime: string; // image/webp or image/jpeg
  width: number; // rectified pixels
  height: number;
  bytes: number; // image blob size, for the storage line
  image: Blob;
  thumb: Blob;
}

// Everything but the full image — what lists and the atlas need.
export type ScanMeta = Omit<ScanRecord, "image">;

export type StoreFailure = "unavailable" | "quota" | "failure";

export class StoreError extends Error {
  kind: StoreFailure;
  constructor(kind: StoreFailure, message: string) {
    super(message);
    this.kind = kind;
  }
}

const DB_NAME = "jm-digitalizer";
// v2: the bookmarks store — a bookmark is a NAME on a timestamp, nothing
// more; deleting one deletes a name, never a scan.
const DB_VERSION = 2;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new StoreError("unavailable", "IndexedDB is not available"));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new StoreError("unavailable", String(e)));
      return;
    }
    req.onupgradeneeded = () => {
      // guarded creates: this runs for fresh databases AND for v1 devices
      // upgrading in place — their scans must come through untouched
      const db = req.result;
      if (!db.objectStoreNames.contains("maps")) {
        db.createObjectStore("maps", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("scans")) {
        const scans = db.createObjectStore("scans", { keyPath: "id" });
        scans.createIndex("byMap", "mapId");
        scans.createIndex("byPanel", ["mapId", "tx", "ty"]);
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("bookmarks")) {
        const bm = db.createObjectStore("bookmarks", { keyPath: "id" });
        bm.createIndex("byMap", "mapId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new StoreError("unavailable", req.error?.message ?? "open failed"));
    req.onblocked = () =>
      reject(new StoreError("unavailable", "the archive is open elsewhere"));
  });
  dbPromise.catch(() => (dbPromise = null)); // allow a later retry
  return dbPromise;
}

// Wrap one transaction; translate QuotaExceededError into a typed failure.
function tx<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let result: T;
        Promise.resolve(run(t)).then(
          (r) => (result = r),
          (e) => {
            try {
              t.abort();
            } catch {
              /* already done */
            }
            reject(wrap(e));
          },
        );
        t.oncomplete = () => resolve(result);
        t.onabort = () => reject(wrap(t.error));
        t.onerror = () => reject(wrap(t.error));
      }),
  );
}

function wrap(e: unknown): StoreError {
  if (e instanceof StoreError) return e;
  const name = (e as DOMException)?.name ?? "";
  const msg = (e as Error)?.message ?? String(e);
  if (name === "QuotaExceededError") return new StoreError("quota", msg);
  return new StoreError("failure", msg || "storage failed");
}

function reqAsPromise<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- maps -------------------------------------------------------------------

export function listMaps(): Promise<MapRecord[]> {
  return tx("maps", "readonly", async (t) => {
    const all = (await reqAsPromise(t.objectStore("maps").getAll())) as MapRecord[];
    return all.sort((a, b) => a.created - b.created);
  });
}

export function createMap(name: string): Promise<MapRecord> {
  const rec: MapRecord = { id: newId(), name: name.trim(), created: Date.now() };
  return tx(["maps", "settings"], "readwrite", (t) => {
    t.objectStore("maps").add(rec);
    t.objectStore("settings").put({ key: "currentMapId", value: rec.id });
    return rec;
  });
}

// The current map, creating the default one on first use.
export function currentMap(defaultName: string): Promise<MapRecord> {
  return tx(["maps", "settings"], "readwrite", async (t) => {
    const settings = t.objectStore("settings");
    const maps = t.objectStore("maps");
    const cur = (await reqAsPromise(settings.get("currentMapId"))) as
      | { key: string; value: string }
      | undefined;
    if (cur) {
      const m = (await reqAsPromise(maps.get(cur.value))) as MapRecord | undefined;
      if (m) return m;
    }
    const existing = (await reqAsPromise(maps.getAll())) as MapRecord[];
    if (existing.length) {
      const first = existing.sort((a, b) => a.created - b.created)[0];
      settings.put({ key: "currentMapId", value: first.id });
      return first;
    }
    const rec: MapRecord = { id: newId(), name: defaultName, created: Date.now() };
    maps.add(rec);
    settings.put({ key: "currentMapId", value: rec.id });
    return rec;
  });
}

export function setCurrentMap(id: string): Promise<void> {
  return tx("settings", "readwrite", (t) => {
    t.objectStore("settings").put({ key: "currentMapId", value: id });
  });
}

export function renameMap(id: string, name: string): Promise<void> {
  return tx("maps", "readwrite", async (t) => {
    const store = t.objectStore("maps");
    const rec = (await reqAsPromise(store.get(id))) as MapRecord | undefined;
    if (!rec) throw new StoreError("failure", "no such map");
    rec.name = name.trim();
    store.put(rec);
  });
}

// Delete a map WITH everything it holds — scans and bookmarks — in one
// transaction. Local and final, like every deletion in act one.
export function deleteMap(id: string): Promise<void> {
  return tx(["maps", "scans", "bookmarks", "settings"], "readwrite", async (t) => {
    t.objectStore("maps").delete(id);
    const scanKeys = (await reqAsPromise(
      t.objectStore("scans").index("byMap").getAllKeys(id),
    )) as IDBValidKey[];
    for (const k of scanKeys) t.objectStore("scans").delete(k);
    const bmKeys = (await reqAsPromise(
      t.objectStore("bookmarks").index("byMap").getAllKeys(id),
    )) as IDBValidKey[];
    for (const k of bmKeys) t.objectStore("bookmarks").delete(k);
    const cur = (await reqAsPromise(t.objectStore("settings").get("currentMapId"))) as
      | { key: string; value: string }
      | undefined;
    if (cur?.value === id) t.objectStore("settings").delete("currentMapId");
  });
}

// Scan counts per map, for the management page.
export function scanCounts(): Promise<Map<string, number>> {
  return tx("scans", "readonly", async (t) => {
    const all = (await reqAsPromise(t.objectStore("scans").getAll())) as ScanRecord[];
    const out = new Map<string, number>();
    for (const s of all) out.set(s.mapId, (out.get(s.mapId) ?? 0) + 1);
    return out;
  });
}

// --- app settings (the profile's knobs) --------------------------------------

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rec = await tx("settings", "readonly", (t) =>
    reqAsPromise(t.objectStore("settings").get(key)),
  );
  return rec ? ((rec as { value: T }).value ?? fallback) : fallback;
}

export function putSetting<T>(key: string, value: T): Promise<void> {
  return tx("settings", "readwrite", (t) => {
    t.objectStore("settings").put({ key, value });
  });
}

// --- scans ------------------------------------------------------------------

export interface NewScan {
  mapId: string;
  tx: number;
  ty: number;
  note: string;
  mime: string;
  width: number;
  height: number;
  image: Blob;
  thumb: Blob;
}

export function addScan(s: NewScan): Promise<ScanRecord> {
  const rec: ScanRecord = {
    id: newId(),
    created: Date.now(),
    sync: "local",
    bytes: s.image.size,
    ...s,
  };
  return tx("scans", "readwrite", (t) => {
    t.objectStore("scans").add(rec);
    return rec;
  });
}

const stripImage = ({ image: _image, ...meta }: ScanRecord): ScanMeta => meta;

export function listScans(mapId: string): Promise<ScanMeta[]> {
  return tx("scans", "readonly", async (t) => {
    const all = (await reqAsPromise(
      t.objectStore("scans").index("byMap").getAll(mapId),
    )) as ScanRecord[];
    return all.map(stripImage).sort((a, b) => a.created - b.created);
  });
}

// Versions of one panel, newest first.
export function listVersions(mapId: string, ptx: number, pty: number): Promise<ScanMeta[]> {
  return tx("scans", "readonly", async (t) => {
    const all = (await reqAsPromise(
      t.objectStore("scans").index("byPanel").getAll([mapId, ptx, pty]),
    )) as ScanRecord[];
    return all.map(stripImage).sort((a, b) => b.created - a.created);
  });
}

// THE TIMELINE RULE — the map at time T is DERIVED, never stored: for each
// panel, the newest scan with created <= at. `at: null` means now (no upper
// bound). Pure over metadata, so the unit suite owns it.
export function mapAt(scans: ScanMeta[], at: number | null): Map<string, ScanMeta> {
  const out = new Map<string, ScanMeta>();
  for (const s of scans) {
    if (at !== null && s.created > at) continue;
    const key = `${s.tx},${s.ty}`;
    const seen = out.get(key);
    if (!seen || s.created > seen.created) out.set(key, s);
  }
  return out;
}

// The atlas: each panel's newest scan.
export function latestPerPanel(mapId: string): Promise<Map<string, ScanMeta>> {
  return listScans(mapId).then((all) => mapAt(all, null));
}

// THE TIMELINE'S STOPS: one per update, equally spaced on the bar — the bar
// walks the map's history by its actual updates, never by wall-clock
// distance. Pure, like the rule they serve.
export function timelineStops(scans: ScanMeta[]): number[] {
  return [...new Set(scans.map((s) => s.created))].sort((a, b) => a - b);
}

// The stop index a moment falls on: the last stop not younger than T
// (T null = now = the final stop). A T before the first stop clamps to 0.
export function stopIndexAt(stops: number[], at: number | null): number {
  if (!stops.length) return 0;
  if (at === null) return stops.length - 1;
  let idx = 0;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i] <= at) idx = i;
    else break;
  }
  return idx;
}

// The one after-save mutation a scan allows: its note.
export function updateScanNote(id: string, note: string): Promise<void> {
  return tx("scans", "readwrite", async (t) => {
    const store = t.objectStore("scans");
    const rec = (await reqAsPromise(store.get(id))) as ScanRecord | undefined;
    if (!rec) throw new StoreError("failure", "no such scan");
    rec.note = note;
    store.put(rec);
  });
}

export function getScan(id: string): Promise<ScanRecord | undefined> {
  return tx("scans", "readonly", (t) =>
    reqAsPromise(t.objectStore("scans").get(id) as IDBRequest<ScanRecord | undefined>),
  );
}

// Local and final in act one: no tombstone, nothing to reconcile. (Act two:
// enqueue a delete op in the outbox in the same transaction.)
export function deleteScan(id: string): Promise<void> {
  return tx("scans", "readwrite", (t) => {
    t.objectStore("scans").delete(id);
  });
}

// --- storage facts ----------------------------------------------------------

export interface StorageFacts {
  scans: number;
  bytes: number; // sum of stored image sizes (thumbs excluded: noise)
  persisted: boolean | null; // null: never asked / not answerable
}

export function storageFacts(): Promise<StorageFacts> {
  return tx(["scans", "settings"], "readonly", async (t) => {
    const all = (await reqAsPromise(t.objectStore("scans").getAll())) as ScanRecord[];
    const persisted = (await reqAsPromise(t.objectStore("settings").get("persisted"))) as
      | { key: string; value: boolean }
      | undefined;
    return {
      scans: all.length,
      bytes: all.reduce((n, s) => n + s.bytes, 0),
      persisted: persisted ? persisted.value : null,
    };
  });
}

// Ask the browser to keep the archive across storage pressure — once, on the
// first save. The granted/denied answer is recorded and surfaced in the
// footer, never as a blocking dialog.
export async function requestPersistence(): Promise<boolean | null> {
  const asked = await tx("settings", "readonly", (t) =>
    reqAsPromise(t.objectStore("settings").get("persisted")),
  );
  if (asked) return (asked as { value: boolean }).value;
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return null;
  let granted: boolean;
  try {
    granted = await navigator.storage.persist();
  } catch {
    return null;
  }
  await tx("settings", "readwrite", (t) => {
    t.objectStore("settings").put({ key: "persisted", value: granted });
  });
  return granted;
}

// --- the default coordinate rule --------------------------------------------
// The picker offers the next untagged side neighbor of the newest scan, in
// E, S, W, N order (user ruling: reading order, row by row). First scan of a
// map: N1/E1. All four neighbors tagged: the newest scan's own panel (a
// fresh version). The grid has no zero row or column (CONTRACTS §2.1).

export function stepCoord(v: number, d: number): number {
  const n = v + d;
  return n === 0 ? (d > 0 ? 1 : -1) : n;
}

// --- bookmarks ---------------------------------------------------------------
// A bookmark is a name on a timestamp of the timeline — {id, mapId, name, at}
// and nothing more. Seeking to one re-derives the map; deleting one deletes
// a name, never a scan.

export interface BookmarkRecord {
  id: string;
  mapId: string;
  name: string;
  at: number; // epoch ms on the timeline
}

export function listBookmarks(mapId: string): Promise<BookmarkRecord[]> {
  return tx("bookmarks", "readonly", async (t) => {
    const all = (await reqAsPromise(
      t.objectStore("bookmarks").index("byMap").getAll(mapId),
    )) as BookmarkRecord[];
    return all.sort((a, b) => a.at - b.at);
  });
}

export function addBookmark(mapId: string, name: string, at: number): Promise<BookmarkRecord> {
  const rec: BookmarkRecord = { id: newId(), mapId, name: name.trim(), at };
  return tx("bookmarks", "readwrite", (t) => {
    t.objectStore("bookmarks").add(rec);
    return rec;
  });
}

export function deleteBookmark(id: string): Promise<void> {
  return tx("bookmarks", "readwrite", (t) => {
    t.objectStore("bookmarks").delete(id);
  });
}

// --- the archive -------------------------------------------------------------
// The backup: the storage interface serialized. The manifest carries every
// record; the blobs ride beside it under entry names the manifest points to.
// This is also act two's migration rehearsal: whatever can sync must first
// survive this round trip.

export const ARCHIVE_TAG = "jm-digitalizer-archive";
export const ARCHIVE_VERSION = 1;

export interface ArchiveScan extends Omit<ScanMeta, "thumb"> {
  imageEntry: string;
  thumbEntry: string;
}

export interface ArchiveManifest {
  archive: typeof ARCHIVE_TAG;
  version: number;
  exported: number;
  maps: MapRecord[];
  scans: ArchiveScan[];
  bookmarks: BookmarkRecord[];
}

const entryExt = (mime: string) =>
  mime === "image/webp" ? "webp" : mime === "image/jpeg" ? "jpg" : "bin";

export function exportArchive(
  mapIds: string[],
): Promise<{ manifest: ArchiveManifest; files: { name: string; blob: Blob }[] }> {
  return tx(["maps", "scans", "bookmarks"], "readonly", async (t) => {
    const wanted = new Set(mapIds);
    const maps = ((await reqAsPromise(t.objectStore("maps").getAll())) as MapRecord[])
      .filter((m) => wanted.has(m.id))
      .sort((a, b) => a.created - b.created);
    const scans = ((await reqAsPromise(t.objectStore("scans").getAll())) as ScanRecord[])
      .filter((s) => wanted.has(s.mapId))
      .sort((a, b) => a.created - b.created);
    const bookmarks = (
      (await reqAsPromise(t.objectStore("bookmarks").getAll())) as BookmarkRecord[]
    )
      .filter((b) => wanted.has(b.mapId))
      .sort((a, b) => a.at - b.at);

    const files: { name: string; blob: Blob }[] = [];
    const archiveScans: ArchiveScan[] = scans.map((s) => {
      const imageEntry = `scans/${s.id}.${entryExt(s.mime)}`;
      const thumbEntry = `thumbs/${s.id}.${entryExt(s.thumb.type || s.mime)}`;
      files.push({ name: imageEntry, blob: s.image });
      files.push({ name: thumbEntry, blob: s.thumb });
      const { image: _i, thumb: _t, ...meta } = s;
      return { ...meta, imageEntry, thumbEntry };
    });

    return {
      manifest: {
        archive: ARCHIVE_TAG,
        version: ARCHIVE_VERSION,
        exported: Date.now(),
        maps,
        scans: archiveScans,
        bookmarks,
      },
      files,
    };
  });
}

// Restore into NEW maps — never a silent merge. Fresh ids everywhere (the
// originals may still live on this device), original timestamps and notes
// kept, bookmarks remapped. One transaction: corrupt input restores nothing.
export function restoreArchive(
  manifest: ArchiveManifest,
  entries: Map<string, Blob>,
): Promise<{ maps: number; scans: number; bookmarks: number }> {
  if (manifest?.archive !== ARCHIVE_TAG || manifest.version !== ARCHIVE_VERSION) {
    return Promise.reject(new StoreError("failure", "not an archive this app understands"));
  }
  if (!Array.isArray(manifest.maps) || !Array.isArray(manifest.scans)) {
    return Promise.reject(new StoreError("failure", "the manifest is incomplete"));
  }
  for (const s of manifest.scans) {
    if (!entries.has(s.imageEntry) || !entries.has(s.thumbEntry)) {
      return Promise.reject(
        new StoreError("failure", `the archive is missing ${s.imageEntry}`),
      );
    }
    if (!Number.isInteger(s.tx) || !Number.isInteger(s.ty) || s.tx === 0 || s.ty === 0) {
      return Promise.reject(new StoreError("failure", "a scan carries a broken coordinate"));
    }
  }

  return tx(["maps", "scans", "bookmarks", "settings"], "readwrite", async (t) => {
    const mapsStore = t.objectStore("maps");
    const existing = (await reqAsPromise(mapsStore.getAll())) as MapRecord[];
    const taken = new Set(existing.map((m) => m.name));
    const mapIdOf = new Map<string, string>();
    let firstNewId = "";
    for (const m of manifest.maps) {
      const id = newId();
      mapIdOf.set(m.id, id);
      if (!firstNewId) firstNewId = id;
      const name = taken.has(m.name) ? `${m.name} (restored)` : m.name;
      mapsStore.add({ id, name, created: Date.now() });
    }
    const scansStore = t.objectStore("scans");
    for (const s of manifest.scans) {
      const mapId = mapIdOf.get(s.mapId);
      if (!mapId) throw new StoreError("failure", "a scan points at a map the archive lacks");
      const image = entries.get(s.imageEntry)!;
      const thumb = entries.get(s.thumbEntry)!;
      scansStore.add({
        id: newId(),
        mapId,
        tx: s.tx,
        ty: s.ty,
        created: s.created,
        note: s.note ?? "",
        sync: "local",
        mime: s.mime,
        width: s.width,
        height: s.height,
        bytes: image.size,
        image,
        thumb,
      });
    }
    const bmStore = t.objectStore("bookmarks");
    let bookmarks = 0;
    for (const b of manifest.bookmarks ?? []) {
      const mapId = mapIdOf.get(b.mapId);
      if (!mapId) continue; // a bookmark of a map outside this archive: drop
      bmStore.add({ id: newId(), mapId, name: b.name, at: b.at });
      bookmarks++;
    }
    if (firstNewId) {
      t.objectStore("settings").put({ key: "currentMapId", value: firstNewId });
    }
    return { maps: manifest.maps.length, scans: manifest.scans.length, bookmarks };
  });
}

export function defaultCoord(scans: ScanMeta[]): { tx: number; ty: number } {
  if (!scans.length) return { tx: 1, ty: 1 }; // N1/E1
  const last = scans.reduce((a, b) => (b.created > a.created ? b : a));
  const tagged = new Set(scans.map((s) => `${s.tx},${s.ty}`));
  const steps: [number, number][] = [
    [1, 0], // E
    [0, -1], // S
    [-1, 0], // W
    [0, 1], // N
  ];
  for (const [dx, dy] of steps) {
    const tx = dx ? stepCoord(last.tx, dx) : last.tx;
    const ty = dy ? stepCoord(last.ty, dy) : last.ty;
    if (!tagged.has(`${tx},${ty}`)) return { tx, ty };
  }
  return { tx: last.tx, ty: last.ty };
}
