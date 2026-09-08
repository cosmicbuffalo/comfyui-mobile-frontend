import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Drive request success and transaction completion separately. A successful put
// can still be rolled back; this ordering was also reproduced in Chromium.
function installIndexedDb(abortWrite: boolean) {
  const records = new Map<string, string>();
  const aborted = vi.fn();
  const committed = vi.fn();

  const database = {
    transaction: () => {
      const transaction = {
        error: new DOMException('Injected transaction abort', 'AbortError'),
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        onerror: null as (() => void) | null,
        objectStore: () => ({
          get: (key: string) => {
            const request = {
              result: records.get(key),
              onsuccess: null as (() => void) | null,
            };
            queueMicrotask(() => {
              request.onsuccess?.();
              queueMicrotask(() => transaction.oncomplete?.());
            });
            return request;
          },
          put: (value: string, key: string) => {
            const request = { result: key, onsuccess: null as (() => void) | null };
            queueMicrotask(() => {
              request.onsuccess?.();
              queueMicrotask(() => {
                if (abortWrite) {
                  aborted();
                  transaction.onabort?.();
                } else {
                  records.set(key, value);
                  committed();
                  transaction.oncomplete?.();
                }
              });
            });
            return request;
          },
        }),
      };
      return transaction;
    },
  };

  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = { result: database, onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
  return { records, aborted, committed, setAbortWrite: (value: boolean) => { abortWrite = value; } };
}

describe('workflow storage migration', () => {
  const key = 'workflow-storage';
  const saved = { state: { prompt: 'The only saved copy' }, version: 0 };

  beforeEach(() => {
    vi.resetModules();
    localStorage.setItem(key, JSON.stringify(saved));
    // These tests only read/migrate. Avoid accumulating module-level unload
    // listeners when importing a fresh storage instance for each case.
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:idb-recovery`);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('moves the legacy copy to IndexedDB when the transaction commits', async () => {
    const db = installIndexedDb(false);
    const { createThrottledPersistStorage } = await import('../idbStorage');
    const storage = createThrottledPersistStorage();

    expect(await storage.getItem(key)).toEqual(saved);
    expect(db.committed).toHaveBeenCalledOnce();
    expect(localStorage.getItem(key)).toBeNull();
    expect(JSON.parse(db.records.get(key)!)).toEqual(saved);
    expect(await storage.getItem(key)).toEqual(saved);
  });

  it('retains the legacy copy when a successful put is rolled back', async () => {
    const db = installIndexedDb(true);
    const { createThrottledPersistStorage } = await import('../idbStorage');
    const storage = createThrottledPersistStorage();

    expect(await storage.getItem(key)).toEqual(saved);
    expect(db.aborted).toHaveBeenCalledOnce();
    expect(db.records.has(key)).toBe(false);
    expect(localStorage.getItem(key)).toBe(JSON.stringify(saved));
    expect(await storage.getItem(key)).toEqual(saved);
  });

  it('saves during continuous progress updates without waiting for a quiet gap', async () => {
    vi.useFakeTimers();
    const db = installIndexedDb(false);
    const { createThrottledPersistStorage } = await import('../idbStorage');
    const storage = createThrottledPersistStorage<{ progress: number }>();

    for (let progress = 0; progress < 10; progress += 1) {
      storage.setItem(key, { state: { progress }, version: 0 });
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(db.committed.mock.calls.length).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(JSON.parse(db.records.get(key)!).state.progress).toBe(9);
  });

  it('recovers a failed write ahead of an older IndexedDB copy after reload', async () => {
    vi.useFakeTimers();
    const db = installIndexedDb(true);
    db.records.set(key, JSON.stringify(saved));
    const { createThrottledPersistStorage } = await import('../idbStorage');
    const fresh = { state: { prompt: 'New edit' }, version: 0 };
    createThrottledPersistStorage().setItem(key, fresh);
    await vi.advanceTimersByTimeAsync(250);

    db.setAbortWrite(false);
    vi.resetModules();
    const reloaded = await import('../idbStorage');
    expect(await reloaded.createThrottledPersistStorage().getItem(key)).toEqual(fresh);
    expect(JSON.parse(db.records.get(key)!)).toEqual(fresh);
    expect(localStorage.getItem(`${key}:idb-recovery`)).toBeNull();
  });

  it('retires a recovery copy when a newer value commits successfully', async () => {
    vi.useFakeTimers();
    const db = installIndexedDb(true);
    const { createThrottledPersistStorage } = await import('../idbStorage');
    const storage = createThrottledPersistStorage<{ prompt: string }>();
    storage.setItem(key, saved);
    await vi.advanceTimersByTimeAsync(250);
    db.setAbortWrite(false);
    const fresh = { state: { prompt: 'Newer edit' }, version: 0 };
    storage.setItem(key, fresh);
    await vi.advanceTimersByTimeAsync(250);

    expect(localStorage.getItem(`${key}:idb-recovery`)).toBeNull();
    expect(await storage.getItem(key)).toEqual(fresh);
  });

  it('retains pending edits when both storage backends reject the write', async () => {
    vi.useFakeTimers();
    installIndexedDb(true);
    const { createThrottledPersistStorage } = await import('../idbStorage');
    const storage = createThrottledPersistStorage();
    // Spied at both levels: jsdom hands out a proxied Storage instance whose
    // instance-level spy can land in the store as data instead of shadowing
    // the method (the module then parks its recovery copy successfully and
    // nothing ever warns), while a runtime serving its own webstorage global
    // ignores the jsdom prototype. One of the two catches the module's call
    // everywhere.
    const refuse = () => {
      throw new DOMException('No storage space', 'QuotaExceededError');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    vi.spyOn(localStorage, 'setItem').mockImplementation(refuse);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage.setItem(key, saved);
    await vi.advanceTimersByTimeAsync(250);

    expect(await storage.getItem(key)).toEqual(saved);
    expect(warning).toHaveBeenCalled();
  });

  // A connection the browser force-closed (storage pressure, an upgrade in
  // another tab) stays truthy but throws on every transaction. The cached
  // handle must be dropped — via the close event when one fires, or on the
  // synchronous throw when none did — or persistence is dead for the session.
  function installClosableIndexedDb() {
    const records = new Map<string, string>();
    const databases: Array<{
      dead: boolean;
      onclose: (() => void) | null;
      onversionchange: (() => void) | null;
    }> = [];
    const makeDatabase = () => {
      const database = {
        dead: false,
        onclose: null as (() => void) | null,
        onversionchange: null as (() => void) | null,
        transaction: () => {
          if (database.dead) {
            throw new DOMException('The database connection is closing.', 'InvalidStateError');
          }
          const transaction = {
            error: null,
            oncomplete: null as (() => void) | null,
            onabort: null as (() => void) | null,
            onerror: null as (() => void) | null,
            objectStore: () => ({
              get: (k: string) => {
                const request = { result: records.get(k), onsuccess: null as (() => void) | null };
                queueMicrotask(() => {
                  request.onsuccess?.();
                  queueMicrotask(() => transaction.oncomplete?.());
                });
                return request;
              },
              put: (value: string, k: string) => {
                const request = { result: k, onsuccess: null as (() => void) | null };
                queueMicrotask(() => {
                  records.set(k, value);
                  request.onsuccess?.();
                  queueMicrotask(() => transaction.oncomplete?.());
                });
                return request;
              },
            }),
          };
          return transaction;
        },
      };
      databases.push(database);
      return database;
    };
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = { result: makeDatabase(), onsuccess: null as (() => void) | null };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    });
    return { records, databases };
  }

  it('reopens after a force-closed connection that never reported closing', async () => {
    vi.useFakeTimers();
    const { records, databases } = installClosableIndexedDb();
    const { createThrottledPersistStorage } = await import('../idbStorage');
    const storage = createThrottledPersistStorage<{ prompt: string }>();
    storage.setItem(key, saved);
    await vi.advanceTimersByTimeAsync(250);
    expect(JSON.parse(records.get(key)!)).toEqual(saved);
    expect(databases).toHaveLength(1);

    databases[0].dead = true;
    const fresh = { state: { prompt: 'After the connection died' }, version: 0 };
    storage.setItem(key, fresh);
    await vi.advanceTimersByTimeAsync(250);

    expect(databases).toHaveLength(2);
    expect(JSON.parse(records.get(key)!)).toEqual(fresh);
    expect(localStorage.getItem(`${key}:idb-recovery`)).toBeNull();
  });

  it('drops the cached handle when the connection announces its close', async () => {
    vi.useFakeTimers();
    const { records, databases } = installClosableIndexedDb();
    const { createThrottledPersistStorage } = await import('../idbStorage');
    const storage = createThrottledPersistStorage<{ prompt: string }>();
    storage.setItem(key, saved);
    await vi.advanceTimersByTimeAsync(250);
    expect(databases).toHaveLength(1);

    databases[0].dead = true;
    databases[0].onclose?.();
    const fresh = { state: { prompt: 'After the close event' }, version: 0 };
    storage.setItem(key, fresh);
    await vi.advanceTimersByTimeAsync(250);

    expect(databases).toHaveLength(2);
    expect(JSON.parse(records.get(key)!)).toEqual(fresh);
  });

  it('saves a recovery copy when IndexedDB exists but opening it is denied', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = {
          error: new DOMException('Database access denied', 'SecurityError'),
          onerror: null as (() => void) | null,
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    });
    const { createThrottledPersistStorage } = await import('../idbStorage');
    const storage = createThrottledPersistStorage();
    const fresh = { state: { prompt: 'Edit while IndexedDB is unavailable' }, version: 0 };
    storage.setItem(key, fresh);
    await vi.advanceTimersByTimeAsync(250);

    expect(JSON.parse(localStorage.getItem(`${key}:idb-recovery`)!)).toEqual(fresh);
    expect(await storage.getItem(key)).toEqual(fresh);
  });
});
