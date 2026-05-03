export interface FeedbackSubmission {
  title: string;
  body: string;
  contact?: string;
  diagnostics?: string;
  // Honeypot field — UI keeps this empty; bots filling all visible fields
  // will set it and the worker will reject.
  website?: string;
}

export interface FeedbackSuccess {
  ok: true;
  url: string;
  number: number;
}

export interface FeedbackFailure {
  ok: false;
  error: string;
  status?: number;
}

export type FeedbackResult = FeedbackSuccess | FeedbackFailure;

export const FEEDBACK_ENDPOINT = (import.meta.env.VITE_FEEDBACK_ENDPOINT ?? '') as string;

export function isFeedbackEndpointConfigured(): boolean {
  return Boolean(FEEDBACK_ENDPOINT);
}

export async function submitFeedback(
  endpoint: string,
  submission: FeedbackSubmission,
): Promise<FeedbackResult> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }

  let data: { url?: string; number?: number; error?: string };
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: 'invalid_response', status: response.status };
  }

  if (!response.ok) {
    return { ok: false, error: data.error ?? 'unknown_error', status: response.status };
  }

  if (typeof data.url !== 'string' || typeof data.number !== 'number') {
    return { ok: false, error: 'invalid_response', status: response.status };
  }

  return { ok: true, url: data.url, number: data.number };
}
