import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@/api/client';
import { resolveInputPathForFile } from '@/utils/filesystem';

function makeFile(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'output/folder/a.png',
    name: 'a.png',
    type: 'image',
    ...overrides,
  };
}

describe('resolveInputPathForFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // object_info enumerates top-level input files only, so a subfolder pick can
  // never be a combo choice and has to name its own directory to stay
  // resolvable. A top-level pick IS a choice and stays bare.
  it('names the directory on an input pick from a subfolder', async () => {
    await expect(
      resolveInputPathForFile(makeFile({ id: 'input/assets/a.png' }), 'input'),
    ).resolves.toBe('assets/a.png [input]');
  });

  it('leaves a top-level input pick bare', async () => {
    await expect(
      resolveInputPathForFile(makeFile({ id: 'input/a.png' }), 'input'),
    ).resolves.toBe('a.png');
  });

  it('does not annotate an input pick twice', async () => {
    await expect(
      resolveInputPathForFile(makeFile({ id: 'input/assets/a.png [input]' }), 'input'),
    ).resolves.toBe('assets/a.png [input]');
  });

  it('uses server-side copy for output files', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'a.png', subfolder: '', type: 'input' }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(resolveInputPathForFile(makeFile(), 'output')).resolves.toBe('a.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      '/mobile/api/files/copy-to-input',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ path: 'folder/a.png', source: 'output', overwrite: true }),
      }),
    );
  });

  it('can hide the copied input after server-side copy', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: 'a.png', subfolder: 'batch', type: 'input' }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(
      resolveInputPathForFile(makeFile(), 'output', { hideCopiedInput: true }),
    ).resolves.toBe('batch/a.png [input]');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // File state is keyed by the path on disk, so it must NOT carry the
    // annotation the widget value gets.
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/mobile/api/files/state',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ source: 'input', path: 'batch/a.png', state: 'hidden', value: true }),
      }),
    );
  });

  it('fails instead of falling back to browser transfer when server-side copy fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(resolveInputPathForFile(makeFile(), 'output')).rejects.toThrow(
      'Failed to copy file to inputs',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
