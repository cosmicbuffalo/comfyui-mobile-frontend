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

// jsdom doesn't implement the CSS interface, so `CSS.escape` — which every
// browser we ship to has had for years, and which selector-building code like
// QueuePanel's flashQueueCard uses — throws here. Escaping the characters that
// are actually illegal in an identifier is enough for test ids.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalWithCSS = globalThis as any;
if (typeof globalWithCSS.CSS === 'undefined') {
  globalWithCSS.CSS = {};
}
if (typeof globalWithCSS.CSS.escape !== 'function') {
  globalWithCSS.CSS.escape = (value: string) =>
    String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

// React 19 act() environment hint for non-testing-library render tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
