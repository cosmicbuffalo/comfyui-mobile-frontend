import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import {
  addFeedbackFollow,
  getFeedbackFollows,
  markFeedbackFollowSeen,
  removeFeedbackFollow,
  type FeedbackFollow,
} from '@/api/client';
import {
  FEEDBACK_ENDPOINT,
  fetchFeedbackStatus,
  forgetFeedback,
  isFeedbackEndpointConfigured,
  type FeedbackIssueStatus,
} from '@/utils/feedbackApi';

const DAY_MS = 24 * 60 * 60_000;
// A closed issue the user has seen stays followed this long, for a late reply.
const CLOSED_GRACE_MS = 14 * DAY_MS;
// Nothing from either side for this long and the follow is dropped.
const IDLE_LIMIT_MS = 90 * DAY_MS;

function activityMs(status: FeedbackIssueStatus | undefined): number | null {
  return status?.activityAt ? Date.parse(status.activityAt) : null;
}

export function hasUnseenActivity(follow: FeedbackFollow, status: FeedbackIssueStatus | undefined): boolean {
  const at = activityMs(status);
  return at != null && at > follow.seenAt;
}

export function isFollowExpired(follow: FeedbackFollow, status: FeedbackIssueStatus, now: number): boolean {
  const at = activityMs(status);
  if (status.state === 'closed' && !hasUnseenActivity(follow, status) && now - (at ?? follow.followedAt) > CLOSED_GRACE_MS) {
    return true;
  }
  return now - Math.max(follow.followedAt, at ?? 0) > IDLE_LIMIT_MS;
}

interface FeedbackFollowsState {
  follows: FeedbackFollow[];
  statuses: Record<number, FeedbackIssueStatus>;
  refresh: () => Promise<void>;
  follow: (follow: { number: number; title: string; secret: string }) => Promise<void>;
  markSeen: (number: number) => Promise<void>;
  unfollow: (number: number) => Promise<void>;
}

export const useFeedbackFollowsStore = create<FeedbackFollowsState>((set, get) => ({
  follows: [],
  statuses: {},

  refresh: async () => {
    let follows = await getFeedbackFollows();
    set({ follows });
    if (follows.length === 0 || !isFeedbackEndpointConfigured()) return;

    const result = await fetchFeedbackStatus(FEEDBACK_ENDPOINT, follows.map((f) => f.number));
    if (!result) return;
    const statuses = Object.fromEntries(result.issues.map((s) => [s.number, s]));
    set({ statuses });

    const now = Date.now();
    for (const follow of follows) {
      const status = statuses[follow.number];
      if (result.unknown.includes(follow.number)) {
        follows = await removeFeedbackFollow(follow.number);
      } else if (status && isFollowExpired(follow, status, now)) {
        await forgetFeedback(FEEDBACK_ENDPOINT, follow);
        follows = await removeFeedbackFollow(follow.number);
      }
    }
    set({ follows });
  },

  follow: async (follow) => {
    set({ follows: await addFeedbackFollow(follow) });
  },

  markSeen: async (number) => {
    const at = activityMs(get().statuses[number]);
    if (at == null) return;
    set({ follows: await markFeedbackFollowSeen(number, at) });
  },

  unfollow: async (number) => {
    const follow = get().follows.find((f) => f.number === number);
    if (follow && isFeedbackEndpointConfigured()) {
      await forgetFeedback(FEEDBACK_ENDPOINT, follow);
    }
    set({ follows: await removeFeedbackFollow(number) });
  },
}));

const CHECK_THROTTLE_MS = 10 * 60_000;
const VISIBLE_POLL_INTERVAL_MS = 3 * 60 * 60_000;

/**
 * Checks followed feedback for activity when the app opens, when it returns to
 * the foreground, and every few hours while it stays visible. Asks the
 * feedback service only when this server follows something.
 */
export function useFeedbackActivityCheck(): void {
  const lastCheckAtRef = useRef(0);

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      if (now - lastCheckAtRef.current < CHECK_THROTTLE_MS) return;
      lastCheckAtRef.current = now;
      // Best effort: a failed check just means no banner until the next one.
      useFeedbackFollowsStore.getState().refresh().catch(() => {});
    };

    check();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') check();
    }, VISIBLE_POLL_INTERVAL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, []);
}
