import type { NodeTypes } from '@/api/types';

// On-device cache for the node-type definitions (`/api/object_info`). That
// payload can be several MB on instances with many custom node packs, so we
// stash it in IndexedDB (localStorage can't reliably hold multi-MB values) and
// load it cache-first on startup, revalidating from the network in the
// background. Storing the parsed object also avoids re-running JSON.parse on the
// next load — IndexedDB returns a structured clone.

const DB_NAME = 'comfyui-mobile-cache';
const DB_VERSION = 1;
const STORE_NAME = 'kv';
const NODE_TYPES_KEY = 'nodeTypes';

interface CachedNodeTypes {
  types: NodeTypes;
  cachedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Returns the cached node types, or null if absent/unavailable. Never throws —
// caching is best-effort, so a failure just means "fetch fresh".
export async function getCachedNodeTypes(): Promise<NodeTypes | null> {
  try {
    const db = await openDb();
    try {
      return await new Promise<NodeTypes | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(NODE_TYPES_KEY);
        req.onsuccess = () => {
          const value = req.result as CachedNodeTypes | undefined;
          resolve(value?.types ?? null);
        };
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

// Persists the latest node types. Best-effort: quota/availability errors are
// swallowed so a cache write can never break the app.
export async function setCachedNodeTypes(types: NodeTypes): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const entry: CachedNodeTypes = { types, cachedAt: Date.now() };
        tx.objectStore(STORE_NAME).put(entry, NODE_TYPES_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore — the network revalidation still populated the store.
  }
}
