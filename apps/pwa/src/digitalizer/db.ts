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
const DB_VERSION = 1;

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
      const db = req.result;
      db.createObjectStore("maps", { keyPath: "id" });
      const scans = db.createObjectStore("scans", { keyPath: "id" });
      scans.createIndex("byMap", "mapId");
      scans.createIndex("byPanel", ["mapId", "tx", "ty"]);
      db.createObjectStore("outbox", { autoIncrement: true });
      db.createObjectStore("settings", { keyPath: "key" });
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

// The atlas: each panel's newest scan.
export function latestPerPanel(mapId: string): Promise<Map<string, ScanMeta>> {
  return listScans(mapId).then((all) => {
    const out = new Map<string, ScanMeta>();
    for (const s of all) {
      const key = `${s.tx},${s.ty}`;
      const seen = out.get(key);
      if (!seen || s.created > seen.created) out.set(key, s);
    }
    return out;
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
