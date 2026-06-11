import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchUserImagesByPrompt } from '@/api/client';

describe('searchUserImagesByPrompt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unions name/path and prompt searches without trusting directory entries', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const params = new URL(`http://localhost${url}`).searchParams;
      const files = params.has('search')
        ? [
            { name: 'video', path: 'video', type: 'dir', date: 1 },
            {
              name: 'ComfyUI_04555_.png',
              path: '.hidden/batch/sample scene/ComfyUI_04555_.png',
              folder: '.hidden/batch/sample scene',
              type: 'image',
              date: 2,
              size: 100,
            },
          ]
        : [
            {
              name: 'ComfyUI_04555_.png',
              path: '.hidden/batch/sample scene/ComfyUI_04555_.png',
              folder: '.hidden/batch/sample scene',
              type: 'image',
              date: 2,
              size: 100,
            },
            {
              name: 'ComfyUI_04556_.png',
              path: '.hidden/batch/sample scene/ComfyUI_04556_.png',
              folder: '.hidden/batch/sample scene',
              type: 'image',
              date: 3,
              size: 101,
            },
          ];

      return {
        ok: true,
        json: async () => ({ files, total: files.length, offset: 0, limit: 0 }),
      } as Response;
    });

    vi.stubGlobal('fetch', fetchMock);

    const results = await searchUserImagesByPrompt('output', 'sample scene', null, true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(urls.some((url) => url.includes('search=sample+scene'))).toBe(true);
    expect(urls.some((url) => url.includes('prompt=sample+scene'))).toBe(true);
    expect(urls.some((url) => url.includes('q=sample+scene'))).toBe(false);
    expect(results.map((item) => item.id)).toEqual([
      'output/.hidden/batch/sample scene/ComfyUI_04555_.png',
      'output/.hidden/batch/sample scene/ComfyUI_04556_.png',
    ]);
  });
});
