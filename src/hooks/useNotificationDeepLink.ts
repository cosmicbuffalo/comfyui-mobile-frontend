import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { useNavigationStore } from '@/hooks/useNavigation';

// A tapped "generation finished" notification arrives one of three ways: the
// `?prompt_id=<id>` param on a fresh page load (the native app after a
// relaunch), a service-worker message to an open browser window, or the
// native app calling `window.__cueforgeDeepLinkPromptId` on a booted page.
//
// Receiving it has to happen at app level, not in QueuePanel. The queue panel
// is lazy and only mounts once the queue has been visited, so a page that
// boots on the workflow panel would never read the link — the tap would land
// on the workflow as if nothing happened. Arming switches to the queue, which
// mounts the panel; QueuePanel then opens the viewer and disarms.

interface NotificationDeepLinkState {
  pendingPromptId: string | null;
  arm: (promptId: string) => void;
  /** Clears the pending link, or only if it still points at `promptId`. */
  disarm: (promptId?: string) => void;
}

export const useNotificationDeepLinkStore = create<NotificationDeepLinkState>()((set, get) => ({
  pendingPromptId: null,
  arm: (promptId) => {
    if (!promptId) return;
    set({ pendingPromptId: promptId });
    useNavigationStore.getState().setCurrentPanel('queue');
  },
  disarm: (promptId) => {
    if (promptId !== undefined && get().pendingPromptId !== promptId) return;
    set({ pendingPromptId: null });
  },
}));

// Read-and-consume the param. It is stripped from the URL immediately (same
// convention as ShareHandoffController's handoff params) so a later manual
// reload doesn't replay the deep link.
function consumePromptDeepLink(): string | null {
  const params = new URLSearchParams(window.location.search);
  const promptId = params.get('prompt_id');
  if (!promptId) return null;
  const url = new URL(window.location.href);
  url.searchParams.delete('prompt_id');
  window.history.replaceState({}, '', url.toString());
  return promptId;
}

function promptIdFromNotificationUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/mobile')) return null;
    return url.searchParams.get('prompt_id');
  } catch {
    return null;
  }
}

/** Mount once, from an always-mounted component (App). */
export function useNotificationDeepLinkListeners() {
  const arm = useNotificationDeepLinkStore((s) => s.arm);

  // Arm at most once per page load (ref-guarded for StrictMode's double effect).
  const readRef = useRef(false);
  useEffect(() => {
    if (readRef.current) return;
    readRef.current = true;
    const promptId = consumePromptDeepLink();
    if (promptId) arm(promptId);
  }, [arm]);

  // For an already-running browser app this postMessage is the ONLY path, not
  // a fallback: sw.js deliberately never calls WindowClient.navigate, because
  // that is a full document navigation and would reload the app, discarding
  // undo history and unsaved edits. It focuses the window and hands the deep
  // link here instead, so this listener opens the prompt in place.
  useEffect(() => {
    const serviceWorker = navigator.serviceWorker;
    if (!serviceWorker) return;
    const handleNotificationClick = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      if (!data || data.type !== 'mobile-notification-click') return;
      const promptId = promptIdFromNotificationUrl(data.url);
      if (promptId) arm(promptId);
    };
    serviceWorker.addEventListener('message', handleNotificationClick);
    return () => serviceWorker.removeEventListener('message', handleNotificationClick);
  }, [arm]);

  // Same idea for the native iOS app: WKWebView has no service worker to
  // relay through, so the app calls this directly when the page is already
  // booted (WebViewPool.deliverPromptDeepLink), instead of forcing the
  // full-page reload `enter()` otherwise falls back to.
  useEffect(() => {
    (window as unknown as { __cueforgeDeepLinkPromptId?: (id: string) => void })
      .__cueforgeDeepLinkPromptId = (promptId: string) => {
        if (promptId) arm(promptId);
      };
    return () => {
      delete (window as unknown as { __cueforgeDeepLinkPromptId?: (id: string) => void })
        .__cueforgeDeepLinkPromptId;
    };
  }, [arm]);

  // A pending deep link re-asserts the queue panel for as long as it's armed.
  // Setting it once isn't enough: startup session restore (loadWorkflow) can
  // land afterwards and default back to 'workflow', clobbering the switch
  // before the user ever sees the queue.
  const pendingPromptId = useNotificationDeepLinkStore((s) => s.pendingPromptId);
  const currentPanel = useNavigationStore((s) => s.currentPanel);
  useEffect(() => {
    if (pendingPromptId && currentPanel !== 'queue') {
      useNavigationStore.getState().setCurrentPanel('queue');
    }
  }, [pendingPromptId, currentPanel]);
}
