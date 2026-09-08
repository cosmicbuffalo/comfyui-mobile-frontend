import type { PersistStorage, StateStorage, StorageValue } from 'zustand/middleware';

/**
 * A zustand `StateStorage` backed by IndexedDB, used for the workflow store —
 * whose persisted payload (every open session's workflow + layout + node
 * outputs) can exceed localStorage's ~5 MB quota.
 *
 * Behavior:
 * - Writes are throttled and coalesced (the store updates on every keystroke /
 *   progress tick), then flushed on pagehide so a refresh keeps the latest state.
 * - On first read it migrates any existing localStorage value into IndexedDB,
 *   so upgrading users don't lose their open workflows.
 * - When IndexedDB is unavailable (jsdom/tests, very old browsers) it falls back
 *   to synchronous localStorage, preserving the previous behavior exactly.
 */

const DB_NAME = 'comfy-mobile-frontend';
const STORE_NAME = 'zustand';
const WRITE_DEBOUNCE_MS = 250;

const idbAvailable = typeof indexedDB !== 'undefined';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    const opened: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // The browser can force-close an established connection — storage
        // pressure on iOS Safari, a version upgrade from another tab. The
        // handle stays truthy but every transaction on it throws, so a cached
        // dead one would fail persistence for the rest of the session. Drop
        // it and let the next call open fresh. The identity check keeps a
        // late close event from discarding a newer connection.
        db.onclose = () => {
          if (dbPromise === opened) dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          if (dbPromise === opened) dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        if (dbPromise === opened) dbPromise = null;
        reject(request.error);
      };
    });
    dbPromise = opened;
  }
  return dbPromise;
}

async function idbRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
  reopenOnDeadHandle = true,
): Promise<T> {
  const handle = getDb();
  const db = await handle;
  let tx: IDBTransaction;
  try {
    tx = db.transaction(STORE_NAME, mode);
  } catch (error) {
    // A force-closed connection throws InvalidStateError here before any
    // close event has had a chance to clear the cache. Reopen once; a second
    // failure is a real one.
    if (dbPromise === handle) dbPromise = null;
    if (reopenOnDeadHandle) return idbRequest(mode, run, false);
    throw error;
  }
  return new Promise<T>((resolve, reject) => {
    const request = run(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => resolve(request.result as T);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? request.error);
    request.onerror = () => reject(request.error);
  });
}

const idbGet = (key: string) =>
  idbRequest<string | undefined>('readonly', (store) => store.get(key)).then(
    (value) => value ?? null,
  );
const idbSet = (key: string, value: string) =>
  idbRequest<IDBValidKey>('readwrite', (store) => store.put(value, key)).then(() => undefined);
const idbDel = (key: string) =>
  idbRequest<undefined>('readwrite', (store) => store.delete(key)).then(() => undefined);

// A separate recovery key must win over an older IndexedDB record after a
// reload. Keep legacy migration distinct so it cannot overwrite newer state.
const recoveryKey = (name: string) => `${name}:idb-recovery`;

async function writePersisted(
  name: string,
  value: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const previousRecovery = lsGet(recoveryKey(name));
  try {
    await idbSet(name, value);
  } catch {
    if (isCurrent()) localStorage.setItem(recoveryKey(name), value);
    return;
  }
  try {
    // An older in-flight write must not remove a newer recovery copy.
    if (localStorage.getItem(recoveryKey(name)) === previousRecovery) {
      localStorage.removeItem(recoveryKey(name));
    }
  } catch {
    // IndexedDB already committed this value.
  }
}

// --- Debounced, coalesced writes -------------------------------------------
const pending = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function flushKey(key: string): void {
  const value = pending.get(key);
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
  if (value === undefined) return;
  void writePersisted(key, value, () => pending.get(key) === value)
    .then(() => { if (pending.get(key) === value) pending.delete(key); })
    .catch((error) => console.warn('Unable to save browser state; retaining pending changes:', error));
}

function scheduleWrite(key: string, value: string): void {
  pending.set(key, value);
  if (timers.has(key)) return;
  timers.set(key, setTimeout(() => flushKey(key), WRITE_DEBOUNCE_MS));
}

function flushAll(): void {
  for (const key of [...pending.keys()]) flushKey(key);
}

if (idbAvailable && typeof window !== 'undefined') {
  // Flush before the page goes away so a refresh/close keeps the latest state.
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll();
  });
}

const lsGet = (name: string): string | null => {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
};

// Read the persisted string from IndexedDB, migrating a legacy localStorage value
// on first read. Shared by the string-based `idbStorage` and the object-based
// throttled storage below.
async function readPersisted(name: string): Promise<string | null> {
  const recovery = lsGet(recoveryKey(name));
  if (recovery != null) {
    await writePersisted(name, recovery).catch(() => {});
    return recovery;
  }
  const stored = await idbGet(name).catch(() => null);
  if (stored != null) return stored;
  // One-time migration from the previous localStorage backend.
  const legacy = lsGet(name);
  if (legacy != null) {
    // Only drop the legacy localStorage copy once the IndexedDB write is
    // confirmed — otherwise a blocked/failed idb write (e.g. Safari private
    // mode) would delete the only persisted copy and lose state.
    let migrated = false;
    await idbSet(name, legacy).then(() => { migrated = true; }).catch(() => {});
    if (migrated) {
      try {
        localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    }
    return legacy;
  }
  return null;
}

export const idbStorage: StateStorage = idbAvailable
  ? {
      getItem: async (name) => {
        // Return an unflushed pending write so reads stay consistent.
        const queued = pending.get(name);
        if (queued !== undefined) return queued;
        return readPersisted(name);
      },
      setItem: (name, value) => {
        scheduleWrite(name, value);
      },
      removeItem: async (name) => {
        pending.delete(name);
        const timer = timers.get(name);
        if (timer) clearTimeout(timer);
        timers.delete(name);
        try {
          localStorage.removeItem(name);
          localStorage.removeItem(recoveryKey(name));
        } catch { /* unavailable */ }
        await idbDel(name).catch(() => {});
      },
    }
  : {
      // Synchronous localStorage fallback (preserves prior behavior + tests).
      getItem: (name) => lsGet(name),
      setItem: (name, value) => {
        try {
          localStorage.setItem(name, value);
        } catch {
          /* ignore quota errors */
        }
      },
      removeItem: (name) => {
        try {
          localStorage.removeItem(name);
        } catch {
          /* ignore */
        }
      },
    };

const SERIALIZE_DEBOUNCE_MS = 250;

/**
 * An object-based zustand `PersistStorage` that defers JSON serialization to a
 * coalescing window. zustand's default `createJSONStorage` `JSON.stringify`s the
 * whole partialized state synchronously on *every* `set`. For the workflow store
 * — whose payload grows with every open session (each a full workflow + layout +
 * node outputs) — that means re-serializing all open tabs on every keystroke and
 * every background progress tick, which shows up as input lag with several tabs
 * open. Here `setItem` only stashes the latest object; the stringify + IndexedDB
 * write run at most once per 250 ms window (and on pagehide). Continuous updates
 * cannot postpone a save indefinitely. Reads return the
 * not-yet-serialized pending object so they stay consistent.
 *
 * Falls back to eager localStorage serialization when IndexedDB is unavailable
 * (jsdom/tests, old browsers), matching `createJSONStorage(idbStorage)` exactly.
 */
export function createThrottledPersistStorage<S>(): PersistStorage<S> {
  if (!idbAvailable) {
    return {
      getItem: (name) => {
        const raw = lsGet(name);
        return raw == null ? null : (JSON.parse(raw) as StorageValue<S>);
      },
      setItem: (name, value) => {
        try {
          localStorage.setItem(name, JSON.stringify(value));
        } catch {
          /* ignore quota errors */
        }
      },
      removeItem: (name) => {
        try {
          localStorage.removeItem(name);
        } catch {
          /* ignore */
        }
      },
    };
  }

  const objPending = new Map<string, StorageValue<S>>();
  const objTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const flush = (name: string) => {
    const timer = objTimers.get(name);
    if (timer) clearTimeout(timer);
    objTimers.delete(name);
    const value = objPending.get(name);
    if (value === undefined) return;
    try {
      // Write directly (not via idbStorage's string debounce) so a pagehide flush
      // issues the IndexedDB transaction immediately rather than re-queuing it.
      void writePersisted(name, JSON.stringify(value), () => objPending.get(name) === value)
        .then(() => { if (objPending.get(name) === value) objPending.delete(name); })
        .catch((error) => console.warn('Unable to save workflow; retaining pending changes:', error));
    } catch (error) {
      console.warn('Unable to serialize workflow; retaining pending changes:', error);
    }
  };

  if (typeof window !== 'undefined') {
    const flushAllObjects = () => { for (const name of [...objPending.keys()]) flush(name); };
    window.addEventListener('pagehide', flushAllObjects);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushAllObjects();
    });
  }

  return {
    getItem: async (name) => {
      // A not-yet-serialized pending value is the freshest state.
      const pendingObj = objPending.get(name);
      if (pendingObj !== undefined) return pendingObj;
      const raw = await readPersisted(name);
      if (raw == null) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      objPending.set(name, value);
      if (objTimers.has(name)) return;
      objTimers.set(name, setTimeout(() => flush(name), SERIALIZE_DEBOUNCE_MS));
    },
    removeItem: (name) => {
      objPending.delete(name);
      const timer = objTimers.get(name);
      if (timer) clearTimeout(timer);
      objTimers.delete(name);
      try {
        localStorage.removeItem(name);
        localStorage.removeItem(recoveryKey(name));
      } catch { /* unavailable */ }
      void idbDel(name).catch(() => {});
    },
  };
}
