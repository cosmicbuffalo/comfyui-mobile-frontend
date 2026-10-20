import { useEffect, useState, type RefObject } from 'react';
import type { FileItem } from '@/api/client';

/**
 * Outputs-grid thumbnails for 3D files, rendered in this browser and kept in
 * IndexedDB, keyed by file id and the listing's cache token so a replaced file
 * renders again. Per-device by choice: a shared cache would need an upload
 * route (checked with mobile_auth.can_modify_file) and a server-side store.
 */

// Background renders download the whole model; skip anything larger.
const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
// About a long scroll of Outputs; anything older renders again when it comes back on screen.
const MAX_STORED = 300;
const MAX_IN_MEMORY = 150;
const STORE = 'thumbnails';

type Thumbnail = { url: string; token: string };
type Stored = { blob: Blob; token: string; savedAt: number };

const thumbnails = new Map<string, Thumbnail>();
const listeners = new Map<string, Set<() => void>>();
/** Cards on screen; only their thumbnails are kept in memory past MAX_IN_MEMORY. */
const visible = new Set<string>();
/** The cache token of each file version that failed to render. */
const failed = new Map<string, string>();
const queue: FileItem[] = [];
let active = false;
let draining = false;
let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('comfyui-mobile-model-thumbnails', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      const db = request.result;
      // iOS drops connections under storage pressure or long backgrounding; reopen next time.
      db.onclose = () => { database = null; };
      db.onversionchange = () => { db.close(); database = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    // A failed open or a dead handle must not stay cached for the session.
    database = null;
    throw error;
  }
}

const readStored = (id: string) => withStore<Stored | undefined>('readonly', store => store.get(id));
const writeStored = (id: string, value: Stored) => withStore<IDBValidKey>('readwrite', store => store.put(value, id));
const deleteStored = (id: string) => withStore<undefined>('readwrite', store => store.delete(id));

/** Drop the oldest stored thumbnails beyond MAX_STORED. */
async function pruneStored() {
  if (await withStore<number>('readonly', store => store.count()) <= MAX_STORED) return;
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    const ages: Array<[IDBValidKey, number]> = [];
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const entry = cursor.result;
      if (entry) {
        // Entries from before 3.4.0 have no savedAt and go first.
        ages.push([entry.primaryKey, (entry.value as Stored).savedAt ?? 0]);
        entry.continue();
        return;
      }
      ages.sort((a, b) => a[1] - b[1]).slice(0, ages.length - MAX_STORED).forEach(([key]) => store.delete(key));
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function forget(id: string) {
  const thumbnail = thumbnails.get(id);
  if (!thumbnail) return;
  URL.revokeObjectURL(thumbnail.url);
  thumbnails.delete(id);
}

function remember(id: string, blob: Blob, token: string) {
  forget(id);
  thumbnails.set(id, { url: URL.createObjectURL(blob), token });
  listeners.get(id)?.forEach(listener => listener());
  // Map order is insertion order, so the first entries are the least recently loaded.
  // An evicted card shows its placeholder and reloads from storage when it scrolls back.
  for (const key of thumbnails.keys()) {
    if (thumbnails.size <= MAX_IN_MEMORY) break;
    if (visible.has(key)) continue;
    forget(key);
    listeners.get(key)?.forEach(listener => listener());
  }
}

/** Deleted files take their thumbnails with them. */
export function forgetModelThumbnails(ids: string[]) {
  for (const id of ids) {
    forget(id);
    failed.delete(id);
    void deleteStored(id).catch(() => {});
  }
}

/** The cached thumbnail URL, unless the file has changed since it was rendered. */
function currentUrl(file: Pick<FileItem, 'id' | 'cacheToken'>): string | null {
  const thumbnail = thumbnails.get(file.id);
  return thumbnail && file.cacheToken && thumbnail.token === file.cacheToken ? thumbnail.url : null;
}

export function hasModelThumbnail(file: Pick<FileItem, 'id' | 'cacheToken'>): boolean {
  return currentUrl(file) !== null;
}

/** Only a file whose identity is known can be cached: without it a replaced file would keep the old picture. */
export function saveModelThumbnail(file: Pick<FileItem, 'id' | 'cacheToken'>, blob: Blob) {
  const token = file.cacheToken;
  if (!token) return;
  remember(file.id, blob, token);
  // Private browsing can refuse IndexedDB; the thumbnail still lasts the session.
  void writeStored(file.id, { blob, token, savedAt: Date.now() }).then(pruneStored).catch(() => {});
}

/** Background renders need WebGL frames, which a hidden page doesn't get. */
function whenPageVisible(): Promise<void> {
  return new Promise(resolve => {
    if (!document.hidden) return resolve();
    const onChange = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

/** Background rendering only runs while the Outputs panel is on screen. */
export function setModelThumbnailsActive(next: boolean) {
  active = next;
  if (active) void drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (active && queue.length > 0) {
      await whenPageVisible();
      if (!active) break;
      const file = queue.shift();
      if (!file) break;
      if (hasModelThumbnail(file) || failed.get(file.id) === file.cacheToken) continue;
      try {
        const { renderModelThumbnail } = await import('@/components/ThreeView/renderModelThumbnail');
        saveModelThumbnail(file, await renderModelThumbnail(file.fullUrl!, file.name));
      } catch {
        // Unreadable or too slow: don't retry this version for the rest of the session.
        failed.set(file.id, file.cacheToken!);
      }
    }
  } finally {
    draining = false;
  }
}

function dequeue(id: string) {
  const index = queue.findIndex(entry => entry.id === id);
  if (index >= 0) queue.splice(index, 1);
}

function canRenderInBackground(file: FileItem): boolean {
  return Boolean(file.fullUrl && file.cacheToken) && typeof file.size === 'number' && file.size <= MAX_BACKGROUND_BYTES;
}

/**
 * Thumbnail URL for a 3D file's card, or null while none exists. While `target`
 * is on screen a stored one is loaded, and a missing one is queued for
 * background rendering.
 */
export function useModelThumbnail(file: FileItem, target: RefObject<Element | null>): string | null {
  const [, setVersion] = useState(0);
  const isModel = file.type === 'model';
  useEffect(() => {
    if (!isModel || !target.current) return;
    const { id } = file;
    const listener = () => setVersion(version => version + 1);
    const fileListeners = listeners.get(id) ?? new Set();
    fileListeners.add(listener);
    listeners.set(id, fileListeners);
    let cancelled = false;
    const show = async () => {
      if (!thumbnails.has(id)) {
        const stored = await readStored(id).catch(() => undefined);
        if (cancelled || !visible.has(id)) return;
        if (stored && !thumbnails.has(id)) remember(id, stored.blob, stored.token);
      }
      if (hasModelThumbnail(file) || !canRenderInBackground(file) || failed.get(id) === file.cacheToken) return;
      if (queue.some(queued => queued.id === id)) return;
      queue.push(file);
      void drain();
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        visible.add(id);
        void show();
      } else {
        visible.delete(id);
        dequeue(id);
      }
    });
    observer.observe(target.current);
    return () => {
      cancelled = true;
      observer.disconnect();
      visible.delete(id);
      dequeue(id);
      fileListeners.delete(listener);
      if (fileListeners.size === 0 && listeners.get(id) === fileListeners) listeners.delete(id);
    };
  }, [file, isModel, target]);
  return isModel ? currentUrl(file) : null;
}
