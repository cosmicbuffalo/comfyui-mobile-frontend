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

  it('returns input paths unchanged', async () => {
    await expect(
      resolveInputPathForFile(makeFile({ id: 'input/assets/a.png' }), 'input'),
    ).resolves.toBe('assets/a.png');
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
