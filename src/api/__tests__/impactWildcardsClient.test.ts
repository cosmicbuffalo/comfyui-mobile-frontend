import { afterEach, describe, expect, it, vi } from 'vitest';
import { getImpactWildcards } from '@/api/impactWildcardsClient';

describe('getImpactWildcards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubFetch = (impl: () => unknown) => {
    const fetchMock = vi.fn(async () => impl() as Response);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('reads the list Impact Pack publishes', async () => {
    const fetchMock = stubFetch(() => ({
      ok: true,
      json: async () => ({ data: ['__samples/flower__', '__samples/jewel__'] }),
    }));

    await expect(getImpactWildcards()).resolves.toEqual([
      '__samples/flower__', '__samples/jewel__',
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/impact/wildcards/list');
  });

  it('stays empty when the pack is not installed', async () => {
    stubFetch(() => ({ ok: false, status: 404, json: async () => ({}) }));
    await expect(getImpactWildcards()).resolves.toEqual([]);
  });

  it('stays empty when the request throws', async () => {
    stubFetch(() => { throw new Error('offline'); });
    await expect(getImpactWildcards()).resolves.toEqual([]);
  });

  it('tolerates an unexpected payload shape', async () => {
    stubFetch(() => ({ ok: true, json: async () => ({ data: 'not-a-list' }) }));
    await expect(getImpactWildcards()).resolves.toEqual([]);

    stubFetch(() => ({ ok: true, json: async () => ({ data: ['__ok__', 42, null] }) }));
    await expect(getImpactWildcards()).resolves.toEqual(['__ok__']);
  });
});
