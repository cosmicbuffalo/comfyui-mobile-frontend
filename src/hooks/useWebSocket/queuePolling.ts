import { t } from '@/i18n';
import { useQueueStore } from '../useQueue';

// Only bother the user about a backend outage once it has lasted longer than
// this. Briefer blips (a quick restart, a momentary network hiccup) recover on
// their own and aren't worth a popup.
export const BACKEND_LOST_NOTICE_MIN_DOWNTIME_MS = 5000;

export function getBackendReconnectMessage(downtimeMs: number): string {
  const seconds = Math.max(1, Math.round(downtimeMs / 1000));
  const duration = seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return t('Backend connection restored after {duration}. ComfyUI may have restarted; running jobs may have been interrupted.', { duration });
}

// One tick of the 2s background poll. The poll is a backstop for missed
// websocket completion events, but `/history` carries every entry's embedded
// workflow, so re-pulling it every 2s for the whole duration of a run wastes
// bandwidth + main-thread parse time (visible as periodic queue jank on a long
// run). `fetchQueue` is cheap AND is what moves a finished prompt into
// `completing` / TTL-prunes a stuck card, so we always run it — but we only pull
// the heavy history payload when there's actually a finished prompt awaiting
// finalization. A still-running prompt stays in `running`, so the history fetch
// is skipped entirely until something completes. Exported for testing.
export async function runQueuePollTick(
  fetchQueue: () => Promise<unknown>,
  fetchHistory: () => Promise<unknown>,
): Promise<void> {
  const queueState = useQueueStore.getState();
  if (queueState.running.length === 0 && queueState.completing.length === 0) {
    return;
  }
  await fetchQueue();
  if (useQueueStore.getState().completing.length > 0) {
    await fetchHistory();
  }
}
