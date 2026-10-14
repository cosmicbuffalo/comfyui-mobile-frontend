import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackFollow } from '@/api/client';
import type { FeedbackIssueStatus } from '@/utils/feedbackApi';
import { hasUnseenActivity, isFollowExpired, useFeedbackFollowsStore } from '../useFeedbackFollows';

const DAY = 24 * 60 * 60_000;
const T0 = Date.parse('2026-10-01T00:00:00Z');

function follow(overrides: Partial<FeedbackFollow> = {}): FeedbackFollow {
  return { number: 7, title: 't', secret: 's', canReply: true, followedAt: T0, seenAt: T0, ...overrides };
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

  it('keeps an expired follow when the service could not forget it', async () => {
    const old = follow({ number: 7, followedAt: Date.now() - 100 * DAY });
    const oldStatus = status({ number: 7, updatedAt: new Date(Date.now() - 100 * DAY).toISOString() });
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/status?')) return respond({ issues: [oldStatus], unknown: [] });
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
