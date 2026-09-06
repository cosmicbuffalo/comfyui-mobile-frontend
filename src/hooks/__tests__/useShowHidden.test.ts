import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useShowHiddenStore } from '@/hooks/useShowHidden';

describe('useShowHiddenStore', () => {
  beforeEach(() => {
    useShowHiddenStore.setState({ showHidden: false });
  });

  it('provides one toggle shared by every consumer', () => {
    useShowHiddenStore.getState().toggleShowHidden();
    expect(useShowHiddenStore.getState().showHidden).toBe(true);

    useShowHiddenStore.getState().setShowHidden(false);
    expect(useShowHiddenStore.getState().showHidden).toBe(false);
  });

  it('persists and rehydrates the preference for the next page load', async () => {
    useShowHiddenStore.getState().setShowHidden(true);

    const persisted = JSON.parse(localStorage.getItem('show-hidden-storage') ?? '{}');
    expect(persisted.state).toEqual({ showHidden: true });

    useShowHiddenStore.setState({ showHidden: false });
    localStorage.setItem('show-hidden-storage', JSON.stringify(persisted));
    await useShowHiddenStore.persist.rehydrate();
    expect(useShowHiddenStore.getState().showHidden).toBe(true);
  });

  it('still loads when the browser refuses to persist', async () => {
    // iOS Safari in private browsing reads storage fine and throws on every
    // write. The legacy-preference migration commits at import time, so an
    // unguarded write there would blank the app instead of only losing the
    // preference.
    //
    // Substitute the whole global rather than spying on a method: this suite
    // runs against jsdom's Storage in CI, where setItem is inherited from a
    // proxied prototype, and against the plain-object shim in vitest.setup.ts
    // locally, where it is an own property. No single spy target bites in both,
    // and the one that missed read as a pass.
    const backing = new Map([
      ['outputs-storage', JSON.stringify({ state: { showHidden: true } })],
    ]);
    let refusedWrites = 0;
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: () => {
        refusedWrites += 1;
        throw new DOMException('exceeded the quota', 'QuotaExceededError');
      },
      removeItem: (key: string) => { backing.delete(key); },
      clear: () => { backing.clear(); },
      key: () => null,
      get length() { return backing.size; },
    });
    vi.resetModules();

    try {
      const { useShowHiddenStore: store } = await import('@/hooks/useShowHidden');
      // The migration write is the crash path, so prove it was attempted —
      // otherwise a storage that quietly stopped refusing would leave this
      // asserting nothing.
      expect(refusedWrites).toBeGreaterThan(0);
      expect(store.getState().showHidden).toBe(true);
      expect(() => store.getState().toggleShowHidden()).not.toThrow();
      expect(store.getState().showHidden).toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
