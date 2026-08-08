import { beforeEach, describe, expect, it } from 'vitest';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';

beforeEach(() => {
  useConnectionSectionFoldsStore.setState({ collapsedItemKeys: [] });
});

describe('useConnectionSectionFoldsStore', () => {
  it('defaults connection sections to open (nothing collapsed)', () => {
    expect(useConnectionSectionFoldsStore.getState().collapsedItemKeys).toEqual([]);
  });

  it('toggles a section between collapsed and open', () => {
    const { toggleCollapsed } = useConnectionSectionFoldsStore.getState();
    toggleCollapsed('node-key');
    expect(useConnectionSectionFoldsStore.getState().collapsedItemKeys).toEqual(['node-key']);
    toggleCollapsed('node-key');
    expect(useConnectionSectionFoldsStore.getState().collapsedItemKeys).toEqual([]);
  });

  it('expands idempotently: reopens a collapsed section and is a no-op when open', () => {
    const { toggleCollapsed, expand } = useConnectionSectionFoldsStore.getState();
    // Collapse first, then expand should reopen it.
    toggleCollapsed('node-key');
    expand('node-key');
    expect(useConnectionSectionFoldsStore.getState().collapsedItemKeys).toEqual([]);
    // Expanding an already-open section is a no-op (never collapses).
    expand('node-key');
    expect(useConnectionSectionFoldsStore.getState().collapsedItemKeys).toEqual([]);
  });
});
