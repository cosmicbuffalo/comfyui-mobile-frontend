import { beforeEach, describe, expect, it } from 'vitest';
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
});
