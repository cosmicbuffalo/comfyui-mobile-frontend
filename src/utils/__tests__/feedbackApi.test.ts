import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFeedbackStatus, forgetFeedback, submitFeedback, submitFeedbackReply } from '../feedbackApi';

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

describe('following', () => {
  it('passes the follow secret through when the service returns one', async () => {
    const fetchMock = mockFetch({ jsonBody: { url: 'u', number: 12, secret: 'abc', canReply: false } });
    const result = await submitFeedback(ENDPOINT, { ...baseSubmission, follow: true });
    expect(result).toEqual({ ok: true, url: 'u', number: 12, follow: { secret: 'abc', canReply: false } });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).follow).toBe(true);
  });

  it('asks for status under the feedback endpoint', async () => {
    const fetchMock = mockFetch({ jsonBody: { issues: [], unknown: [3] } });
    const result = await fetchFeedbackStatus(ENDPOINT, [3, 4]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/status?issues=3,4`);
    expect(result).toEqual({ issues: [], unknown: [3] });
  });

  it('reports a failed status check as null', async () => {
    mockFetch({ ok: false, status: 502, jsonBody: { error: 'github_unavailable' } });
    expect(await fetchFeedbackStatus(ENDPOINT, [3])).toBeNull();
  });

  it('posts replies and surfaces worker errors', async () => {
    const fetchMock = mockFetch({ jsonBody: { url: 'comment-url' } });
    const reply = { number: 3, secret: 's', body: 'a reply long enough' };
    expect(await submitFeedbackReply(ENDPOINT, reply)).toEqual({ ok: true, url: 'comment-url' });
    expect(fetchMock.mock.calls[0][0]).toBe(`${ENDPOINT}/reply`);

    mockFetch({ ok: false, status: 409, jsonBody: { error: 'issue_locked' } });
    expect(await submitFeedbackReply(ENDPOINT, reply)).toEqual({ ok: false, error: 'issue_locked', status: 409 });
  });

  it('sends only the issue number and secret to forget', async () => {
    const fetchMock = mockFetch({ jsonBody: { ok: true } });
    const stored = { number: 3, secret: 's', title: 'private title', canReply: true, followedAt: 1, seenAt: 2 };
    await forgetFeedback(ENDPOINT, stored);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ number: 3, secret: 's' });
  });

  it('treats an already-forgotten follow as forgotten', async () => {
    mockFetch({ ok: false, status: 403, jsonBody: { error: 'not_following' } });
    expect(await forgetFeedback(ENDPOINT, { number: 3, secret: 's' })).toBe(true);
  });
});
