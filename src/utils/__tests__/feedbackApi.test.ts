import { afterEach, describe, expect, it, vi } from 'vitest';
import { submitFeedback } from '../feedbackApi';

const ENDPOINT = 'https://feedback.example.com/feedback';

const baseSubmission = {
  title: 'hello',
  body: 'this is the body of the feedback',
};

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

describe('submitFeedback', () => {
  it('returns ok:true with url and number on 200', async () => {
    mockFetch({ jsonBody: { url: 'https://github.com/foo/bar/issues/12', number: 12 } });
    const result = await submitFeedback(ENDPOINT, baseSubmission);
    expect(result).toEqual({
      ok: true,
      url: 'https://github.com/foo/bar/issues/12',
      number: 12,
    });
  });

  it('forwards the worker error code for non-2xx responses', async () => {
    mockFetch({ ok: false, status: 429, jsonBody: { error: 'rate_limited' } });
    const result = await submitFeedback(ENDPOINT, baseSubmission);
    expect(result).toEqual({ ok: false, error: 'rate_limited', status: 429 });
  });

  it('returns network_error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const result = await submitFeedback(ENDPOINT, baseSubmission);
    expect(result).toEqual({ ok: false, error: 'network_error' });
  });

  it('returns timeout when fetch is aborted', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));
    const result = await submitFeedback(ENDPOINT, baseSubmission);
    expect(result).toEqual({ ok: false, error: 'timeout' });
  });

  it('returns invalid_response when 200 body is malformed', async () => {
    mockFetch({ jsonBody: { url: 'not-a-number-for-number' } });
    const result = await submitFeedback(ENDPOINT, baseSubmission);
    expect(result).toMatchObject({ ok: false, error: 'invalid_response' });
  });

  it('returns invalid_response when the response body is not JSON', async () => {
    // e.g. a proxy or upstream serving an HTML 502 page
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
    } as unknown as Response));
    const result = await submitFeedback(ENDPOINT, baseSubmission);
    expect(result).toEqual({ ok: false, error: 'invalid_response', status: 502 });
  });

  it('serializes the full submission to JSON in the request body', async () => {
    const fetchMock = mockFetch({
      jsonBody: { url: 'https://github.com/x/y/issues/1', number: 1 },
    });
    await submitFeedback(ENDPOINT, {
      ...baseSubmission,
      contact: 'alice',
      diagnostics: 'env stuff',
    });
    expect(fetchMock).toHaveBeenCalledWith(ENDPOINT, expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }));
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sentBody).toEqual({
      title: 'hello',
      body: 'this is the body of the feedback',
      contact: 'alice',
      diagnostics: 'env stuff',
    });
  });
});
