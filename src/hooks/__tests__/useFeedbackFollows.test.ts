import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedbackFollow } from '@/api/client';
import type { FeedbackIssueStatus } from '@/utils/feedbackApi';
import { hasUnseenActivity, isFollowExpired, useFeedbackFollowsStore } from '../useFeedbackFollows';

const DAY = 24 * 60 * 60_000;
const T0 = Date.parse('2026-10-01T00:00:00Z');

function follow(overrides: Partial<FeedbackFollow> = {}): FeedbackFollow {
  return { number: 7, title: 't', secret: 's', followedAt: T0, seenAt: T0, ...overrides };
}

function status(overrides: Partial<FeedbackIssueStatus> = {}): FeedbackIssueStatus {
  return { number: 7, state: 'open', locked: false, activityAt: null, ...overrides };
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

  it('counts activity as resetting the idle clock', () => {
    const recent = status({ activityAt: new Date(T0 + 80 * DAY).toISOString() });
    expect(isFollowExpired(follow({ seenAt: T0 + 80 * DAY }), recent, T0 + 91 * DAY)).toBe(false);
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
