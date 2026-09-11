import { useEffect, useRef, useState } from 'react';
import { runningEntryChunk, serverEntryChunk } from '@/utils/appUpdate';
import { useQueueStore } from '@/hooks/useQueue';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useMaskEditorStore } from '@/hooks/useMaskEditor';
import { useImageViewerStore } from '@/hooks/useImageViewer';

/**
 * Checks whether the server's build moved on from the one this tab runs, and
 * either reloads to it or offers to.
 *
 * The check fires when the app returns to the foreground — the moment a tab
 * that sat backgrounded across a server update would otherwise carry on with an
 * index full of deleted chunk names. Chunk prefetch (see lazyPanel) keeps such
 * a tab *working*; this is what gets it back onto the current build.
 *
 * Reloading silently is safe only because workflow state — dirty edits, parked
 * sessions, execution progress — persists to IndexedDB and rehydrates. What
 * does NOT survive is transient UI: an open mask editor's unsaved strokes, the
 * image viewer's position, a run being watched. When any of those are live the
 * hook offers a banner instead of reloading over them.
 */

const CHECK_THROTTLE_MS = 60_000;

// One silent reload per detected update. If the mismatch persists after a
// reload (a proxy caching the old index.html), reloading again would loop
// forever — fall through to the banner instead. Cleared once versions agree.
const RELOAD_GUARD_KEY = 'app-update-auto-reloaded';

/** Nothing transient on screen and nothing in flight that a reload would disturb. */
export function canReloadSilently(): boolean {
  const queue = useQueueStore.getState();
  if (queue.running.length > 0 || queue.pending.length > 0) return false;
  const workflow = useWorkflowStore.getState();
  if (workflow.isExecuting || workflow.infiniteLoop) return false;
  if (useMaskEditorStore.getState().target != null) return false;
  if (useImageViewerStore.getState().viewerOpen) return false;
  return true;
}

export function useAppUpdateCheck(): {
  updateAvailable: boolean;
  dismissUpdate: () => void;
} {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const lastCheckAtRef = useRef(0);

  useEffect(() => {
    const running = runningEntryChunk();
    if (!running) return; // dev server / tests: no hashed entry, no checks

    let cancelled = false;
    const check = async () => {
      const now = Date.now();
      if (now - lastCheckAtRef.current < CHECK_THROTTLE_MS) return;
      lastCheckAtRef.current = now;

      const server = await serverEntryChunk();
      if (cancelled || server == null) return;
      if (server === running) {
        try {
          sessionStorage.removeItem(RELOAD_GUARD_KEY);
        } catch {
          // Storage unavailable — the guard just stays best-effort.
        }
        setUpdateAvailable(false);
        return;
      }

      let alreadyReloaded = false;
      try {
        alreadyReloaded = sessionStorage.getItem(RELOAD_GUARD_KEY) != null;
      } catch {
        // Can't read the guard — err toward the banner, never a reload loop.
        alreadyReloaded = true;
      }
      if (!alreadyReloaded && canReloadSilently()) {
        try {
          sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
        } catch {
          // Guard unwritable: skip the silent reload rather than risk looping.
          setUpdateAvailable(true);
          return;
        }
        window.location.reload();
        return;
      }
      setUpdateAvailable(true);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return {
    updateAvailable,
    dismissUpdate: () => setUpdateAvailable(false),
  };
}
