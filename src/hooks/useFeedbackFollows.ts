import { useEffect } from 'react';
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
// A closed issue the user has seen stays followed this long after its last
// change (a reply from the submitter included), for a late answer.
const CLOSED_GRACE_MS = 14 * DAY_MS;
// Nothing from either side for this long and the follow is dropped.
const IDLE_LIMIT_MS = 90 * DAY_MS;
// KV takes up to a minute to show a new follow everywhere, so a follow younger
// than this that the service calls unknown may just not have arrived yet.
const UNKNOWN_GRACE_MS = 10 * 60_000;

function activityMs(status: FeedbackIssueStatus | undefined): number | null {
  return status?.activityAt ? Date.parse(status.activityAt) : null;
}

export function hasUnseenActivity(follow: FeedbackFollow, status: FeedbackIssueStatus | undefined): boolean {
  const at = activityMs(status);
  return at != null && at > follow.seenAt;
}

export function isFollowExpired(follow: FeedbackFollow, status: FeedbackIssueStatus, now: number): boolean {
  const quietFor = now - Math.max(follow.followedAt, Date.parse(status.updatedAt));
  if (status.state === 'closed' && !hasUnseenActivity(follow, status) && quietFor > CLOSED_GRACE_MS) {
    return true;
  }
  return quietFor > IDLE_LIMIT_MS;
}

interface FeedbackFollowsState {
  follows: FeedbackFollow[];
  statuses: Record<number, FeedbackIssueStatus>;
  refresh: () => Promise<void>;
  follow: (follow: { number: number; title: string; secret: string; canReply: boolean }) => Promise<void>;
  markSeen: (number: number) => Promise<void>;
  unfollow: (number: number) => Promise<void>;
}

export const useFeedbackFollowsStore = create<FeedbackFollowsState>((set, get) => ({
  follows: [],
  statuses: {},

  refresh: async () => {
    if (!isFeedbackEndpointConfigured()) return;
    const before = get().follows;
    const fetched = await getFeedbackFollows();
    // A follow, seen or unfollow that finished during the read already set a
    // newer list; keep that one.
    if (get().follows === before) set({ follows: fetched });
    const follows = get().follows;
    if (follows.length === 0) return;

    const result = await fetchFeedbackStatus(FEEDBACK_ENDPOINT, follows.map((f) => f.number));
    if (!result) return;
    const statuses = Object.fromEntries(result.issues.map((s) => [s.number, s]));
    set({ statuses });

    // Each removal sets the list the server returns, never the one read above:
    // a seen or a new follow may have landed while this check was waiting.
    const now = Date.now();
    for (const follow of follows) {
      const status = statuses[follow.number];
      const gone = result.unknown.includes(follow.number) && now - follow.followedAt > UNKNOWN_GRACE_MS;
      // An expired follow stays until the service has forgotten it, so the
      // secret is never dropped while its hash still works.
      const expired = status && isFollowExpired(follow, status, now) && (await forgetFeedback(FEEDBACK_ENDPOINT, follow));
      if (gone || expired) {
        set({ follows: await removeFeedbackFollow(follow.number) });
      }
    }
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
    if (!follow || !(await forgetFeedback(FEEDBACK_ENDPOINT, follow))) {
      throw new Error('Failed to stop following feedback');
    }
    set({ follows: await removeFeedbackFollow(number) });
  },
}));

// The feedback service caches each issue's status for 5 minutes, so checking
// more often than this would mostly read the same answer.
const CHECK_INTERVAL_MS = 10 * 60_000;

/**
 * Checks followed feedback for activity when the app opens, then every 10
 * minutes while it is visible. A hidden tab skips its turn and checks on return
 * if 10 minutes have passed, then keeps the 10-minute rhythm from there. Asks
 * the feedback service only when this server follows something.
 */
export function useFeedbackActivityCheck(): void {
  useEffect(() => {
    let lastCheckAt = 0;
    let timer: number | undefined;
    const run = () => {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'visible') return;
      const wait = lastCheckAt + CHECK_INTERVAL_MS - Date.now();
      if (wait > 0) {
        timer = window.setTimeout(run, wait);
        return;
      }
      lastCheckAt = Date.now();
      // Best effort: a failed check just means no banner until the next one.
      useFeedbackFollowsStore.getState().refresh().catch(() => {});
      timer = window.setTimeout(run, CHECK_INTERVAL_MS);
    };

    run();
    document.addEventListener('visibilitychange', run);
    return () => {
      document.removeEventListener('visibilitychange', run);
      window.clearTimeout(timer);
    };
  }, []);
}
