// Ensure localStorage is available for modules that use it at import time.
// Node 22+ exposes a built-in localStorage that may not work correctly in
// all environments; jsdom provides its own, but we need a fallback for
// cases where neither is fully functional.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.getItem !== 'function') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null
  } as Storage;
}
