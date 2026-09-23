import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteRejectedOutputs,
  QUEUE_REJECT_SOURCES,
  rejectedIdsForSources,
} from '../deleteRejectedOutputs';
import { deleteFile } from '@/api/client';
import { useOutputsStore } from '@/hooks/useOutputs';
import { useHistoryStore } from '@/hooks/useHistory';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    deleteFile: vi.fn(async () => undefined),
    getUserImages: vi.fn(async () => []),
    getUserImageFolders: vi.fn(async () => ({ input: [], output: [] })),
    loadFileState: vi.fn(async () => ({ favorite: [], reject: [], hidden: [] })),
    setFileState: vi.fn(async () => undefined),
  };
});

const mockDeleteFile = vi.mocked(deleteFile);

describe('deleteRejectedOutputs', () => {
  beforeEach(() => {
    mockDeleteFile.mockReset();
    mockDeleteFile.mockResolvedValue(undefined);
    useOutputsStore.setState({
      rejected: [], files: [], selectedIds: [], hiddenIds: [], favorites: [],
    });
    useHistoryStore.setState({ history: [] });
    vi.spyOn(useHistoryStore.getState(), 'removeOutputImages').mockResolvedValue(undefined);
  });

  // The grid used to catch up only because the outputs menu refetched the whole
  // folder afterwards: a round trip and a blank screen to reach a listing the
  // batch could already describe. It names every id it removed, so it prunes.
  it('takes the deleted files out of the listing without a refetch', async () => {
    const file = (id: string, name: string) => ({ id, name, type: 'image' as const });
    useOutputsStore.setState({
      rejected: ['output/run/bad.png'],
      files: [file('output/run/bad.png', 'bad.png'), file('output/run/good.png', 'good.png')],
      selectedIds: ['output/run/bad.png', 'output/run/good.png'],
      hiddenIds: ['output/run/bad.png'],
    });

    await deleteRejectedOutputs(['output']);

    expect(useOutputsStore.getState().files.map((f) => f.id)).toEqual(['output/run/good.png']);
    // A file that is gone keeps no marks and no place in a bulk action.
    expect(useOutputsStore.getState().selectedIds).toEqual(['output/run/good.png']);
    expect(useOutputsStore.getState().hiddenIds).toEqual([]);
    expect(useOutputsStore.getState().rejected).toEqual([]);
  });

  it('leaves a file whose delete failed in the listing, still marked', async () => {
    mockDeleteFile.mockRejectedValue(new Error('in use'));
    const stuck = { id: 'output/run/stuck.png', name: 'stuck.png', type: 'image' as const };
    useOutputsStore.setState({ rejected: [stuck.id], files: [stuck] });

    const result = await deleteRejectedOutputs(['output']);

    expect(result.failed).toBe(1);
    expect(useOutputsStore.getState().files.map((f) => f.id)).toEqual([stuck.id]);
    expect(useOutputsStore.getState().rejected).toEqual([stuck.id]);
  });

  it('does nothing when nothing is rejected', async () => {
    const result = await deleteRejectedOutputs(['output', 'input', 'temp']);
    expect(result).toEqual({ attempted: 0, deleted: 0, failed: 0 });
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('deletes each rejected file from the source its id names', async () => {
    useOutputsStore.setState({
      rejected: ['output/run/first.png', 'input/staged.png', 'temp/scratch.png'],
    });

    const result = await deleteRejectedOutputs(['output', 'input', 'temp']);

    expect(result).toEqual({ attempted: 3, deleted: 3, failed: 0 });
    expect(mockDeleteFile.mock.calls).toEqual([
      ['run/first.png', 'output'],
      ['staged.png', 'input'],
      ['scratch.png', 'temp'],
    ]);
    expect(useOutputsStore.getState().rejected).toEqual([]);
  });

  it('reconciles history with the ids it actually deleted', async () => {
    const removeSpy = vi
      .spyOn(useHistoryStore.getState(), 'removeOutputImages')
      .mockResolvedValue(undefined);
    useOutputsStore.setState({ rejected: ['output/a.png', 'output/b.png'] });

    await deleteRejectedOutputs(['output', 'input', 'temp']);

    expect(removeSpy).toHaveBeenCalledWith(['output/a.png', 'output/b.png']);
  });

  it('keeps the mark on a file whose delete failed, and clears the rest', async () => {
    // A wholesale clear here would lose the user's mark on a file that is still
    // sitting on disk, with nothing left in the UI pointing at it.
    mockDeleteFile.mockImplementation(async (path: string) => {
      if (path === 'locked.png') throw new Error('EACCES');
      return undefined;
    });
    useOutputsStore.setState({ rejected: ['output/gone.png', 'output/locked.png'] });

    const result = await deleteRejectedOutputs(['output', 'input', 'temp']);

    expect(result).toEqual({ attempted: 2, deleted: 1, failed: 1 });
    expect(useOutputsStore.getState().rejected).toEqual(['output/locked.png']);
  });

  it('leaves marks added while the batch was in flight alone', async () => {
    // The panels stay interactive behind the progress dialog, so a file rejected
    // mid-delete must not be silently unmarked by the reconciliation.
    mockDeleteFile.mockImplementation(async () => {
      useOutputsStore.setState((state) => ({
        rejected: state.rejected.includes('output/late.png')
          ? state.rejected
          : [...state.rejected, 'output/late.png'],
      }));
    });
    useOutputsStore.setState({ rejected: ['output/early.png'] });

    await deleteRejectedOutputs(['output', 'input', 'temp']);

    expect(useOutputsStore.getState().rejected).toEqual(['output/late.png']);
  });

  it('treats an id with no source prefix as an output', async () => {
    useOutputsStore.setState({ rejected: ['loose.png'] });

    await deleteRejectedOutputs(['output', 'input', 'temp']);

    expect(mockDeleteFile).toHaveBeenCalledWith('loose.png', 'output');
  });
});

describe('rejectedIdsForSources', () => {
  it('keeps the queue from deleting files the outputs panel rejected', () => {
    // Reject state is shared on purpose — an output rejected in the queue shows
    // as rejected in the grid too. The DELETE is not: the queue shows generated
    // media, so an upload the user rejected while browsing inputs is not its to
    // remove, and its menu count must match what it would actually delete.
    const rejected = ['output/a.png', 'temp/preview.png', 'input/upload.png'];

    expect(rejectedIdsForSources(rejected, QUEUE_REJECT_SOURCES)).toEqual([
      'output/a.png',
      'temp/preview.png',
    ]);
    expect(rejectedIdsForSources(rejected, ['input'])).toEqual(['input/upload.png']);
  });

  it('scopes an unprefixed id to output', () => {
    expect(rejectedIdsForSources(['loose.png'], ['output'])).toEqual(['loose.png']);
    expect(rejectedIdsForSources(['loose.png'], ['input'])).toEqual([]);
  });
});
