// General per-server frontend preferences, persisted server-side (see
// mobile_app_prefs.py). Distinct from the browser-local generation-settings
// store and from the push-only preferences.

import { t } from '@/i18n';

export interface AppPreferences {
  autocompleteEnabled: boolean;
}

export async function getAppPreferences(): Promise<AppPreferences> {
  const response = await fetch('/mobile/api/preferences');
  if (!response.ok) throw new Error(t('Failed to fetch preferences'));
  return response.json();
}

export async function setAppPreferences(
  updates: Partial<AppPreferences>,
): Promise<AppPreferences> {
  const response = await fetch('/mobile/api/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error(t('Failed to save preferences'));
  return response.json();
}
