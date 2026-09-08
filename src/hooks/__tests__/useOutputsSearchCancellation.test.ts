import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOutputsStore } from '../useOutputs';
import { getUserImages, searchUserImagesByPrompt, type FileItem } from '@/api/client';

vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  searchUserImagesByPrompt: vi.fn(),
  getUserImages: vi.fn(async () => []),
  loadFileState: vi.fn(async () => ({ favorite: [], reject: [], hidden: [] })),
}));

const search = vi.mocked(searchUserImagesByPrompt);

function deferredSearch() {
  let resolve!: (files: FileItem[]) => void;
  const promise = new Promise<FileItem[]>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  search.mockReset();
  useOutputsStore.setState({ source: 'output', currentFolder: null, favorites: [], rejected: [], isLoading: false });
  useOutputsStore.getState().clearPromptSearch();
});

describe('prompt search request lifetime', () => {
  it('applies a completed search while it is still current', async () => {
    const files: FileItem[] = [{ id: 'output/cat.png', name: 'cat.png', type: 'image' }];
    search.mockResolvedValueOnce(files);

    await useOutputsStore.getState().runPromptSearch('cat');

    expect(useOutputsStore.getState()).toMatchObject({
      promptSearchActive: true, promptSearchQuery: 'cat', promptSearchResults: files,
    });
  });

  it('keeps a cleared search closed when its pending response arrives', async () => {
    const pending = deferredSearch();
    search.mockReturnValueOnce(pending.promise);
    const running = useOutputsStore.getState().runPromptSearch('cat');
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());

    useOutputsStore.getState().clearPromptSearch();
    pending.resolve([{ id: 'output/cat.png', name: 'cat.png', type: 'image' }]);
    await running;

    expect(useOutputsStore.getState()).toMatchObject({
      promptSearchActive: false, promptSearchQuery: '', promptSearchResults: [],
    });
  });

  it('keeps the newer results when an older search finishes last', async () => {
    const old = deferredSearch();
    const latest: FileItem[] = [{ id: 'output/dog.png', name: 'dog.png', type: 'image' }];
    search.mockReturnValueOnce(old.promise).mockResolvedValueOnce(latest);
    const first = useOutputsStore.getState().runPromptSearch('cat');
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    await useOutputsStore.getState().runPromptSearch('dog');

    old.resolve([{ id: 'output/cat.png', name: 'cat.png', type: 'image' }]);
    await first;

    expect(useOutputsStore.getState()).toMatchObject({
      promptSearchQuery: 'dog', promptSearchResults: latest,
    });
  });

  it('invalidates a pending search when navigating out of its folder and back', async () => {
    const pending = deferredSearch();
    search.mockReturnValueOnce(pending.promise);
    const running = useOutputsStore.getState().runPromptSearch('cat');
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());

    useOutputsStore.getState().navigateToPath('album');
    await vi.waitFor(() => expect(useOutputsStore.getState().isLoading).toBe(false));
    expect(getUserImages).toHaveBeenCalled();
    useOutputsStore.getState().navigateToPath(null);
    await vi.waitFor(() => expect(useOutputsStore.getState().isLoading).toBe(false));
    pending.resolve([]);
    await running;

    expect(useOutputsStore.getState()).toMatchObject({
      currentFolder: null, promptSearchActive: false, promptSearchLoading: false,
    });
  });
});
