// Feedback issues this server follows for the submitter (see
// mobile_feedback_follows.py). The server only stores them; the browser checks
// the feedback service for activity.

export interface FeedbackFollow {
  number: number;
  title: string;
  secret: string;
  /** Epoch ms. */
  followedAt: number;
  /** Epoch ms of the newest activity the user has seen. */
  seenAt: number;
}

async function followsRequest(path: string, init?: RequestInit): Promise<FeedbackFollow[]> {
  const response = await fetch(`/mobile/api/feedback/follows${path}`, init);
  if (!response.ok) throw new Error('Failed to update followed feedback');
  return (await response.json()).follows;
}

export function getFeedbackFollows(): Promise<FeedbackFollow[]> {
  return followsRequest('');
}

export function addFeedbackFollow(follow: { number: number; title: string; secret: string }): Promise<FeedbackFollow[]> {
  return followsRequest('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(follow),
  });
}

export function markFeedbackFollowSeen(number: number, seenAt: number): Promise<FeedbackFollow[]> {
  return followsRequest(`/${number}/seen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seenAt }),
  });
}

export function removeFeedbackFollow(number: number): Promise<FeedbackFollow[]> {
  return followsRequest(`/${number}`, { method: 'DELETE' });
}
