/**
 * Durable storage for the workflow undo/redo history.
 *
 * The history has to survive a page refresh — a mobile browser reclaims a
 * backgrounded tab freely, and coming back to a workflow whose last ten edits
 * can no longer be taken back is the same as losing them.
 *
 * It is NOT persisted through zustand's `persist` middleware like the rest of
 * the app state. That middleware re-serializes the whole persisted payload on
 * every `set`, and this payload is the largest in the app: up to
 * MAX_STEPS × 2 full workflow clones per open tab. Re-stringifying tens of
 * megabytes on every edit is exactly the input lag `createThrottledPersistStorage`
 * was written to avoid.
 *
 * So snapshots are stored one record per snapshot, written once, and never
 * rewritten: an edit costs one body write (the new snapshot) plus a small index
 * write, whatever the history already holds. The index names, per session, the
 * snapshot ids on each stack and the `workflowLoadedAt` of the workflow they
 * describe — a history whose stamp no longer matches the tab it belongs to is
 * dropped rather than restored onto a different workflow.
 *
 * Its own IndexedDB database, not the app's: adding an object store to the
 * existing one needs a version bump, and a version bump blocks while another
 * tab holds the old connection open.
 */

const DB_NAME = 'comfy-mobile-undo';
const STORE_NAME = 'history';
const INDEX_KEY = 'index';
const LS_PREFIX = 'comfy-mobile-undo:';
const WRITE_DEBOUNCE_MS = 400;

export interface PersistedSessionHistory {
  /** `workflowLoadedAt` of the workflow these snapshots describe. */
  loadedAt: number;
  /** Snapshot ids, oldest first. */
  undo: string[];
  redo: string[];
}

export interface PersistedUndoIndex {
  version: 1;
  sessions: Record<string, PersistedSessionHistory>;
}

export interface UndoStorageWrite {
  index: PersistedUndoIndex;
  /** Snapshot bodies not written yet, by id. */
  newBodies: Map<string, unknown>;
  /** Snapshot ids no stack references any more. */
  removedIds: string[];
}

export interface LoadedUndoStorage {
  index: PersistedUndoIndex;
  bodies: Map<string, unknown>;
}

const idbAvailable = typeof indexedDB !== 'undefined';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return getDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = run(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      }),
  );
}

// --- localStorage fallback (jsdom, private modes, very old browsers) --------
// Snapshots are large and localStorage is small, so a quota failure here is
// expected rather than exceptional: it degrades to "no persisted history"
// without disturbing the in-memory one.

function lsWrite(write: UndoStorageWrite): void {
  try {
    for (const id of write.removedIds) localStorage.removeItem(`${LS_PREFIX}${id}`);
    for (const [id, body] of write.newBodies) {
      localStorage.setItem(`${LS_PREFIX}${id}`, JSON.stringify(body));
    }
    localStorage.setItem(`${LS_PREFIX}${INDEX_KEY}`, JSON.stringify(write.index));
  } catch {
    /* out of quota / unavailable — the in-memory history still works */
  }
}

function lsLoad(): LoadedUndoStorage | null {
  try {
    const raw = localStorage.getItem(`${LS_PREFIX}${INDEX_KEY}`);
    if (!raw) return null;
    const index = JSON.parse(raw) as PersistedUndoIndex;
    if (!index || index.version !== 1 || !index.sessions) return null;
    const bodies = new Map<string, unknown>();
    for (const history of Object.values(index.sessions)) {
      for (const id of [...history.undo, ...history.redo]) {
        const body = localStorage.getItem(`${LS_PREFIX}${id}`);
        if (body != null) bodies.set(id, JSON.parse(body));
      }
    }
    return { index, bodies };
  } catch {
    return null;
  }
}

function lsClear(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(LS_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

// --- Coalesced writes -------------------------------------------------------
// Several snapshots can land between two flushes (a burst of edits, an undo
// that pushes onto the redo stack). They merge into one pending write: the
// newest index wins, bodies accumulate, and a body queued and then dropped in
// the same window is never written at all.

let pending: UndoStorageWrite | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function mergePending(write: UndoStorageWrite): void {
  if (!pending) {
    pending = {
      index: write.index,
      newBodies: new Map(write.newBodies),
      removedIds: [...write.removedIds],
    };
    return;
  }
  pending.index = write.index;
  for (const [id, body] of write.newBodies) pending.newBodies.set(id, body);
  for (const id of write.removedIds) {
    // Queued but never written: dropping it from the queue is the whole delete.
    if (pending.newBodies.delete(id)) continue;
    if (!pending.removedIds.includes(id)) pending.removedIds.push(id);
  }
}

function commit(write: UndoStorageWrite): void {
  if (!idbAvailable) {
    lsWrite(write);
    return;
  }
  void getDb()
    .then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          for (const id of write.removedIds) store.delete(id);
          for (const [id, body] of write.newBodies) store.put(body, id);
          store.put(write.index, INDEX_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    )
    .catch(() => {
      /* best-effort persistence */
    });
}

/** Queue a history write. Flushed on a debounce, and on the way out of the page. */
export function writeUndoHistory(write: UndoStorageWrite): void {
  mergePending(write);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushUndoHistory, WRITE_DEBOUNCE_MS);
}

/** Write anything queued right now (called on pagehide, and by tests). */
export function flushUndoHistory(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const write = pending;
  pending = null;
  if (!write) return;
  commit(write);
}

/** Read back everything persisted, or null when there is nothing usable. */
export async function loadUndoHistory(): Promise<LoadedUndoStorage | null> {
  if (!idbAvailable) return lsLoad();
  try {
    const index = await withStore<PersistedUndoIndex | undefined>('readonly', (store) =>
      store.get(INDEX_KEY),
    );
    if (!index || index.version !== 1 || !index.sessions) return null;
    const bodies = new Map<string, unknown>();
    for (const history of Object.values(index.sessions)) {
      for (const id of [...history.undo, ...history.redo]) {
        const body = await withStore<unknown>('readonly', (store) => store.get(id));
        if (body !== undefined) bodies.set(id, body);
      }
    }
    return { index, bodies };
  } catch {
    return null;
  }
}

/** Drop everything. Used when the persisted history is unusable. */
export async function clearUndoHistoryStorage(): Promise<void> {
  pending = null;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!idbAvailable) {
    lsClear();
    return;
  }
  await withStore<undefined>('readwrite', (store) => store.clear()).catch(() => undefined);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushUndoHistory);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushUndoHistory();
  });
}
