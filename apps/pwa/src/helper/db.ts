// The Helper's archive: IndexedDB, its OWN database, shaped on the
// digitalizer's storage interface (act-two provisions included): every
// mutation goes through here and nowhere else, every world has a local id
// and a sync status, and the empty outbox store is where a future sync layer
// will queue mutations. Swapping "local-only" for "synced" must not change a
// caller.
import type { HelperWorldMeta, StoredEntry } from "./schema";

export type HelperStoreFailure = "unavailable" | "quota" | "failure";

export class HelperStoreError extends Error {
  kind: HelperStoreFailure;
  constructor(kind: HelperStoreFailure, message: string) {
    super(message);
    this.kind = kind;
  }
}

const DB_NAME = "jm-helper";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new HelperStoreError("unavailable", "IndexedDB is not available"));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new HelperStoreError("unavailable", String(e)));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("worlds")) {
        db.createObjectStore("worlds", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("entries")) {
        const entries = db.createObjectStore("entries", { keyPath: ["worldId", "seq"] });
        entries.createIndex("byWorld", "worldId");
      }
      if (!db.objectStoreNames.contains("outbox")) {
        db.createObjectStore("outbox", { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new HelperStoreError("unavailable", req.error?.message ?? "open failed"));
    req.onblocked = () =>
      reject(new HelperStoreError("unavailable", "the archive is open elsewhere"));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

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

function wrap(e: unknown): HelperStoreError {
  if (e instanceof HelperStoreError) return e;
  const name = (e as DOMException)?.name ?? "";
  const msg = (e as Error)?.message ?? String(e);
  if (name === "QuotaExceededError") return new HelperStoreError("quota", msg);
  return new HelperStoreError("failure", msg || "storage failed");
}

function reqAsPromise<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// --- worlds -----------------------------------------------------------------

export function listWorlds(): Promise<HelperWorldMeta[]> {
  return tx("worlds", "readonly", async (t) => {
    const all = (await reqAsPromise(t.objectStore("worlds").getAll())) as HelperWorldMeta[];
    return all.sort((a, b) => b.updated - a.updated);
  });
}

export function getWorld(id: string): Promise<HelperWorldMeta | undefined> {
  return tx("worlds", "readonly", (t) =>
    reqAsPromise(t.objectStore("worlds").get(id) as IDBRequest<HelperWorldMeta | undefined>),
  );
}

export function putWorld(meta: HelperWorldMeta): Promise<void> {
  return tx("worlds", "readwrite", (t) => {
    t.objectStore("worlds").put({ ...meta, updated: Date.now() });
  });
}

// Delete a world WITH its whole record, one transaction. Local and final.
export function deleteWorld(id: string): Promise<void> {
  return tx(["worlds", "entries"], "readwrite", async (t) => {
    t.objectStore("worlds").delete(id);
    const keys = (await reqAsPromise(
      t.objectStore("entries").index("byWorld").getAllKeys(id),
    )) as IDBValidKey[];
    for (const k of keys) t.objectStore("entries").delete(k);
  });
}

// --- the record's entries ---------------------------------------------------

export function loadEntries(worldId: string): Promise<StoredEntry[]> {
  return tx("entries", "readonly", async (t) => {
    const all = (await reqAsPromise(
      t.objectStore("entries").index("byWorld").getAll(worldId),
    )) as StoredEntry[];
    return all.sort((a, b) => a.seq - b.seq);
  });
}

// Write entries from a sequence number on and drop everything after the new
// tail — one transaction, so an amendment can never leave a torn record.
export function putEntriesFrom(
  worldId: string,
  fromSeq: number,
  rows: StoredEntry[],
): Promise<void> {
  return tx("entries", "readwrite", async (t) => {
    const store = t.objectStore("entries");
    const keys = (await reqAsPromise(
      store.index("byWorld").getAllKeys(worldId),
    )) as [string, number][];
    for (const k of keys) if (k[1] >= fromSeq) store.delete(k);
    for (const r of rows) store.put(r);
  });
}

// --- settings ---------------------------------------------------------------

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
