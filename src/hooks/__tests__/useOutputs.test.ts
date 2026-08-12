import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushFileStateMutations, useOutputsStore } from '../useOutputs';
import {
  loadFileState,
  searchUserImagesByPrompt,
  setFileState,
  type FileItem,
} from '@/api/client';

// switchToTab triggers a refetch; stub the network so the store logic runs in
// isolation without hitting fetch.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    getUserImages: vi.fn(async () => []),
    getUserImageFolders: vi.fn(async () => ({ input: [], output: [] })),
    loadFileState: vi.fn(async () => ({ favorite: [], reject: [], hidden: [] })),
    searchUserImagesByPrompt: vi.fn(async () => []),
    setFileState: vi.fn(async () => undefined),
  };
});

const mockLoadFileState = vi.mocked(loadFileState);
const mockSearchUserImagesByPrompt = vi.mocked(searchUserImagesByPrompt);
const mockSetFileState = vi.mocked(setFileState);

function makeFile(overrides: Partial<FileItem> & { id: string }): FileItem {
  return {
    name: overrides.id.split('/').pop() ?? overrides.id,
    type: 'image',
    ...overrides
  };
}

// Reset store between tests
beforeEach(async () => {
  await flushFileStateMutations();
  mockLoadFileState.mockClear();
  mockLoadFileState.mockResolvedValue({ favorite: [], reject: [], hidden: [] });
  mockSearchUserImagesByPrompt.mockClear();
  mockSearchUserImagesByPrompt.mockResolvedValue([]);
  mockSetFileState.mockClear();
  mockSetFileState.mockResolvedValue(undefined);
  useOutputsStore.setState({
    source: 'output',
    currentFolder: null,
    files: [],
    filter: { search: '', favoritesMode: 'off', rejectsMode: 'off', type: 'all' },
    sort: { mode: 'modified' },
    favorites: [],
    rejected: [],
    migratedFavoriteSources: [],
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
      filter: { search: 'alpha', favoritesMode: 'off', rejectsMode: 'off', type: 'all' }
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('alpha.png');
  });

  it('search is case-insensitive', () => {
    useOutputsStore.setState({
      files,
      filter: { search: 'BETA', favoritesMode: 'off', rejectsMode: 'off', type: 'all' }
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('beta.mp4');
  });

  it('filters by favorites', () => {
    useOutputsStore.setState({
      files,
      favorites: ['a.png'],
      filter: { search: '', favoritesMode: 'only', rejectsMode: 'off', type: 'all' }
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a.png');
  });

  // Favorites live at every depth, but the grid lists one folder at a time — so
  // the filter has to leave the folders that lead to them standing.
  describe('favorites filter with nested favorites', () => {
    const listing: FileItem[] = [
      makeFile({ id: 'output/album', name: 'album', type: 'folder', count: 12 }),
      makeFile({ id: 'output/empty', name: 'empty', type: 'folder', count: 4 }),
      makeFile({ id: 'output/loose.png', name: 'loose.png' }),
      makeFile({ id: 'output/plain.png', name: 'plain.png' }),
    ];

    it('keeps folders holding a favorite at any depth, labelled with the count', () => {
      useOutputsStore.setState({
        files: listing,
        favorites: [
          'output/loose.png',
          'output/album/day-one/first.png',
          'output/album/day-two/second.png',
        ],
        filter: { search: '', favoritesMode: 'only', rejectsMode: 'off', type: 'all' },
      });
      const result = useOutputsStore.getState().getDisplayedFiles();
      expect(result.map((f) => f.id).sort()).toEqual(['output/album', 'output/loose.png']);
      expect(result.find((f) => f.id === 'output/album')?.favoriteCount).toBe(2);
    });

    it('keeps a favorited folder with nothing favorited inside it', () => {
      useOutputsStore.setState({
        files: listing,
        favorites: ['output/empty'],
        filter: { search: '', favoritesMode: 'only', rejectsMode: 'off', type: 'all' },
      });
      const result = useOutputsStore.getState().getDisplayedFiles();
      expect(result.map((f) => f.id)).toEqual(['output/empty']);
      // Favorited in its own right, so it keeps its normal item subtitle.
      expect(result[0].favoriteCount).toBeUndefined();
    });

    it('ignores favorites the current view cannot reach', () => {
      // The only favorite sits behind a dot-folder, so with hidden items off the
      // parent would open onto an empty grid.
      useOutputsStore.setState({
        files: listing,
        favorites: ['output/album/.private/secret.png'],
        filter: { search: '', favoritesMode: 'only', rejectsMode: 'off', type: 'all' },
      });
      expect(useOutputsStore.getState().getDisplayedFiles()).toHaveLength(0);

      useOutputsStore.setState({ showHidden: true });
      const shown = useOutputsStore.getState().getDisplayedFiles();
      expect(shown.map((f) => f.id)).toEqual(['output/album']);
      expect(shown[0].favoriteCount).toBe(1);
    });

    it('scopes the walk to the folder being viewed', () => {
      useOutputsStore.setState({
        files: [makeFile({ id: 'output/album/day-one', name: 'day-one', type: 'folder', count: 3 })],
        currentFolder: 'album',
        favorites: ['output/album/day-one/first.png', 'output/other/elsewhere.png'],
        filter: { search: '', favoritesMode: 'only', rejectsMode: 'off', type: 'all' },
      });
      const result = useOutputsStore.getState().getDisplayedFiles();
      expect(result.map((f) => f.id)).toEqual(['output/album/day-one']);
      expect(result[0].favoriteCount).toBe(1);
    });
  });

  it('filters to rejects and keeps folders containing nested rejects', () => {
    useOutputsStore.setState({
      files: [
        makeFile({ id: 'output/album', name: 'album', type: 'folder', count: 8 }),
        makeFile({ id: 'output/loose.png', name: 'loose.png' }),
        makeFile({ id: 'output/plain.png', name: 'plain.png' }),
      ],
      rejected: [
        'output/album/day-one/bad.png',
        'output/album/day-two/worse.png',
        'output/loose.png',
      ],
      filter: { search: '', favoritesMode: 'off', rejectsMode: 'only', type: 'all' },
    });

    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.map((file) => file.id).sort()).toEqual(['output/album', 'output/loose.png']);
    expect(result.find((file) => file.id === 'output/album')?.rejectCount).toBe(2);
  });

  describe('status filter cycling', () => {
    const modes = () => {
      const { favoritesMode, rejectsMode } = useOutputsStore.getState().filter;
      return [favoritesMode, rejectsMode];
    };
    const click = (key: 'favoritesMode' | 'rejectsMode') =>
      useOutputsStore.getState().cycleStatusFilter(key);

    it('cycles one button off → only → exclude → off', () => {
      expect(modes()).toEqual(['off', 'off']);
      click('rejectsMode');
      expect(modes()).toEqual(['off', 'only']);
      click('rejectsMode');
      expect(modes()).toEqual(['off', 'exclude']);
      click('rejectsMode');
      expect(modes()).toEqual(['off', 'off']);
    });

    it('switches between the two narrowed subsets rather than stacking them', () => {
      click('favoritesMode');
      expect(modes()).toEqual(['only', 'off']);
      click('rejectsMode');
      // only + only is always an empty listing, so the previous one turns off.
      expect(modes()).toEqual(['off', 'only']);
      click('favoritesMode');
      expect(modes()).toEqual(['only', 'off']);
    });

    it('joins the other filter at exclude so both can be hidden at once', () => {
      click('favoritesMode');
      click('favoritesMode');
      expect(modes()).toEqual(['exclude', 'off']);
      // Skips `only`, which would be redundant against an excluding partner.
      click('rejectsMode');
      expect(modes()).toEqual(['exclude', 'exclude']);
    });

    it('drops one side of exclude-both without disturbing the other', () => {
      click('favoritesMode');
      click('favoritesMode');
      click('rejectsMode');
      expect(modes()).toEqual(['exclude', 'exclude']);

      click('favoritesMode');
      expect(modes()).toEqual(['off', 'exclude']);
      // And back again, since the partner is still excluding.
      click('favoritesMode');
      expect(modes()).toEqual(['exclude', 'exclude']);
    });
  });

  it('excludes the status subset while leaving folders navigable', () => {
    useOutputsStore.setState({
      files: [
        makeFile({ id: 'output/keep.png', name: 'keep.png' }),
        makeFile({ id: 'output/nope.png', name: 'nope.png' }),
        makeFile({ id: 'output/album', name: 'album', type: 'folder', count: 4 }),
      ],
      rejected: ['output/nope.png', 'output/album/inner.png'],
      filter: { search: '', favoritesMode: 'off', rejectsMode: 'exclude', type: 'all' },
    });

    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.map((file) => file.id).sort()).toEqual(['output/album', 'output/keep.png']);
    // Excluding never annotates folders with a subset count.
    expect(result.find((file) => file.id === 'output/album')?.rejectCount).toBeUndefined();
  });

  it('excludes favorites and rejects together', () => {
    useOutputsStore.setState({
      files: [
        makeFile({ id: 'output/plain.png', name: 'plain.png' }),
        makeFile({ id: 'output/loved.png', name: 'loved.png' }),
        makeFile({ id: 'output/nope.png', name: 'nope.png' }),
      ],
      favorites: ['output/loved.png'],
      rejected: ['output/nope.png'],
      filter: { search: '', favoritesMode: 'exclude', rejectsMode: 'exclude', type: 'all' },
    });

    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.map((file) => file.id)).toEqual(['output/plain.png']);
  });

  it('drops a folder that is itself favorited when excluding favorites', () => {
    useOutputsStore.setState({
      files: [
        makeFile({ id: 'output/loved-folder', name: 'loved-folder', type: 'folder', count: 3 }),
        makeFile({ id: 'output/plain-folder', name: 'plain-folder', type: 'folder', count: 3 }),
      ],
      // A folder can be favorited but never rejected, so only the favorites
      // side of exclude has a folder to drop.
      favorites: ['output/loved-folder'],
      rejected: [],
      filter: { search: '', favoritesMode: 'exclude', rejectsMode: 'off', type: 'all' },
    });

    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result.map((file) => file.id)).toEqual(['output/plain-folder']);
  });

  it('filters by type', () => {
    useOutputsStore.setState({
      files,
      filter: { search: '', favoritesMode: 'off', rejectsMode: 'off', type: 'video' }
    });
    const result = useOutputsStore.getState().getDisplayedFiles();
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('video');
  });

  it('folders pass through type filter', () => {
    const withFolder = [...files, makeFile({ id: 'folder1', name: 'folder1', type: 'folder' })];
    useOutputsStore.setState({
      files: withFolder,
      filter: { search: '', favoritesMode: 'off', rejectsMode: 'off', type: 'video' }
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

  it('sorts independently by created and modified dates', () => {
    const dated = [
      makeFile({ id: 'a.png', createdDate: 10, modifiedDate: 300 }),
      makeFile({ id: 'b.png', createdDate: 30, modifiedDate: 100 }),
      makeFile({ id: 'c.png', createdDate: 20, modifiedDate: 200 }),
    ];
    useOutputsStore.setState({ files: dated, sort: { mode: 'created' } });
    expect(useOutputsStore.getState().getDisplayedFiles().map((file) => file.id))
      .toEqual(['b.png', 'c.png', 'a.png']);

    useOutputsStore.setState({ sort: { mode: 'modified' } });
    expect(useOutputsStore.getState().getDisplayedFiles().map((file) => file.id))
      .toEqual(['a.png', 'c.png', 'b.png']);
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

describe('favorite/reject mutual exclusivity', () => {
  const ID = 'output/a.png';

  it('immediately updates modified dates for the changed file and its folders', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(999);
    useOutputsStore.setState({
      files: [
        makeFile({ id: 'output/album', type: 'folder', modifiedDate: 10 }),
        makeFile({ id: 'output/album/a.png', modifiedDate: 20 }),
        makeFile({ id: 'output/other', type: 'folder', modifiedDate: 30 }),
      ],
    });

    useOutputsStore.getState().toggleRejected('output/album/a.png');

    const byId = new Map(useOutputsStore.getState().files.map((item) => [item.id, item]));
    expect(byId.get('output/album')).toMatchObject({ date: 999, modifiedDate: 999 });
    expect(byId.get('output/album/a.png')).toMatchObject({ date: 999, modifiedDate: 999 });
    expect(byId.get('output/other')?.modifiedDate).toBe(30);
    nowSpy.mockRestore();
  });

  it('favoriteItem is idempotent and never duplicates', () => {
    const { favoriteItem } = useOutputsStore.getState();
    favoriteItem(ID);
    favoriteItem(ID);
    expect(useOutputsStore.getState().favorites).toEqual([ID]);
  });

  it('favoriteItem clears a prior rejected mark and persists the favorite server-side', () => {
    useOutputsStore.setState({ rejected: [ID] });
    useOutputsStore.getState().favoriteItem(ID);
    const s = useOutputsStore.getState();
    expect(s.favorites).toContain(ID);
    expect(s.rejected).not.toContain(ID);
    expect(mockSetFileState).toHaveBeenCalledWith('output', 'a.png', 'favorite', true);
  });

  it('toggleRejected clears a prior favorite and toggles off on repeat, persisting both transitions', async () => {
    useOutputsStore.setState({ favorites: [ID] });
    useOutputsStore.getState().toggleRejected(ID);
    let s = useOutputsStore.getState();
    expect(s.rejected).toContain(ID);
    expect(s.favorites).not.toContain(ID);
    expect(mockSetFileState).toHaveBeenCalledWith('output', 'a.png', 'reject', true);

    useOutputsStore.getState().toggleRejected(ID);
    s = useOutputsStore.getState();
    expect(s.rejected).not.toContain(ID);
    await vi.waitFor(() => {
      expect(mockSetFileState).toHaveBeenCalledWith('output', 'a.png', 'reject', false);
    });
  });

  it('serializes rapid mutations for one file so the final click reaches the server last', async () => {
    let resolveFirst!: () => void;
    mockSetFileState.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFirst = resolve;
    }));

    useOutputsStore.getState().toggleRejected(ID);
    useOutputsStore.getState().toggleRejected(ID);

    expect(mockSetFileState).toHaveBeenCalledTimes(1);
    expect(mockSetFileState).toHaveBeenNthCalledWith(1, 'output', 'a.png', 'reject', true);

    resolveFirst();
    await vi.waitFor(() => expect(mockSetFileState).toHaveBeenCalledTimes(2));
    expect(mockSetFileState).toHaveBeenNthCalledWith(2, 'output', 'a.png', 'reject', false);
  });

  it('uses the same per-file queue across favorite and reject mutations', async () => {
    let resolveFavorite!: () => void;
    mockSetFileState.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFavorite = resolve;
    }));

    useOutputsStore.getState().favoriteItem(ID);
    useOutputsStore.getState().toggleRejected(ID);

    expect(mockSetFileState).toHaveBeenCalledTimes(1);
    expect(mockSetFileState).toHaveBeenNthCalledWith(1, 'output', 'a.png', 'favorite', true);

    resolveFavorite();
    await vi.waitFor(() => expect(mockSetFileState).toHaveBeenCalledTimes(2));
    expect(mockSetFileState).toHaveBeenNthCalledWith(2, 'output', 'a.png', 'reject', true);
  });

  it('unfavoriteItem removes only from favorites and persists the removal server-side', () => {
    useOutputsStore.setState({ favorites: [ID] });
    useOutputsStore.getState().unfavoriteItem(ID);
    expect(useOutputsStore.getState().favorites).not.toContain(ID);
    expect(mockSetFileState).toHaveBeenCalledWith('output', 'a.png', 'favorite', false);
  });

  it('toggleFavorite clears rejected when favoriting and persists the favorite server-side', () => {
    useOutputsStore.setState({ rejected: [ID] });
    useOutputsStore.getState().toggleFavorite(ID);
    const s = useOutputsStore.getState();
    expect(s.favorites).toContain(ID);
    expect(s.rejected).not.toContain(ID);
    expect(mockSetFileState).toHaveBeenCalledWith('output', 'a.png', 'favorite', true);
  });

  it('clearRejected empties the rejected set and persists a reject=false for every cleared id', () => {
    useOutputsStore.setState({ rejected: ['output/a.png', 'output/b.png'] });
    useOutputsStore.getState().clearRejected();
    expect(useOutputsStore.getState().rejected).toEqual([]);
    expect(mockSetFileState).toHaveBeenCalledWith('output', 'a.png', 'reject', false);
    expect(mockSetFileState).toHaveBeenCalledWith('output', 'b.png', 'reject', false);
  });
});

describe('fetchFiles server-state hydration', () => {
  it('hydrates server state without requiring a directory listing', async () => {
    mockLoadFileState.mockResolvedValueOnce({
      favorite: ['favorite.png'],
      reject: ['rejected.png'],
      hidden: [],
    });
    useOutputsStore.setState({ migratedFavoriteSources: ['output'] });

    await expect(useOutputsStore.getState().hydrateFileState('output')).resolves.toBe(true);

    expect(useOutputsStore.getState().favorites).toContain('output/favorite.png');
    expect(useOutputsStore.getState().rejected).toContain('output/rejected.png');
  });

  it('does not roll back a file-state mutation made during hydration', async () => {
    let resolveFirstLoad!: (state: {
      favorite: string[];
      reject: string[];
      hidden: string[];
    }) => void;
    mockLoadFileState
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveFirstLoad = resolve;
      }))
      .mockResolvedValueOnce({ favorite: [], reject: ['during-load.png'], hidden: [] });
    useOutputsStore.setState({ migratedFavoriteSources: ['output'] });

    const hydration = useOutputsStore.getState().hydrateFileState('output');
    await vi.waitFor(() => expect(mockLoadFileState).toHaveBeenCalledTimes(1));
    useOutputsStore.getState().toggleRejected('output/during-load.png');
    resolveFirstLoad({ favorite: [], reject: [], hidden: [] });

    await expect(hydration).resolves.toBe(true);
    expect(mockLoadFileState).toHaveBeenCalledTimes(2);
    expect(useOutputsStore.getState().rejected).toContain('output/during-load.png');
  });

  it('hydrates rejected from loadFileState reject array', async () => {
    mockLoadFileState.mockResolvedValueOnce({
      favorite: [],
      reject: ['a.png'],
      hidden: [],
    });
    useOutputsStore.setState({ source: 'output', currentFolder: null });

    await useOutputsStore.getState().fetchFiles();

    expect(useOutputsStore.getState().rejected).toContain('output/a.png');
  });

  it('hydrates favorite from loadFileState favorite array', async () => {
    mockLoadFileState.mockResolvedValueOnce({
      favorite: ['a.png'],
      reject: [],
      hidden: [],
    });
    useOutputsStore.setState({ source: 'output', currentFolder: null });

    await useOutputsStore.getState().fetchFiles();

    expect(useOutputsStore.getState().favorites).toContain('output/a.png');
  });

  it('preserves the latest favorite and reject state when hydration fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockLoadFileState.mockRejectedValueOnce(new Error('temporarily offline'));
    useOutputsStore.setState({
      source: 'output',
      currentFolder: null,
      migratedFavoriteSources: ['output'],
      favorites: ['output/favorite.png', 'input/keep-favorite.png'],
      rejected: ['output/rejected.png', 'input/keep-rejected.png'],
    });

    await useOutputsStore.getState().fetchFiles();

    expect(useOutputsStore.getState().favorites).toEqual([
      'input/keep-favorite.png',
      'output/favorite.png',
    ]);
    expect(useOutputsStore.getState().rejected).toEqual([
      'input/keep-rejected.png',
      'output/rejected.png',
    ]);
    warnSpy.mockRestore();
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

describe('runPromptSearch state reconciliation', () => {
  it('removes stale flags for returned unflagged files while preserving unrelated ids', async () => {
    mockSearchUserImagesByPrompt.mockResolvedValueOnce([
      makeFile({ id: 'output/stale-favorite.png' }),
      makeFile({ id: 'output/stale-reject.png' }),
      makeFile({ id: 'output/server-favorite.png', favorite: true }),
      makeFile({ id: 'output/server-reject.png', rejected: true }),
    ]);
    useOutputsStore.setState({
      favorites: ['output/stale-favorite.png', 'output/not-returned.png', 'input/other.png'],
      rejected: ['output/stale-reject.png', 'output/reject-not-returned.png'],
    });

    await useOutputsStore.getState().runPromptSearch('needle');

    expect(useOutputsStore.getState().favorites).toEqual(expect.arrayContaining([
      'output/server-favorite.png',
      'output/not-returned.png',
      'input/other.png',
    ]));
    expect(useOutputsStore.getState().favorites).not.toContain('output/stale-favorite.png');
    expect(useOutputsStore.getState().rejected).toContain('output/server-reject.png');
    expect(useOutputsStore.getState().rejected).toContain('output/reject-not-returned.png');
    expect(useOutputsStore.getState().rejected).not.toContain('output/stale-reject.png');
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
      favoritesMode: 'only',
      type: 'video',
    });

    const raw = localStorage.getItem('outputs-storage');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!);
    expect(persisted.state.filter).toEqual({
      search: '',
      favoritesMode: 'only',
      rejectsMode: 'off',
      type: 'video',
    });
  });

  it('does not persist rejected across page refreshes (server-backed only)', () => {
    localStorage.removeItem('outputs-storage');
    useOutputsStore.getState().toggleRejected('output/a.png');

    const raw = localStorage.getItem('outputs-storage');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw!);
    expect(persisted.state.rejected).toBeUndefined();
  });

  it('discards rejected ids when rehydrating the legacy version-2 store', async () => {
    useOutputsStore.setState({ viewMode: 'grid', rejected: [] });
    localStorage.setItem('outputs-storage', JSON.stringify({
      version: 2,
      state: {
        viewMode: 'list',
        rejected: ['output/stale-client-only.png'],
      },
    }));

    await useOutputsStore.persist.rehydrate();

    expect(useOutputsStore.getState().viewMode).toBe('list');
    expect(useOutputsStore.getState().rejected).toEqual([]);
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

  it('exitSelectionMode clears the selection and leaves selection mode off', () => {
    useOutputsStore.setState({
      selectionMode: true,
      selectedIds: ['a', 'b'],
      selectionActionOpen: true,
    });
    useOutputsStore.getState().exitSelectionMode();
    expect(useOutputsStore.getState()).toMatchObject({
      selectionMode: false,
      selectedIds: [],
      selectionActionOpen: false,
    });
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

describe('flushFileStateMutations', () => {
  it('gives up on a write that never settles instead of wedging the listing', async () => {
    // setFileState is a plain fetch with no timeout; on a dropped mobile link the
    // promise hangs forever. fetchFiles awaits this drain before it renders, so an
    // unbounded wait leaves the Outputs panel on a permanent spinner.
    vi.useFakeTimers();
    try {
      mockSetFileState.mockImplementation(() => new Promise<void>(() => {}));
      useOutputsStore.getState().toggleRejected('output/stuck.png');

      let settled = false;
      const flushed = flushFileStateMutations('output').then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(3000);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2000);
      await flushed;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
      mockSetFileState.mockResolvedValue(undefined);
    }
  });
});
