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
    localStorage.clear();
    localStorage.setItem('outputs-storage', JSON.stringify({ state: { showHidden: true } }));
    vi.resetModules();
    // Spy on the object, not Storage.prototype: under the setup file's
    // fallback shim these are own properties and a prototype spy never fires.
    const refuseWrites = vi
      .spyOn(localStorage, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('exceeded the quota', 'QuotaExceededError');
      });

    try {
      const { useShowHiddenStore: store } = await import('@/hooks/useShowHidden');
      // The migration write is the crash path; assert it was really attempted
      // so a spy that stops biting can't quietly turn this into a no-op.
      expect(refuseWrites).toHaveBeenCalledWith('show-hidden-storage', expect.any(String));
      expect(store.getState().showHidden).toBe(true);
      expect(() => store.getState().toggleShowHidden()).not.toThrow();
      expect(store.getState().showHidden).toBe(false);
    } finally {
      refuseWrites.mockRestore();
      localStorage.clear();
    }
  });
});
