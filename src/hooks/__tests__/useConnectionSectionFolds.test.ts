import { beforeEach, describe, expect, it } from 'vitest';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';

beforeEach(() => {
  useConnectionSectionFoldsStore.setState({ expandedItemKeys: [] });
});

describe('useConnectionSectionFoldsStore', () => {
  it('defaults connection sections to folded', () => {
    expect(useConnectionSectionFoldsStore.getState().expandedItemKeys).toEqual([]);
  });

  it('toggles an explicitly expanded connection section', () => {
    const { toggleExpanded } = useConnectionSectionFoldsStore.getState();
    toggleExpanded('node-key');
    expect(useConnectionSectionFoldsStore.getState().expandedItemKeys).toEqual(['node-key']);
    toggleExpanded('node-key');
    expect(useConnectionSectionFoldsStore.getState().expandedItemKeys).toEqual([]);
  });

  it('expands idempotently without folding an already-open section', () => {
    const { expand } = useConnectionSectionFoldsStore.getState();
    expand('node-key');
    expect(useConnectionSectionFoldsStore.getState().expandedItemKeys).toEqual(['node-key']);
    // Calling expand again on an already-open section is a no-op (never folds).
    expand('node-key');
    expect(useConnectionSectionFoldsStore.getState().expandedItemKeys).toEqual(['node-key']);
  });
});
