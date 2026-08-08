import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadWorkflowFavoritesFromServer,
  saveWorkflowFavoritesToServer,
} from '@/api/client';
import { useWorkflowFavoritesStore } from '../useWorkflowFavorites';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    loadWorkflowFavoritesFromServer: vi.fn(async () => null),
    saveWorkflowFavoritesToServer: vi.fn(async () => undefined),
  };
});

const mockLoad = vi.mocked(loadWorkflowFavoritesFromServer);
const mockSave = vi.mocked(saveWorkflowFavoritesToServer);

function reset(overrides: Partial<{ favorites: string[]; serverSynced: boolean; serverDirty: boolean }> = {}) {
  useWorkflowFavoritesStore.setState({
    favorites: [],
    serverSynced: false,
    serverDirty: false,
    ...overrides,
  });
}

describe('useWorkflowFavorites server sync', () => {
  beforeEach(() => {
    mockLoad.mockReset();
    mockLoad.mockResolvedValue(null);
    mockSave.mockReset();
    mockSave.mockResolvedValue(undefined);
    reset();
  });

  it('adopts the server list on a clean first sync', async () => {
    mockLoad.mockResolvedValue(['a.json', 'sub/b.json']);

    await useWorkflowFavoritesStore.getState().syncFromServer();

    const state = useWorkflowFavoritesStore.getState();
    expect(state.favorites).toEqual(['a.json', 'sub/b.json']);
    expect(state.serverSynced).toBe(true);
    expect(state.serverDirty).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('pushes local state up instead of adopting the server list when dirty', async () => {
    // Local edits made before the first sync must not be clobbered by whatever
    // the server happens to hold.
    reset({ favorites: ['mine.json'], serverDirty: true });

    await useWorkflowFavoritesStore.getState().syncFromServer();

    expect(mockSave).toHaveBeenCalledWith(['mine.json']);
    expect(useWorkflowFavoritesStore.getState().favorites).toEqual(['mine.json']);
  });

  it('seeds an empty server from local favorites', async () => {
    // null = the server has no file yet (pre-sync installs), as opposed to an
    // empty list, which is a real "nothing is favorited" answer.
    mockLoad.mockResolvedValue(null);
    reset({ favorites: ['legacy.json'] });

    await useWorkflowFavoritesStore.getState().syncFromServer();

    expect(mockSave).toHaveBeenCalledWith(['legacy.json']);
    expect(useWorkflowFavoritesStore.getState().serverSynced).toBe(true);
  });

  it('changes nothing when the server read fails', async () => {
    // undefined = request failed. Treating that as "no favorites" would wipe
    // the user's list on a flaky connection.
    mockLoad.mockResolvedValue(undefined);
    reset({ favorites: ['keep.json'] });

    await useWorkflowFavoritesStore.getState().syncFromServer();

    const state = useWorkflowFavoritesStore.getState();
    expect(state.favorites).toEqual(['keep.json']);
    expect(state.serverSynced).toBe(false);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('does not push anything before the first successful sync', async () => {
    reset({ favorites: [], serverSynced: false });

    useWorkflowFavoritesStore.getState().toggleFavorite('new.json');
    await Promise.resolve();

    expect(mockSave).not.toHaveBeenCalled();
    expect(useWorkflowFavoritesStore.getState().serverDirty).toBe(true);
  });

  it('keeps the dirty flag when the save fails, so a later sync retries', async () => {
    mockSave.mockRejectedValue(new Error('offline'));
    reset({ favorites: ['a.json'], serverSynced: true, serverDirty: true });

    await useWorkflowFavoritesStore.getState().syncToServer();

    expect(useWorkflowFavoritesStore.getState().serverDirty).toBe(true);
  });

  it('re-saves when the list changes while a save is in flight', async () => {
    let release: () => void = () => {};
    mockSave.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = () => resolve(); }),
    );
    reset({ favorites: ['first.json'], serverSynced: true, serverDirty: true });

    const inFlight = useWorkflowFavoritesStore.getState().syncToServer();
    useWorkflowFavoritesStore.setState({ favorites: ['first.json', 'second.json'], serverDirty: true });
    release();
    await inFlight;

    expect(mockSave).toHaveBeenLastCalledWith(['first.json', 'second.json']);
    expect(useWorkflowFavoritesStore.getState().serverDirty).toBe(false);
  });

  it('coalesces overlapping syncs into one in-flight save', async () => {
    reset({ favorites: ['a.json'], serverSynced: true, serverDirty: true });
    const store = useWorkflowFavoritesStore.getState();

    await Promise.all([store.syncToServer(), store.syncToServer(), store.syncToServer()]);

    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('remaps favorites under a renamed folder', () => {
    reset({ favorites: ['old/a.json', 'old/deep/b.json', 'other.json'], serverSynced: true });

    useWorkflowFavoritesStore.getState().renameFavorite('old', 'new');

    expect(useWorkflowFavoritesStore.getState().favorites).toEqual([
      'new/a.json',
      'new/deep/b.json',
      'other.json',
    ]);
  });

  it('drops favorites under a deleted folder', () => {
    reset({ favorites: ['gone/a.json', 'gone', 'kept.json'], serverSynced: true });

    useWorkflowFavoritesStore.getState().removeFavoritesUnder('gone');

    expect(useWorkflowFavoritesStore.getState().favorites).toEqual(['kept.json']);
  });
});
