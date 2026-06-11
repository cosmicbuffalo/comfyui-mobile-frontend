import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOutputsStore } from '../useOutputs';
import type { FileItem } from '@/api/client';

// switchToTab triggers a refetch; stub the network so the store logic runs in
// isolation without hitting fetch.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    getUserImages: vi.fn(async () => []),
    getUserImageFolders: vi.fn(async () => ({ input: [], output: [] })),
  };
});

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
    source: 'output',
    currentFolder: null,
    files: [],
    filter: { search: '', favoritesOnly: false, type: 'all' },
    sort: { mode: 'modified' },
    favorites: [],
    showHidden: false,
    promptSearchActive: false,
    promptSearchResults: [],
    promptSearchQuery: '',
    promptSearchLoading: false,
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

  it('sorts by modified date descending (newest first)', () => {
    useOutputsStore.setState({ files, sort: { mode: 'modified' } });
    const dates = useOutputsStore.getState().getDisplayedFiles().map(f => f.date);
    expect(dates).toEqual([3, 2, 1]);
  });

  it('sorts by modified date ascending (oldest first)', () => {
    useOutputsStore.setState({ files, sort: { mode: 'modified-reverse' } });
    const dates = useOutputsStore.getState().getDisplayedFiles().map(f => f.date);
    expect(dates).toEqual([1, 2, 3]);
  });
});

describe('markItemHiddenLocally', () => {
  it('removes a newly hidden file from a visible-only output listing', () => {
    useOutputsStore.setState({
      files: [makeFile({ id: 'output/private.png' })],
      showHidden: false,
    });

    useOutputsStore.getState().markItemHiddenLocally('output/private.png');

    expect(useOutputsStore.getState().files).toEqual([]);
  });

  it('keeps and marks a newly hidden file when hidden files are shown', () => {
    useOutputsStore.setState({
      files: [makeFile({ id: 'output/private.png' })],
      showHidden: true,
    });

    useOutputsStore.getState().markItemHiddenLocally('output/private.png');

    expect(useOutputsStore.getState().files[0]).toMatchObject({
      id: 'output/private.png',
      hidden: true,
      hiddenSelf: true,
    });
  });
});

describe('getDisplayedFiles with promptSearchActive', () => {
  function mkMatch(relPath: string, date = 1000): FileItem {
    const name = relPath.split('/').pop()!;
    return { id: `output/${relPath}`, name, type: 'image', date };
  }

  it('at root: projects hidden-folder matches as a synthetic top-level folder when showHidden=true', () => {
    useOutputsStore.setState({
      source: 'output',
      currentFolder: null,
      showHidden: true,
      promptSearchActive: true,
      promptSearchQuery: 'needle',
      promptSearchResults: [
        mkMatch('.hidden-folder/inner-folder/file-a.png'),
        mkMatch('.hidden-folder/inner-folder/file-b.png'),
        mkMatch('.hidden-folder/inner-folder/file-c.png'),
      ],
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('folder');
    expect(result[0].name).toBe('.hidden-folder');
    expect(result[0].id).toBe('output/.hidden-folder');
    expect(result[0].matchCount).toBe(3);
  });

  it('at root: hides hidden-folder synthetic when showHidden=false', () => {
    useOutputsStore.setState({
      source: 'output',
      currentFolder: null,
      showHidden: false,
      promptSearchActive: true,
      promptSearchQuery: 'needle',
      promptSearchResults: [mkMatch('.hidden-folder/inner-folder/file-a.png')],
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(0);
  });

  it('hides prompt matches inside hidden descendant folders when showHidden=false', () => {
    useOutputsStore.setState({
      source: 'output',
      currentFolder: 'visible-folder',
      showHidden: false,
      promptSearchActive: true,
      promptSearchQuery: 'needle',
      promptSearchResults: [
        mkMatch('visible-folder/.hidden-child/file-a.png'),
        mkMatch('visible-folder/public-child/file-b.png'),
      ],
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.map(f => f.name)).toEqual(['public-child']);
  });

  it('one level deep: synthetic for child folder shows when navigated into hidden parent', () => {
    useOutputsStore.setState({
      source: 'output',
      currentFolder: '.hidden-folder',
      showHidden: true,
      promptSearchActive: true,
      promptSearchQuery: 'needle',
      promptSearchResults: [
        mkMatch('.hidden-folder/inner-folder/file-a.png'),
        mkMatch('.hidden-folder/inner-folder/file-b.png'),
        mkMatch('.hidden-folder/other-folder/file-c.png'),
      ],
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.map(f => f.name).sort()).toEqual(['inner-folder', 'other-folder']);
    expect(result.every(f => f.type === 'folder')).toBe(true);
  });

  it('leaf folder: returns direct matching files only', () => {
    useOutputsStore.setState({
      source: 'output',
      currentFolder: '.hidden-folder/inner-folder',
      showHidden: true,
      promptSearchActive: true,
      promptSearchQuery: 'needle',
      promptSearchResults: [
        mkMatch('.hidden-folder/inner-folder/file-a.png'),
        mkMatch('.hidden-folder/inner-folder/file-b.png'),
        mkMatch('.hidden-folder/other-folder/file-c.png'), // sibling — should be excluded
      ],
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.map(f => f.name).sort()).toEqual(['file-a.png', 'file-b.png']);
  });

  it('does NOT include the regular files array when promptSearchActive', () => {
    useOutputsStore.setState({
      source: 'output',
      currentFolder: null,
      showHidden: false,
      files: [
        { id: 'output/regular1.png', name: 'regular1.png', type: 'image', date: 1 },
        { id: 'output/regular2.png', name: 'regular2.png', type: 'image', date: 2 },
      ],
      promptSearchActive: true,
      promptSearchQuery: 'needle',
      promptSearchResults: [mkMatch('some-folder/match.png')],
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.map(f => f.name)).not.toContain('regular1.png');
    expect(result.map(f => f.name)).not.toContain('regular2.png');
    expect(result.map(f => f.name)).toEqual(['some-folder']);
  });

  it('ignores folder entries returned by a prompt-search API response', () => {
    useOutputsStore.setState({
      source: 'output',
      currentFolder: null,
      showHidden: true,
      files: [],
      promptSearchActive: true,
      promptSearchQuery: 'needle',
      promptSearchResults: [
        { id: 'output/video', name: 'video', type: 'folder', date: 1 },
        { id: 'output/upscales', name: 'upscales', type: 'folder', date: 1 },
        mkMatch('.hidden/batch/sample scene/file-a.png'),
      ],
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.map(f => f.name)).toEqual(['.hidden']);
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

describe('persistence', () => {
  it('does not persist search text across page refreshes', () => {
    localStorage.removeItem('outputs-storage');
    useOutputsStore.getState().setFilter({
      search: 'sample scene',
      favoritesOnly: true,
      type: 'video',
    });

    const raw = localStorage.getItem('outputs-storage');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!);
    expect(persisted.state.filter).toEqual({
      search: '',
      favoritesOnly: true,
      type: 'video',
    });
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

describe('multi-tab selection', () => {
  it('carries the selection across tabs that share the active source, accumulating across folders', () => {
    useOutputsStore.setState({
      source: 'output',
      currentFolder: 'folderA',
      tabs: [
        { id: 'tab1', source: 'output', folder: 'folderA' },
        { id: 'tab2', source: 'output', folder: 'folderB' },
      ],
      activeTabId: 'tab1',
      selectionMode: true,
      selectedIds: ['output/folderA/x.png'],
    });

    // Hop to the other (same-source) tab — selection survives the switch.
    useOutputsStore.getState().switchToTab('tab2');
    expect(useOutputsStore.getState().activeTabId).toBe('tab2');
    expect(useOutputsStore.getState().currentFolder).toBe('folderB');
    expect(useOutputsStore.getState().selectionMode).toBe(true);
    expect(useOutputsStore.getState().selectedIds).toEqual(['output/folderA/x.png']);

    // Add an item from this tab's folder to the shared selection.
    useOutputsStore.getState().toggleSelection('output/folderB/y.png');
    expect(useOutputsStore.getState().selectedIds).toEqual([
      'output/folderA/x.png',
      'output/folderB/y.png',
    ]);

    // Switching back keeps both, and removing one affects the shared selection.
    useOutputsStore.getState().switchToTab('tab1');
    expect(useOutputsStore.getState().selectedIds).toEqual([
      'output/folderA/x.png',
      'output/folderB/y.png',
    ]);
    useOutputsStore.getState().toggleSelection('output/folderA/x.png');
    expect(useOutputsStore.getState().selectedIds).toEqual(['output/folderB/y.png']);
  });

  it('resets the selection when switching to a tab in a different source', () => {
    useOutputsStore.setState({
      source: 'output',
      currentFolder: 'folderA',
      tabs: [
        { id: 'tab1', source: 'output', folder: 'folderA' },
        { id: 'tab2', source: 'input', folder: 'imports' },
      ],
      activeTabId: 'tab1',
      selectionMode: true,
      selectedIds: ['output/folderA/x.png'],
    });

    useOutputsStore.getState().switchToTab('tab2');
    expect(useOutputsStore.getState().source).toBe('input');
    expect(useOutputsStore.getState().selectionMode).toBe(false);
    expect(useOutputsStore.getState().selectedIds).toEqual([]);
  });
});
