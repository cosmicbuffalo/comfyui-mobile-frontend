import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDanbooruTags, isAutocompletePlusAvailable } from '@/api/autocompletePlusClient';

describe('autocompletePlusClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports available when either Danbooru or e621 base tags are present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        danbooru: { base_tags: false },
        e621: { base_tags: true },
      }),
    })));
    await expect(isAutocompletePlusAvailable()).resolves.toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        danbooru: { base_tags: false },
        e621: { base_tags: false },
      }),
    })));
    await expect(isAutocompletePlusAvailable()).resolves.toBe(false);
  });

  it('parses tags without eagerly computing search keys (cached lazily by search)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => [
        'tag,category,count,alias',
        'blue_eyes,0,1000,"blue eyes,青い目"',
      ].join('\n'),
    })));

    await expect(fetchDanbooruTags()).resolves.toEqual([
      {
        tag: 'blue_eyes',
        category: 0,
        count: 1000,
        aliases: ['blue eyes', '青い目'],
      },
    ]);
  });
});
