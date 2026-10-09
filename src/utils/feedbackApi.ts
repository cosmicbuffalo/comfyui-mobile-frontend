export interface FeedbackSubmission {
  title: string;
  body: string;
  contact?: string;
  diagnostics?: string;
  // Ask the service for a secret so this server can follow the issue.
  follow?: boolean;
  // Honeypot field — UI keeps this empty; bots filling all visible fields
  // will set it and the worker will reject.
  website?: string;
}

interface FeedbackSuccess {
  ok: true;
  url: string;
  number: number;
  /** Present only when follow was asked for and the service stored it. */
  secret?: string;
}

interface FeedbackFailure {
  ok: false;
  error: string;
  status?: number;
}

export type FeedbackResult = FeedbackSuccess | FeedbackFailure;

// Production worker URL is the default so every build ships with a working
// endpoint baked in; no env file required. Forks can override with
// VITE_FEEDBACK_ENDPOINT at build time. Set to an empty string to disable.
const DEFAULT_FEEDBACK_ENDPOINT = 'https://feedback.comfyui-mobile-frontend.com/feedback';

export const FEEDBACK_ENDPOINT = ((): string => {
  const override = import.meta.env.VITE_FEEDBACK_ENDPOINT;
  return typeof override === 'string' ? override : DEFAULT_FEEDBACK_ENDPOINT;
})();

export function isFeedbackEndpointConfigured(): boolean {
  return Boolean(FEEDBACK_ENDPOINT);
}

export const SUBMIT_TIMEOUT_MS = 30_000;

type JsonResult =
  | { ok: true; data: Record<string, unknown>; status: number }
  | FeedbackFailure;

async function requestJson(url: string, init: RequestInit = {}): Promise<JsonResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'AbortError') {
      return { ok: false, error: 'timeout' };
    }
    return { ok: false, error: 'network_error' };
  } finally {
    clearTimeout(timeoutId);
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'invalid_response', status: response.status };
  }

  if (!response.ok) {
    const error = typeof data?.error === 'string' ? data.error : 'unknown_error';
    return { ok: false, error, status: response.status };
  }
  return { ok: true, data, status: response.status };
}

function postJson(url: string, body: unknown): Promise<JsonResult> {
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function submitFeedback(
  endpoint: string,
  submission: FeedbackSubmission,
): Promise<FeedbackResult> {
  const result = await postJson(endpoint, submission);
  if (!result.ok) return result;
  const { url, number, secret } = result.data;
  if (typeof url !== 'string' || typeof number !== 'number') {
    return { ok: false, error: 'invalid_response', status: result.status };
  }
  return typeof secret === 'string' ? { ok: true, url, number, secret } : { ok: true, url, number };
}

export interface FeedbackIssueStatus {
  number: number;
  state: 'open' | 'closed';
  locked: boolean;
  /** ISO time of the newest comment by someone other than the submitter, or of closing. */
  activityAt: string | null;
}

export interface FeedbackStatusResult {
  issues: FeedbackIssueStatus[];
  /** No longer followed by the service (forgotten or deleted). */
  unknown: number[];
}

export async function fetchFeedbackStatus(
  endpoint: string,
  numbers: number[],
): Promise<FeedbackStatusResult | null> {
  const result = await requestJson(`${endpoint}/status?issues=${numbers.join(',')}`);
  if (!result.ok || !Array.isArray(result.data.issues) || !Array.isArray(result.data.unknown)) {
    return null;
  }
  return result.data as unknown as FeedbackStatusResult;
}

export type FeedbackReplyResult = { ok: true; url: string } | FeedbackFailure;

export async function submitFeedbackReply(
  endpoint: string,
  reply: { number: number; secret: string; body: string; website?: string },
): Promise<FeedbackReplyResult> {
  const result = await postJson(`${endpoint}/reply`, reply);
  if (!result.ok) return result;
  const { url } = result.data;
  if (typeof url !== 'string') {
    return { ok: false, error: 'invalid_response', status: result.status };
  }
  return { ok: true, url };
}

/** Tell the service to drop the follow, so the secret stops working. */
export async function forgetFeedback(
  endpoint: string,
  follow: { number: number; secret: string },
): Promise<boolean> {
  const result = await postJson(`${endpoint}/forget`, follow);
  // not_following means the service already forgot it.
  return result.ok || result.error === 'not_following';
}
