// General per-server frontend preferences, persisted server-side (see
// mobile_app_prefs.py). Distinct from the browser-local generation-settings
// store and from the push-only preferences.

export interface AppPreferences {
  autocompleteEnabled: boolean;
  telemetryEnabled?: boolean;
}

/** GET /mobile/api/telemetry - see mobile_telemetry.status(). */
export interface TelemetryStatus {
  enabled: boolean;
  /** COMFYUI_MOBILE_TELEMETRY decides, so the toggle is not the operator's. */
  forcedByEnvironment: boolean;
  /** Multiuser, and this user is not an admin. Absent on older nodes. */
  adminOnly?: boolean;
}

export async function getTelemetryStatus(): Promise<TelemetryStatus> {
  const response = await fetch('/mobile/api/telemetry');
  if (!response.ok) throw new Error('Failed to fetch telemetry status');
  return response.json();
}

export async function getAppPreferences(): Promise<AppPreferences> {
  const response = await fetch('/mobile/api/preferences');
  if (!response.ok) throw new Error('Failed to fetch preferences');
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
  if (!response.ok) throw new Error('Failed to save preferences');
  return response.json();
}
