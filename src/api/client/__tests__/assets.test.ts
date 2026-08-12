import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_STATE_REQUEST_TIMEOUT_MS,
  loadFileState,
  resolveInputAliases,
  setFileState,
} from '../assets';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockFetch(response: Partial<Response> & { jsonBody?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => response.jsonBody,
  } as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('loadFileState', () => {
  it('builds the GET URL with the source query param and parses the response', async () => {
    const fetchMock = mockFetch({
      jsonBody: { favorite: ['a.png'], reject: ['b.png'], hidden: ['c.png'] },
    });

    const result = await loadFileState('output');

    expect(fetchMock).toHaveBeenCalledWith('/mobile/api/files/state?source=output');
    expect(result).toEqual({ favorite: ['a.png'], reject: ['b.png'], hidden: ['c.png'] });
  });

  it('defaults to the output source when none is given', async () => {
    const fetchMock = mockFetch({ jsonBody: { favorite: [], reject: [], hidden: [] } });

    await loadFileState();

    expect(fetchMock).toHaveBeenCalledWith('/mobile/api/files/state?source=output');
  });

  it('coerces a missing/malformed field to an empty array', async () => {
    mockFetch({ jsonBody: { favorite: ['a.png'] } });

    const result = await loadFileState('input');

    expect(result).toEqual({ favorite: ['a.png'], reject: [], hidden: [] });
  });

  it('throws with the server error message on a non-ok response', async () => {
    mockFetch({ ok: false, status: 500, jsonBody: { error: 'boom' } });

    await expect(loadFileState('output')).rejects.toThrow('boom');
  });

  it('falls back to a generic error message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    } as unknown as Response));

    await expect(loadFileState('output')).rejects.toThrow('Failed to load file state');
  });
});

describe('setFileState', () => {
  it('POSTs source/path/state/value as JSON to the unified endpoint', async () => {
    const fetchMock = mockFetch({ jsonBody: { ok: true } });

    await setFileState('output', 'foo/bar.png', 'favorite', true);

    expect(fetchMock).toHaveBeenCalledWith('/mobile/api/files/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'output',
        path: 'foo/bar.png',
        state: 'favorite',
        value: true,
      }),
      signal: expect.any(AbortSignal),
    });
  });

  it('bounds the request so a dead connection cannot wedge the outputs panel', () => {
    // Writes for one path are chained onto each other and the listing waits on
    // that chain, so a request that never settles blocks every later
    // favorite/reject/hidden write for the file and stalls the panel behind it.
    expect(FILE_STATE_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
    expect(FILE_STATE_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(30000);
  });

  it('supports reject and hidden state names', async () => {
    const fetchMock = mockFetch({ jsonBody: { ok: true } });

    await setFileState('input', 'a.png', 'reject', false);

    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody).toEqual({ source: 'input', path: 'a.png', state: 'reject', value: false });
  });

  it('resolves without a value (the endpoint does not return an authoritative list)', async () => {
    mockFetch({ jsonBody: { ok: true } });

    await expect(setFileState('output', 'a.png', 'hidden', true)).resolves.toBeUndefined();
  });

  it('throws with the server error message on a non-ok response', async () => {
    mockFetch({ ok: false, status: 400, jsonBody: { error: 'bad request' } });

    await expect(setFileState('output', 'a.png', 'favorite', true)).rejects.toThrow('bad request');
  });
});

describe('resolveInputAliases', () => {
  it('POSTs aliases and returns the resolved input paths', async () => {
    const fetchMock = mockFetch({
      jsonBody: { resolved: { '.mi-deadbeef.png': 'private/photo.png' } },
    });

    const result = await resolveInputAliases(['.mi-deadbeef.png']);

    expect(fetchMock).toHaveBeenCalledWith('/mobile/api/input-aliases/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases: ['.mi-deadbeef.png'] }),
    });
    expect(result).toEqual({ '.mi-deadbeef.png': 'private/photo.png' });
  });

  it('does not call the backend for an empty alias list', async () => {
    const fetchMock = mockFetch({ jsonBody: { resolved: {} } });

    await expect(resolveInputAliases([])).resolves.toEqual({});

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces the backend error message', async () => {
    mockFetch({ ok: false, status: 500, jsonBody: { error: 'alias cache unavailable' } });

    await expect(resolveInputAliases(['.mi-deadbeef.png']))
      .rejects.toThrow('alias cache unavailable');
  });
});
