import type { QueueInfo, History } from '../types';
import { t } from '@/i18n';
import type { QueueWorkflowDiff } from '@/utils/workflowDiff';

export async function getQueue(): Promise<QueueInfo> {
  const response = await fetch(`/api/queue`, { cache: 'no-store' });
  if (!response.ok) throw new Error(t('Failed to fetch queue'));
  return response.json();
}

export async function getHistory(maxItems?: number): Promise<History> {
  const url = maxItems
    ? `/api/history?max_items=${maxItems}`
    : `/api/history`;
  // History is live application state. A cached empty/partial response after a
  // WebView navigation is worse than another small request, especially because
  // this endpoint is what rebuilds completed queue cards after an app restart.
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(t('Failed to fetch history'));
  return response.json();
}

// Whether a specific prompt has a backend history entry (i.e. it actually ran —
// successfully or not). Used to confirm a locally-tracked "shadow" job's fate
// when it's fallen outside the loaded history window, so jobs that completed
// while the UI was closed aren't mis-flagged as lost.
//
// `null` means UNKNOWN — the server couldn't be asked — and is deliberately not
// `false`. This runs on websocket reconnect, exactly when the link is least
// reliable, and the caller may auto-resubmit a job it believes never ran: a
// failed check reported as "didn't run" duplicates completed work on a flaky
// connection.
export async function promptHasHistory(promptId: string): Promise<boolean | null> {
  if (!promptId) return false;
  try {
    const response = await fetch(`/api/history/${encodeURIComponent(promptId)}`, {
      cache: 'no-store',
    });
    // A non-OK response answers nothing about whether the prompt ran, so it must
    // not read as "it didn't" — see the null contract above.
    if (!response.ok) return null;
    const data = (await response.json()) as History;
    return Boolean(data && promptId in data);
  } catch {
    return null;
  }
}

// Total number of runs in ComfyUI's history (the frontend pages /history with
// max_items, so it only knows the loaded count). Returns null if the mobile
// backend endpoint isn't available (e.g. server not restarted after an update).
export async function getHistoryCount(): Promise<number | null> {
  try {
    const response = await fetch(`/mobile/api/history-count`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.count === 'number' ? data.count : null;
  } catch {
    return null;
  }
}

export async function interruptExecution(): Promise<void> {
  await fetch(`/api/interrupt`, { method: 'POST' });
}

export async function clearQueue(): Promise<void> {
  await fetch(`/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: true })
  });
}

export async function deleteQueueItem(promptId: string): Promise<void> {
  await fetch(`/api/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] })
  });
}

export interface PromptQueueRequest {
  prompt: Record<string, unknown>;
  client_id?: string;
  extra_data?: Record<string, unknown>;
}

export interface PromptQueueResponse {
  prompt_id?: string;
  number?: number;
}

export async function queuePrompt(
  request: PromptQueueRequest,
): Promise<PromptQueueResponse> {
  const response = await fetch('/api/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: unknown } | null;
    const message = typeof data?.error === 'string'
      ? data.error
      : t('Failed to queue prompt');
    throw new Error(message);
  }
  return response.json();
}

export interface QueuePromptMetadata {
  promptId: string;
  workflowLabel?: string;
  workflowSource?: unknown;
  sessionId?: string;
  clientId?: string;
  workflowDiff?: QueueWorkflowDiff;
  createdAt?: number;
  updatedAt?: number;
}

export async function getQueuePromptMetadata(
  promptIds?: string[],
): Promise<Record<string, QueuePromptMetadata>> {
  const params = new URLSearchParams();
  for (const promptId of promptIds ?? []) {
    if (promptId) params.append('prompt_id', promptId);
  }
  const suffix = params.toString();
  const response = await fetch(`/mobile/api/queue-metadata${suffix ? `?${suffix}` : ''}`);
  if (!response.ok) throw new Error(t('Failed to fetch queue metadata'));
  const data = await response.json() as { prompts?: Record<string, QueuePromptMetadata> };
  return data.prompts ?? {};
}

export async function upsertQueuePromptMetadata(
  metadata: QueuePromptMetadata,
): Promise<void> {
  const response = await fetch('/mobile/api/queue-metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!response.ok) throw new Error(t('Failed to save queue metadata'));
}

export async function remapQueuePromptMetadata(
  oldPromptId: string,
  newPromptId: string,
): Promise<void> {
  const response = await fetch('/mobile/api/queue-metadata/remap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPromptId, newPromptId }),
  });
  if (!response.ok) throw new Error(t('Failed to remap queue metadata'));
}


export async function deleteHistoryItem(promptId: string): Promise<void> {
  const response = await fetch(`/api/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: [promptId] })
  });
  if (!response.ok) throw new Error(t('Failed to delete history item'));
}

export async function deleteHistoryItems(promptIds: string[]): Promise<void> {
  if (promptIds.length === 0) return;
  const response = await fetch(`/api/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delete: promptIds })
  });
  if (!response.ok) throw new Error(t('Failed to delete history items'));
}

export async function clearHistory(): Promise<void> {
  const response = await fetch(`/api/history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clear: true })
  });
  if (!response.ok) throw new Error(t('Failed to clear history'));
}
