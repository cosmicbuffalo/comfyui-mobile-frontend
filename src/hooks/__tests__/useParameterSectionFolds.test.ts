import { beforeEach, describe, expect, it } from 'vitest';
import { useParameterSectionFoldsStore } from '../useParameterSectionFolds';

// Parameters sections default to OPEN, so the store tracks what the user has
// explicitly collapsed — the inverse of the connections fold store.
describe('useParameterSectionFolds', () => {
  beforeEach(() => {
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: [] });
  });

  const keys = () => useParameterSectionFoldsStore.getState().collapsedItemKeys;

  it('toggles a section closed and open again', () => {
    const { toggleCollapsed } = useParameterSectionFoldsStore.getState();

    toggleCollapsed('node:1');
    expect(keys()).toEqual(['node:1']);

    toggleCollapsed('node:1');
    expect(keys()).toEqual([]);
  });

  it('tracks sections independently', () => {
    const { toggleCollapsed } = useParameterSectionFoldsStore.getState();

    toggleCollapsed('node:1');
    toggleCollapsed('node:2');
    toggleCollapsed('node:1');

    expect(keys()).toEqual(['node:2']);
  });

  it('opens a collapsed section without toggling it shut', () => {
    // Used for newly created nodes, which must never appear pre-collapsed.
    const { toggleCollapsed, expand } = useParameterSectionFoldsStore.getState();
    toggleCollapsed('node:1');

    expand('node:1');
    expect(keys()).toEqual([]);

    expand('node:1');
    expect(keys()).toEqual([]);
  });

  it('keeps the same array when expanding an already-open section', () => {
    // Identity matters: a fresh array on every render would churn subscribers.
    useParameterSectionFoldsStore.setState({ collapsedItemKeys: ['node:9'] });
    const before = keys();

    useParameterSectionFoldsStore.getState().expand('node:1');

    expect(keys()).toBe(before);
  });

  it('ignores an empty item key', () => {
    const { toggleCollapsed, expand } = useParameterSectionFoldsStore.getState();

    toggleCollapsed('');
    expand('');

    expect(keys()).toEqual([]);
  });
});
