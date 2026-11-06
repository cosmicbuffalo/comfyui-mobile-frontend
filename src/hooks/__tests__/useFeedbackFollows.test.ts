import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackFollow } from '@/api/client';
import type { FeedbackIssueStatus } from '@/utils/feedbackApi';
import { hasUnseenActivity, isFollowExpired, useFeedbackFollowsStore } from '../useFeedbackFollows';

const DAY = 24 * 60 * 60_000;
const T0 = Date.parse('2026-10-01T00:00:00Z');

function follow(overrides: Partial<FeedbackFollow> = {}): FeedbackFollow {
  return { number: 7, title: 't', canReply: true, followedAt: T0, seenAt: T0, ...overrides };
}

function status(overrides: Partial<FeedbackIssueStatus> = {}): FeedbackIssueStatus {
  return { number: 7, state: 'open', locked: false, activityAt: null, updatedAt: new Date(T0).toISOString(), ...overrides };
}

describe('hasUnseenActivity', () => {
  it('is true only for activity newer than what was seen', () => {
    expect(hasUnseenActivity(follow(), status())).toBe(false);
    expect(hasUnseenActivity(follow(), undefined)).toBe(false);
    expect(hasUnseenActivity(follow(), status({ activityAt: new Date(T0 + 1000).toISOString() }))).toBe(true);
    expect(hasUnseenActivity(follow({ seenAt: T0 + 1000 }), status({ activityAt: new Date(T0 + 1000).toISOString() }))).toBe(false);
  });
});

describe('isFollowExpired', () => {
  it('keeps a quiet open issue until it has been idle for 90 days', () => {
    expect(isFollowExpired(follow(), status(), T0 + 89 * DAY)).toBe(false);
    expect(isFollowExpired(follow(), status(), T0 + 91 * DAY)).toBe(true);
  });

  it('counts any update, including the submitter\'s own reply, as resetting the idle clock', () => {
    const replied = status({ updatedAt: new Date(T0 + 80 * DAY).toISOString() });
    expect(isFollowExpired(follow(), replied, T0 + 91 * DAY)).toBe(false);
  });

  it('drops a seen closed issue after two weeks, but not an unseen one', () => {
    const closed = status({ state: 'closed', activityAt: new Date(T0).toISOString() });
    expect(isFollowExpired(follow(), closed, T0 + 13 * DAY)).toBe(false);
    expect(isFollowExpired(follow(), closed, T0 + 15 * DAY)).toBe(true);
    const unseen = status({ state: 'closed', activityAt: new Date(T0 + DAY).toISOString() });
    expect(isFollowExpired(follow(), unseen, T0 + 20 * DAY)).toBe(false);
  });

  it('keeps a closed issue the submitter replied to recently', () => {
    const replied = status({
      state: 'closed',
      activityAt: new Date(T0).toISOString(),
      updatedAt: new Date(T0 + 13 * DAY).toISOString(),
    });
    expect(isFollowExpired(follow(), replied, T0 + 15 * DAY)).toBe(false);
    expect(isFollowExpired(follow(), replied, T0 + 28 * DAY)).toBe(true);
  });
});

describe('refresh', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function respond(body: unknown) {
    return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response);
  }

  beforeEach(() => {
    useFeedbackFollowsStore.setState({ follows: [], statuses: {} });
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips the feedback service when nothing is followed', async () => {
    fetchMock.mockImplementation(() => respond({ follows: [] }));
    await useFeedbackFollowsStore.getState().refresh();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/mobile/api/feedback/follows');
  });

  it('keeps a brand-new follow the service does not know yet', async () => {
    const fresh = follow({ number: 9, followedAt: Date.now() });
    fetchMock.mockImplementation((url: string) =>
      url.includes('/status?') ? respond({ issues: [], unknown: [9] }) : respond({ follows: [fresh] }));

    await useFeedbackFollowsStore.getState().refresh();

    expect(useFeedbackFollowsStore.getState().follows).toEqual([fresh]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('does not overwrite a seen that lands while the status check is in flight', async () => {
    const before = follow({ number: 7 });
    const after = follow({ number: 7, seenAt: T0 + 1000 });
    let releaseStatus: () => void = () => {};
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/status?')) {
        return new Promise((resolve) => {
          releaseStatus = () => resolve({ ok: true, status: 200, json: async () => ({ issues: [status({ number: 7 })], unknown: [] }) } as Response);
        });
      }
      return respond({ follows: [before] });
    });

    const refreshing = useFeedbackFollowsStore.getState().refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    useFeedbackFollowsStore.setState({ follows: [after] });
    releaseStatus();
    await refreshing;

    expect(useFeedbackFollowsStore.getState().follows).toEqual([after]);
  });

  it('discards a follows read that a newer change overtook', async () => {
    const stale = follow({ number: 7 });
    const added = follow({ number: 8 });
    let releaseRead: () => void = () => {};
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/status?')) return respond({ issues: [], unknown: [] });
      return new Promise((resolve) => {
        releaseRead = () => resolve({ ok: true, status: 200, json: async () => ({ follows: [stale] }) } as Response);
      });
    });

    const refreshing = useFeedbackFollowsStore.getState().refresh();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    useFeedbackFollowsStore.setState({ follows: [stale, added] });
    releaseRead();
    await refreshing;

    expect(useFeedbackFollowsStore.getState().follows).toEqual([stale, added]);
  });

  it('keeps an expired follow when the service could not forget it', async () => {
    const old = follow({ number: 7, followedAt: Date.now() - 100 * DAY });
    const oldStatus = status({ number: 7, updatedAt: new Date(Date.now() - 100 * DAY).toISOString() });
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/status?')) return respond({ issues: [oldStatus], unknown: [] });
      if (url.endsWith('/reply-token')) return respond({ replyToken: 's' });
      if (url.endsWith('/forget')) return Promise.reject(new Error('offline'));
      return respond({ follows: [old] });
    });

    await useFeedbackFollowsStore.getState().refresh();

    expect(useFeedbackFollowsStore.getState().follows).toEqual([old]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('refuses to stop following when the service could not forget', async () => {
    const kept = follow({ number: 7 });
    useFeedbackFollowsStore.setState({ follows: [kept] });
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));

    await expect(useFeedbackFollowsStore.getState().unfollow(7)).rejects.toThrow();
    expect(useFeedbackFollowsStore.getState().follows).toEqual([kept]);
  });

  it('fetches a fresh token for each stop-following action without keeping it in the list', async () => {
    const kept = follow();
    useFeedbackFollowsStore.setState({ follows: [kept] });
    let token = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/reply-token')) return respond({ replyToken: `token-${++token}` });
      if (url.endsWith('/forget')) return respond({ ok: true });
      return respond({ follows: [] });
    });
    for (let i = 1; i <= 2; i++) {
      useFeedbackFollowsStore.setState({ follows: [kept] });
      await useFeedbackFollowsStore.getState().unfollow(7);
    }
    expect(token).toBe(2);
    const bodies = fetchMock.mock.calls.filter(([url]) => url.endsWith('/forget')).map(([, init]) => JSON.parse(init.body));
    expect(bodies).toEqual([{ number: 7, secret: 'token-1' }, { number: 7, secret: 'token-2' }]);
    expect(useFeedbackFollowsStore.getState().follows).toEqual([]);
    expect(kept).not.toHaveProperty('replyToken');
    expect(kept).not.toHaveProperty('secret');
  });

  it('fetches only the expired issue token during the expiry sweep', async () => {
    const old = follow({ followedAt: Date.now() - 100 * DAY });
    const fresh = follow({ number: 8, followedAt: Date.now() });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status?')) return respond({ issues: [status({ updatedAt: new Date(Date.now() - 100 * DAY).toISOString() }), status({ number: 8, updatedAt: new Date().toISOString() })], unknown: [] });
      if (url.endsWith('/reply-token')) return respond({ replyToken: 'expired-token' });
      if (url.endsWith('/forget')) return respond({ ok: true });
      return respond({ follows: init?.method === 'DELETE' ? [fresh] : [old, fresh] });
    });
    await useFeedbackFollowsStore.getState().refresh();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/reply-token')).map(([url]) => url)).toEqual(['/mobile/api/feedback/follows/7/reply-token']);
    expect(JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/forget'))![1].body)).toEqual({ number: 7, secret: 'expired-token' });
    expect(useFeedbackFollowsStore.getState().follows).toEqual([fresh]);
  });

  it('still forgets later expired follows when one token cannot be read', async () => {
    const broken = follow({ number: 7, followedAt: Date.now() - 100 * DAY });
    const later = follow({ number: 8, followedAt: Date.now() - 100 * DAY });
    const old = new Date(Date.now() - 100 * DAY).toISOString();
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status?')) return respond({ issues: [status({ number: 7, updatedAt: old }), status({ number: 8, updatedAt: old })], unknown: [] });
      if (url.endsWith('/7/reply-token')) return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'not_found' }) } as Response);
      if (url.endsWith('/reply-token')) return respond({ replyToken: 'later-token' });
      if (url.endsWith('/forget')) return respond({ ok: true });
      return respond({ follows: init?.method === 'DELETE' ? [broken] : [broken, later] });
    });
    await useFeedbackFollowsStore.getState().refresh();
    const forgotten = fetchMock.mock.calls.filter(([url]) => url.endsWith('/forget')).map(([, init]) => JSON.parse(init.body));
    expect(forgotten).toEqual([{ number: 8, secret: 'later-token' }]);
    expect(useFeedbackFollowsStore.getState().follows).toEqual([broken]);
  });

  it('stores statuses and drops follows the service no longer knows', async () => {
    const kept = follow({ number: 7 });
    const gone = follow({ number: 8 });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status?')) {
        return respond({ issues: [status({ number: 7, activityAt: new Date(Date.now()).toISOString() })], unknown: [8] });
      }
      if (init?.method === 'DELETE') return respond({ follows: [kept] });
      return respond({ follows: [kept, gone] });
    });

    await useFeedbackFollowsStore.getState().refresh();

    const state = useFeedbackFollowsStore.getState();
    expect(state.follows).toEqual([kept]);
    expect(Object.keys(state.statuses)).toEqual(['7']);
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/mobile/api/feedback/follows/8' && init?.method === 'DELETE')).toBe(true);
    // Dropping an unknown follow doesn't need a forget call.
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/forget'))).toBe(false);
  });
});
