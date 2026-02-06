import { describe, it, expect, beforeEach } from 'vitest';
import { useOutputsStore } from '../useOutputs';
import type { FileItem } from '@/api/client';

function makeFile(overrides: Partial<FileItem> & { id: string }): FileItem {
  return {
    name: overrides.id.split('/').pop() ?? overrides.id,
    type: 'image',
    ...overrides
  };
}

// Reset store between tests
beforeEach(() => {
  useOutputsStore.setState({
    files: [],
    filter: { search: '', favoritesOnly: false, type: 'all' },
    sort: { mode: 'modified' },
    favorites: [],
    showHidden: false,
    selectionMode: false,
    selectedIds: [],
    selectionActionOpen: false
  });
});

describe('getDisplayedFiles', () => {
  const files: FileItem[] = [
    makeFile({ id: 'a.png', name: 'alpha.png', date: 1, size: 300 }),
    makeFile({ id: 'b.mp4', name: 'beta.mp4', type: 'video', date: 3, size: 100 }),
    makeFile({ id: 'c.jpg', name: 'charlie.jpg', date: 2, size: 200 }),
    makeFile({ id: '.hidden.png', name: '.hidden.png', date: 4, size: 50 })
  ];

  it('filters hidden files by default', () => {
    useOutputsStore.setState({ files });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.every(f => !f.name.startsWith('.'))).toBe(true);
    expect(result).toHaveLength(3);
  });

  it('includes hidden files when showHidden is true', () => {
    useOutputsStore.setState({ files, showHidden: true });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(4);
  });

  it('filters by search term', () => {
    useOutputsStore.setState({
      files,
      filter: { search: 'alpha', favoritesOnly: false, type: 'all' }
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('alpha.png');
  });

  it('search is case-insensitive', () => {
    useOutputsStore.setState({
      files,
      filter: { search: 'BETA', favoritesOnly: false, type: 'all' }
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('beta.mp4');
  });

  it('filters by favorites', () => {
    useOutputsStore.setState({
      files,
      favorites: ['a.png'],
      filter: { search: '', favoritesOnly: true, type: 'all' }
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a.png');
  });

  it('filters by type', () => {
    useOutputsStore.setState({
      files,
      filter: { search: '', favoritesOnly: false, type: 'video' }
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('video');
  });

  it('folders pass through type filter', () => {
    const withFolder = [...files, makeFile({ id: 'folder1', name: 'folder1', type: 'folder' })];
    useOutputsStore.setState({
      files: withFolder,
      filter: { search: '', favoritesOnly: false, type: 'video' }
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    const types = result.map(f => f.type);
    expect(types).toContain('video');
    expect(types).toContain('folder');
  });

  it('sorts by name ascending', () => {
    useOutputsStore.setState({ files, sort: { mode: 'name' } });
    const names = useOutputsStore.getState().getDisplayedFiles().map(f => f.name);
    expect(names).toEqual(['alpha.png', 'beta.mp4', 'charlie.jpg']);
  });

  it('sorts by name descending', () => {
    useOutputsStore.setState({ files, sort: { mode: 'name-reverse' } });
    const names = useOutputsStore.getState().getDisplayedFiles().map(f => f.name);
    expect(names).toEqual(['charlie.jpg', 'beta.mp4', 'alpha.png']);
  });

  it('sorts by size ascending', () => {
    useOutputsStore.setState({ files, sort: { mode: 'size' } });
    const sizes = useOutputsStore.getState().getDisplayedFiles().map(f => f.size);
    expect(sizes).toEqual([100, 200, 300]);
  });

  it('sorts by size descending', () => {
    useOutputsStore.setState({ files, sort: { mode: 'size-reverse' } });
    const sizes = useOutputsStore.getState().getDisplayedFiles().map(f => f.size);
    expect(sizes).toEqual([300, 200, 100]);
  });

  it('sorts by modified date ascending', () => {
    useOutputsStore.setState({ files, sort: { mode: 'modified' } });
    const dates = useOutputsStore.getState().getDisplayedFiles().map(f => f.date);
    expect(dates).toEqual([1, 2, 3]);
  });

  it('sorts by modified date descending', () => {
    useOutputsStore.setState({ files, sort: { mode: 'modified-reverse' } });
    const dates = useOutputsStore.getState().getDisplayedFiles().map(f => f.date);
    expect(dates).toEqual([3, 2, 1]);
  });
});

describe('toggleFavorite', () => {
  it('adds a favorite', () => {
    useOutputsStore.getState().toggleFavorite('file1');
    expect(useOutputsStore.getState().favorites).toContain('file1');
  });

  it('removes a favorite on second toggle', () => {
    useOutputsStore.getState().toggleFavorite('file1');
    useOutputsStore.getState().toggleFavorite('file1');
    expect(useOutputsStore.getState().favorites).not.toContain('file1');
  });
});

describe('selection', () => {
  it('toggleSelection adds and removes ids', () => {
    useOutputsStore.getState().toggleSelection('a');
    expect(useOutputsStore.getState().selectedIds).toEqual(['a']);

    useOutputsStore.getState().toggleSelection('b');
    expect(useOutputsStore.getState().selectedIds).toEqual(['a', 'b']);

    useOutputsStore.getState().toggleSelection('a');
    expect(useOutputsStore.getState().selectedIds).toEqual(['b']);
  });

  it('selectIds adds ids in add mode', () => {
    useOutputsStore.setState({ selectedIds: ['a'] });
    useOutputsStore.getState().selectIds(['b', 'c']);
    expect(useOutputsStore.getState().selectedIds).toEqual(['a', 'b', 'c']);
  });

  it('selectIds replaces ids in replace mode', () => {
    useOutputsStore.setState({ selectedIds: ['a'] });
    useOutputsStore.getState().selectIds(['b', 'c'], 'replace');
    expect(useOutputsStore.getState().selectedIds).toEqual(['b', 'c']);
  });

  it('clearSelection empties selection and closes action menu', () => {
    useOutputsStore.setState({ selectedIds: ['a', 'b'], selectionActionOpen: true });
    useOutputsStore.getState().clearSelection();
    expect(useOutputsStore.getState().selectedIds).toEqual([]);
    expect(useOutputsStore.getState().selectionActionOpen).toBe(false);
  });
});

describe('toggleSelectionMode', () => {
  it('resets selection state when toggling', () => {
    useOutputsStore.setState({
      selectionMode: false,
      selectedIds: ['a'],
      selectionActionOpen: true
    });
    useOutputsStore.getState().toggleSelectionMode();
    expect(useOutputsStore.getState().selectionMode).toBe(true);
    expect(useOutputsStore.getState().selectedIds).toEqual([]);
    expect(useOutputsStore.getState().selectionActionOpen).toBe(false);
  });
});
