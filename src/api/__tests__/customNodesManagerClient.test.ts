import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetManagerQueue, startManagerQueue } from '../customNodesManagerClient';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('manager queue-control method fallback', () => {
  it('falls back to GET when POST returns 405 (Manager registers it as GET)', async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts?: { method?: string }) => {
        methods.push(opts?.method ?? 'GET');
        return opts?.method === 'POST'
          ? new Response('405: Method Not Allowed', { status: 405 })
          : new Response('', { status: 200 });
      }),
    );
    await resetManagerQueue();
    expect(methods).toEqual(['POST', 'GET']);
  });

  it('uses POST directly when it succeeds (no fallback)', async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts?: { method?: string }) => {
        methods.push(opts?.method ?? 'GET');
        return new Response('', { status: 200 });
      }),
    );
    await startManagerQueue();
    expect(methods).toEqual(['POST']);
  });

  it('throws on a non-405 failure without retrying', async () => {
    const methods: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts?: { method?: string }) => {
        methods.push(opts?.method ?? 'GET');
        return new Response('boom', { status: 500 });
      }),
    );
    await expect(resetManagerQueue()).rejects.toThrow();
    expect(methods).toEqual(['POST']);
  });
});
