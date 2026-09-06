/**
 * Persists mask editor undo history across a page reload.
 *
 * The in-memory cache (`maskHistoryCache`) already carries history between
 * openings, but a refresh drops it. Storing it means solving the size problem:
 * one entry is two full-resolution ImageData buffers -- about 8MB on a
 * 768x1344 image. The in-memory engine scales its step count against a raw-byte
 * budget, and this store applies the same limit before decoding an older record
 * so a previously-written 20-step history cannot recreate the old memory spike.
 *
 * Encoding each layer as PNG fixes that outright, because these layers are
 * almost entirely transparent. A real paint layer from this editor compresses
 * from ~4MB of raw pixels to around 18KB, so a full history lands in the low
 * megabytes.
 *
 * Lives under utils rather than beside the editor so the workflow store can
 * clear it on session close without a component import, and declares the entry
 * shape structurally so it does not depend on the engine.
 *
 * Uses its own database rather than the one behind `idbStorage`: that one is a
 * zustand string store opened at a fixed version, and adding an object store to
 * it would force a version bump on the workflow persistence path for no reason.
 */

import { maskHistoryLimitForDimensions } from '@/utils/maskEditor/historyLimit';

const DB_NAME = 'comfy-mobile-mask-history';
const STORE_NAME = 'history';
/** Only the most recent lineage is kept, matching the in-memory policy. */
const RECORD_KEY = 'current';

const idbAvailable = typeof indexedDB !== 'undefined';

/** Structurally identical to the engine's HistoryEntry, without the import. */
export interface MaskHistoryEntry {
  mask: ImageData;
  paint: ImageData;
}

interface StoredRecord {
  lineage: string;
  /** The workflow session that owned this history; cleared when it closes. */
  sessionId: string | null;
  /**
   * Key of the file this history's last save produced.
   *
   * After a reload the in-memory successor map is gone, so a node pointing at
   * that file resolves to its OWN key rather than the lineage. Storing it lets
   * the record be found either way, and the mapping is re-registered on load so
   * later saves keep chaining.
   */
  savedKey: string;
  width: number;
  height: number;
  index: number;
  entries: Array<{ mask: Blob; paint: Blob }>;
}

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

function idbRun<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return getDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  }));
}

function imageDataToBlob(data: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = data.width;
  canvas.height = data.height;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('could not encode a history layer'))),
      'image/png',
    );
  });
}

async function blobToImageData(blob: Blob, width: number, height: number): Promise<ImageData> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  // The layers carry meaningful alpha, and drawImage composites; clearing first
  // and drawing onto an empty canvas keeps the values exact.
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Supersession guard. Encoding a full history takes long enough that a second
 * save can start before the first finishes; without this the older, longer-
 * running write could land last and overwrite the newer history.
 */
let writeToken = 0;

export interface PersistableHistory {
  lineage: string;
  savedKey: string;
  sessionId: string | null;
  width: number;
  height: number;
  entries: MaskHistoryEntry[];
  index: number;
}

/**
 * Encode and store a history. Safe to call without awaiting -- failures are
 * swallowed, because losing persisted undo is not worth interrupting a save
 * the user already completed.
 */
export async function persistMaskHistory(history: PersistableHistory): Promise<void> {
  if (!idbAvailable) return;
  const token = ++writeToken;
  try {
    const entries = await Promise.all(history.entries.map(async (entry) => ({
      mask: await imageDataToBlob(entry.mask),
      paint: await imageDataToBlob(entry.paint),
    })));
    if (token !== writeToken) return;

    const record: StoredRecord = {
      lineage: history.lineage,
      savedKey: history.savedKey,
      sessionId: history.sessionId,
      width: history.width,
      height: history.height,
      index: history.index,
      entries,
    };
    await idbRun('readwrite', (store) => store.put(record, RECORD_KEY));
  } catch {
    // Quota exceeded, private mode, a closed database — the editor still works.
  }
}

/** Read back a stored history, decoding its layers. Null when there is nothing usable. */
export async function loadPersistedMaskHistory(
  lineage: string,
  width: number,
  height: number,
): Promise<{ entries: MaskHistoryEntry[]; index: number; lineage: string } | null> {
  if (!idbAvailable) return null;
  try {
    const record = await idbRun<StoredRecord | undefined>(
      'readonly', (store) => store.get(RECORD_KEY),
    );
    if (!record) return null;
    // Match the lineage, or the file its last save produced — after a reload
    // the caller only knows the latter.
    if (record.lineage !== lineage && record.savedKey !== lineage) return null;
    // A different-sized image cannot share history: putImageData would throw.
    if (record.width !== width || record.height !== height) return null;

    const limit = maskHistoryLimitForDimensions(width, height);
    const dropped = Math.max(0, record.entries.length - limit);
    const storedEntries = record.entries.slice(dropped);
    const storedIndex = Math.max(0, record.index - dropped);
    const entries = await Promise.all(storedEntries.map(async (entry) => ({
      mask: await blobToImageData(entry.mask, width, height),
      paint: await blobToImageData(entry.paint, width, height),
    })));
    if (entries.length === 0) return null;
    return {
      entries,
      index: Math.min(storedIndex, entries.length - 1),
      lineage: record.lineage,
    };
  } catch {
    return null;
  }
}

/**
 * Drop the stored history.
 *
 * With a `sessionId` this only clears a record that session owned, so closing
 * one workflow tab cannot throw away another tab's undo history.
 */
export async function clearPersistedMaskHistory(
  options?: { sessionId?: string | null },
): Promise<void> {
  if (!idbAvailable) return;
  try {
    if (options && 'sessionId' in options) {
      const record = await idbRun<StoredRecord | undefined>(
        'readonly', (store) => store.get(RECORD_KEY),
      );
      if (!record) return;
      // A record written before sessions were tracked has no owner; leave it,
      // since the next save will replace it anyway.
      if (record.sessionId == null || record.sessionId !== options.sessionId) return;
    }
    await idbRun('readwrite', (store) => store.delete(RECORD_KEY));
  } catch {
    // Nothing to do.
  }
}
