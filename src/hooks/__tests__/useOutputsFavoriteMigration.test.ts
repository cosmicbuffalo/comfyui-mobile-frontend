import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useOutputsStore } from '../useOutputs';
import { FileStateError, setFileState } from '@/api/client';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    getUserImages: vi.fn(async () => []),
    getUserImageFolders: vi.fn(async () => ({ input: [], output: [] })),
    loadFileState: vi.fn(async () => ({ favorite: [], reject: [], hidden: [] })),
    setFileState: vi.fn(async () => undefined),
  };
});

const mockSetFileState = vi.mocked(setFileState);

// Legacy favorites are pushed to the server once per source. The "did it work"
// answer decides whether the whole list is re-POSTed before every later listing.
describe('legacy favorite migration', () => {
  beforeEach(() => {
    mockSetFileState.mockReset();
    mockSetFileState.mockResolvedValue(undefined);
    useOutputsStore.setState({
      source: 'output',
      favorites: [],
      migratedFavoriteSources: [],
    });
  });

  it('completes even when a favorited file has since been deleted', async () => {
    // The server refuses a path with nothing on disk (409). Counting that as a
    // failure pins the source as unmigrated forever, so every listing first
    // re-POSTs the entire favorites list, one sequential request at a time.
    useOutputsStore.setState({ favorites: ['output/gone.png', 'output/kept.png'] });
    mockSetFileState.mockImplementation(async (_source, path) => {
      if (path === 'gone.png') {
        throw new FileStateError('File is not ready or changed while being read; retry', 409);
      }
    });

    await useOutputsStore.getState().hydrateFileState('output');

    expect(useOutputsStore.getState().migratedFavoriteSources).toContain('output');
  });

  it('stays unmigrated when the write failed for a reason that could clear up', async () => {
    useOutputsStore.setState({ favorites: ['output/a.png'] });
    mockSetFileState.mockRejectedValue(new Error('Failed to fetch'));

    await useOutputsStore.getState().hydrateFileState('output');

    expect(useOutputsStore.getState().migratedFavoriteSources).not.toContain('output');
  });
});
