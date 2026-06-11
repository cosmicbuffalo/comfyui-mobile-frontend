import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowHiddenStore } from '@/hooks/useWorkflowHidden';
import {
  loadWorkflowHiddenFromServer,
  saveWorkflowHiddenToServer,
} from '@/api/client';

vi.mock('@/api/client', () => ({
  loadWorkflowHiddenFromServer: vi.fn().mockResolvedValue(null),
  saveWorkflowHiddenToServer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadWorkflowHiddenFromServer).mockResolvedValue(null);
  vi.mocked(saveWorkflowHiddenToServer).mockResolvedValue(undefined);
  useWorkflowHiddenStore.setState({
    hidden: [],
    serverSynced: false,
    serverDirty: false,
  });
});

describe('useWorkflowHidden', () => {
  it('toggles a hidden mark on and off', () => {
    const { toggleHidden } = useWorkflowHiddenStore.getState();
    toggleHidden('sub/foo.json');
    expect(useWorkflowHiddenStore.getState().hidden).toEqual(['sub/foo.json']);
    toggleHidden('sub/foo.json');
    expect(useWorkflowHiddenStore.getState().hidden).toEqual([]);
  });

  it('remaps a renamed file', () => {
    useWorkflowHiddenStore.setState({ hidden: ['a.json', 'b.json'] });
    useWorkflowHiddenStore.getState().renameHidden('a.json', 'renamed.json');
    expect(useWorkflowHiddenStore.getState().hidden).toEqual(['renamed.json', 'b.json']);
  });

  it('remaps a renamed folder and all its hidden descendants', () => {
    useWorkflowHiddenStore.setState({
      hidden: ['sub', 'sub/foo.json', 'sub/deep/bar.json', 'other.json'],
    });
    useWorkflowHiddenStore.getState().renameHidden('sub', 'renamed');
    expect(useWorkflowHiddenStore.getState().hidden).toEqual([
      'renamed',
      'renamed/foo.json',
      'renamed/deep/bar.json',
      'other.json',
    ]);
  });

  it('removes a path and all descendants on delete', () => {
    useWorkflowHiddenStore.setState({
      hidden: ['sub', 'sub/foo.json', 'subway.json', 'other.json'],
    });
    useWorkflowHiddenStore.getState().removeHiddenUnder('sub');
    // "subway.json" must survive — it is not under "sub/".
    expect(useWorkflowHiddenStore.getState().hidden).toEqual(['subway.json', 'other.json']);
  });

  it('loads the server hidden list as authoritative', async () => {
    useWorkflowHiddenStore.setState({ hidden: ['local.json'] });
    vi.mocked(loadWorkflowHiddenFromServer).mockResolvedValue(['server.json']);

    await useWorkflowHiddenStore.getState().syncFromServer();

    expect(useWorkflowHiddenStore.getState().hidden).toEqual(['server.json']);
    expect(useWorkflowHiddenStore.getState().serverSynced).toBe(true);
  });

  it('migrates local hidden marks when the server file does not exist', async () => {
    useWorkflowHiddenStore.setState({ hidden: ['mobile-only.json'] });

    await useWorkflowHiddenStore.getState().syncFromServer();

    expect(saveWorkflowHiddenToServer).toHaveBeenCalledWith(['mobile-only.json']);
    expect(useWorkflowHiddenStore.getState().serverDirty).toBe(false);
  });

  it('pushes dirty local state before pulling from the server', async () => {
    useWorkflowHiddenStore.setState({
      hidden: ['offline-change.json'],
      serverDirty: true,
    });
    vi.mocked(loadWorkflowHiddenFromServer).mockResolvedValue(['server.json']);

    await useWorkflowHiddenStore.getState().syncFromServer();

    expect(loadWorkflowHiddenFromServer).not.toHaveBeenCalled();
    expect(saveWorkflowHiddenToServer).toHaveBeenCalledWith(['offline-change.json']);
  });

  it('does not overwrite local state when the server read fails', async () => {
    useWorkflowHiddenStore.setState({ hidden: ['local.json'] });
    vi.mocked(loadWorkflowHiddenFromServer).mockResolvedValue(undefined);

    await useWorkflowHiddenStore.getState().syncFromServer();

    expect(useWorkflowHiddenStore.getState().hidden).toEqual(['local.json']);
    expect(saveWorkflowHiddenToServer).not.toHaveBeenCalled();
  });

  it('serializes rapid changes so the newest hidden list is saved last', async () => {
    let resolveFirstSave: (() => void) | undefined;
    vi.mocked(saveWorkflowHiddenToServer)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstSave = resolve;
      }))
      .mockResolvedValue(undefined);
    useWorkflowHiddenStore.setState({ serverSynced: true });

    useWorkflowHiddenStore.getState().toggleHidden('a.json');
    useWorkflowHiddenStore.getState().toggleHidden('b.json');
    const syncing = useWorkflowHiddenStore.getState().syncToServer();
    resolveFirstSave?.();
    await syncing;

    expect(saveWorkflowHiddenToServer).toHaveBeenNthCalledWith(1, ['a.json']);
    expect(saveWorkflowHiddenToServer).toHaveBeenNthCalledWith(2, ['a.json', 'b.json']);
  });

  it('preserves a local change made while the initial server read is in flight', async () => {
    let resolveServerRead: ((hidden: string[]) => void) | undefined;
    vi.mocked(loadWorkflowHiddenFromServer).mockImplementationOnce(
      () => new Promise<string[]>((resolve) => {
        resolveServerRead = resolve;
      }),
    );

    const syncing = useWorkflowHiddenStore.getState().syncFromServer();
    useWorkflowHiddenStore.getState().toggleHidden('new-local.json');
    resolveServerRead?.(['stale-server.json']);
    await syncing;

    expect(useWorkflowHiddenStore.getState().hidden).toEqual(['new-local.json']);
    expect(saveWorkflowHiddenToServer).toHaveBeenCalledWith(['new-local.json']);
  });
});
