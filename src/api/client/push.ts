// Web Push API client. The browser subscribes via its vendor push service using
// the VAPID public key from the backend; we hand the resulting subscription back
// to the node, which sends notifications on generation completion.

import { t } from '@/i18n';

export interface PushConfig {
  enabled: boolean;
  vapidPublicKey?: string;
  subscriptions?: number;
  reason?: string;
}

export interface PushSendResult {
  sent: number;
  pruned: number;
  total: number;
}

export async function getPushConfig(): Promise<PushConfig> {
  const response = await fetch('/mobile/api/push/config');
  if (!response.ok) throw new Error(t('Failed to fetch push config'));
  return response.json();
}

export async function sendSubscription(subscription: PushSubscription): Promise<{ subscriptions: number }> {
  const response = await fetch('/mobile/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) throw new Error(t('Failed to register subscription'));
  return response.json();
}

export async function removeSubscription(endpoint: string): Promise<void> {
  await fetch('/mobile/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}

export async function sendTestPush(): Promise<PushSendResult> {
  const response = await fetch('/mobile/api/push/test', { method: 'POST' });
  if (!response.ok) throw new Error(t('Failed to send test notification'));
  return response.json();
}

// --- Native app push targets (paired automatically by the app) ---

export interface AppTarget {
  label: string;
  relay_url: string;
  code_hint: string;
  added?: number | null;
}

export async function getAppTargets(): Promise<{ targets: AppTarget[] }> {
  const response = await fetch('/mobile/api/push/app-targets');
  if (!response.ok) throw new Error(t('Failed to fetch app targets'));
  return response.json();
}

export async function sendAppTestPush(): Promise<PushSendResult> {
  const response = await fetch('/mobile/api/push/app-test', { method: 'POST' });
  if (!response.ok) throw new Error(t('Failed to send test notification'));
  return response.json();
}

// --- Notification preferences (server-side; apply to web + app push) ---

export interface PushPreferences {
  notifyOnComplete: boolean;
  notifyOnError: boolean;
  includeThumbnail: boolean;
}

export async function getPushPreferences(): Promise<PushPreferences> {
  const response = await fetch('/mobile/api/push/preferences');
  if (!response.ok) throw new Error(t('Failed to fetch notification preferences'));
  return response.json();
}

export async function setPushPreferences(updates: Partial<PushPreferences>): Promise<PushPreferences> {
  const response = await fetch('/mobile/api/push/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error(t('Failed to save notification preferences'));
  return response.json();
}
