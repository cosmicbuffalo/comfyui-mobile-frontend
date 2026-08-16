import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useOutputsStore } from '@/hooks/useOutputs';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import type { Workflow } from '@/api/types';
import { buildOutputPreferredViewerImages, buildViewerImages } from '@/utils/viewerImages';
import type { ItemStatus, QueueItemData, UnifiedItem, ViewerImage } from './QueuePanel/types';
import { QueueImageMenu } from './QueuePanel/QueueImageMenu';
import { QueueToast } from './QueuePanel/QueueToast';
import { getBatchSources } from './QueuePanel/queueUtils';
import { downloadBatch, downloadImage, filenameFromSrc } from '@/utils/downloads';
import { copyTextToClipboard } from '@/utils/clipboard';
import { QueueList } from './QueuePanel/QueueList';
import { useQueueMenuDismiss } from '@/hooks/useQueueMenuDismiss';
import { resolveExecutingNodeLabel } from '@/utils/executionLabels';
import { resolveQueueExecutionContext } from './QueuePanel/executionContext';
import { useI18n } from '@/i18n';
import { CloseIcon } from './icons';
import * as api from '@/api/client';
import { buildReenqueueRequest } from './QueuePanel/queueReenqueue';

interface QueuePanelProps {
  visible: boolean;
  onImageClick?: (images: Array<ViewerImage>, index: number, enableFollowQueue?: boolean) => void;
}

// How long the progressive reveal waits on a card that hasn't reported its
// media ready before moving on anyway.
const REVEAL_STALL_TIMEOUT_MS = 4000;

const INITIAL_HISTORY_RETRY_MS = 500;
const MAX_HISTORY_RETRY_MS = 8000;

// Read-and-consume the `?prompt_id=<id>` deep link the native app navigates
// here with when a "generation finished" push notification is tapped. The
// param is stripped from the URL immediately (same convention as
// ShareHandoffController's handoff params) so a later manual reload doesn't
// replay the deep link.
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

// Same treatment as the workflow panel's connection-jump highlight (see
// useWorkflow's `scrollToNode`): scroll the card into view, then ring-pulse
// it via the shared `.highlight-pulse` keyframes so a notification landing on
// the queue reads as one continuous jump instead of a silent scroll.
function flashQueueCard(promptId: string) {
  const card = document.querySelector<HTMLElement>(
    `[data-scroll-anchor-id="${CSS.escape(promptId)}"]`,
  );
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document
    .querySelectorAll('.highlight-pulse')
    .forEach((el) => el.classList.remove('highlight-pulse'));
  card.classList.add('highlight-pulse');
  setTimeout(() => card.classList.remove('highlight-pulse'), 1200);
  if ('vibrate' in navigator) navigator.vibrate(10);
}

export const QueuePanel = memo(function QueuePanel({ visible, onImageClick }: QueuePanelProps) {
  const { t } = useI18n();
  const running = useQueueStore((s) => s.running);
  const pending = useQueueStore((s) => s.pending);
  const queueOutputLayout = useQueueStore((s) => s.queueOutputLayout);
  const isDesktop = useIsDesktop();
  // Stacked outputs on desktop lay each run's outputs in a full-width row, so
  // the inner content container widens from max-w-3xl to max-w-full. The panel
  // shell itself is always w-full (its scrollbar sits at the screen edge) —
  // only this inner cap changes.
  const wideStackedLayout = isDesktop && queueOutputLayout === 'stacked';
  const completing = useQueueStore((s) => s.completing);
  const fetchQueue = useQueueStore((s) => s.fetchQueue);
  const deleteQueueItem = useQueueStore((s) => s.deleteItem);
  const interrupt = useQueueStore((s) => s.interrupt);
  const markPromptCompleted = useQueueStore((s) => s.markPromptCompleted);
  const recoverableJobIds = useQueueStore((s) => s.recoverableJobIds);
  const isRestoringLostJobs = useQueueStore((s) => s.isRestoringLostJobs);
  const restoreLostJobs = useQueueStore((s) => s.restoreLostJobs);
  const discardRecoverableJobs = useQueueStore((s) => s.discardRecoverableJobs);
  const fetchQueueMetadata = useQueueStore((s) => s.fetchQueueMetadata);
  const hydrateFileState = useOutputsStore((s) => s.hydrateFileState);
  const previewVisibility = useQueueStore((s) => s.previewVisibility);
  const previewVisibilityDefault = useQueueStore((s) => s.previewVisibilityDefault);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const switchToSession = useWorkflowStore((s) => s.switchToSession);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);
  const promptOutputs = useQueueStore((s) => s.livePromptOutputs);

  const history = useHistoryStore((s) => s.history);
  const fetchHistory = useHistoryStore((s) => s.fetchHistory);
  // Which deep-linked prompt we've already forced a history fetch for.
  const deepLinkFetchedForRef = useRef<string | null>(null);
  // Guards the progressive-reveal wait so one card that never reports ready
  // can't stall the list permanently.
  const revealWaitTimerRef = useRef<number | null>(null);
  const loadMoreHistory = useHistoryStore((s) => s.loadMoreHistory);
  const hasMoreHistory = useHistoryStore((s) => s.hasMoreHistory);
  const isLoadingHistory = useHistoryStore((s) => s.isLoading);
  const deleteHistoryItem = useHistoryStore((s) => s.deleteItem);
  const viewerOpen = useImageViewerStore((s) => s.viewerOpen);
  const [loadingMore, setLoadingMore] = useState(false);
  // Playback ownership is queue-wide, not card-local. Without this, every card
  // whose video tab had been selected could keep its own range request and
  // decoder alive, starving the video the user was currently trying to watch.
  // `pinned` records how the slot was claimed: a user tap holds it against
  // arriving generations and survives overlay gating; an automatic claim (an
  // eligible generation finishing) yields to the next arrival and to gating.
  const [queueVideoOwner, setQueueVideoOwner] = useState<
    { itemId: string; pinned: boolean } | null
  >(null);
  const queueVideoPlaybackEnabled = visible && !viewerOpen;
  const requestQueueVideoPlayback = useCallback((itemId: string) => {
    setQueueVideoOwner({ itemId, pinned: true });
  }, []);
  const requestAutoQueueVideoPlayback = useCallback((itemId: string) => {
    setQueueVideoOwner((owner) => (owner?.pinned ? owner : { itemId, pinned: false }));
  }, []);
  const releaseQueueVideoPlayback = useCallback((itemId: string) => {
    setQueueVideoOwner((owner) => (owner?.itemId === itemId ? null : owner));
  }, []);
  // Leaving the panel or opening the viewer ends automatic playback for good —
  // an auto-played video must not resume when the user comes back. A pinned
  // claim is kept so the video the user selected can resume when the overlay
  // closes.
  useEffect(() => {
    if (queueVideoPlaybackEnabled) return;
    setQueueVideoOwner((owner) => (owner?.pinned ? owner : null));
  }, [queueVideoPlaybackEnabled]);
  const runningPromptIds = useMemo(
    () => new Set(running.map((item) => item.prompt_id)),
    [running],
  );
  // NOTE (intentionally deferred — LOW): only infer the running id when exactly
  // one prompt is running. With 2+ running and no websocket `executingPromptId`,
  // no card gets progress. ComfyUI executes sequentially so 2+ truly-running is
  // rare; left as-is rather than guessing which of several is current.
  const fallbackExecutingId = running.length === 1 ? running[0].prompt_id : null;
  const executionContext = useWorkflowStore(
    useShallow((s) => (
      resolveQueueExecutionContext({
        activeSessionId: s.activeSessionId,
        promptToSession: s.promptToSession,
        parkedSessions: s.parkedSessions,
        isExecuting: s.isExecuting,
        progress: s.progress,
        executingPromptId: s.executingPromptId,
        executingNodeId: s.executingNodeId,
        executingNodePath: s.executingNodePath,
        workflow: s.workflow,
      }, runningPromptIds, fallbackExecutingId)
    )),
  );
  const {
    isExecuting,
    progress,
    executingPromptId,
    executingNodeId,
    executingNodePath,
    workflow,
  } = executionContext;
  const effectiveExecutingId = executingPromptId || fallbackExecutingId;
  const executingNodeLabel = useMemo(() => {
    return resolveExecutingNodeLabel(
      executingNodePath,
      executingNodeId,
      workflow,
      nodeTypes,
    );
  }, [workflow, executingNodeId, executingNodePath, nodeTypes]);
  const overallProgress = useOverallProgress({
    workflow,
    runKey: executingPromptId || effectiveExecutingId,
    isRunning: isExecuting || Boolean(effectiveExecutingId),
    workflowDurationStats,
  });
  const [menuState, setMenuState] = useState<{
    open: boolean;
    top: number;
    right: number;
    imageSrc: string;
    imageSources: string[];
    status: ItemStatus;
    workflow?: Workflow;
    openWorkflowSessionId?: string;
    workflowLabel?: string;
    promptId?: string;
    hasVideoOutputs?: boolean;
    hasImageOutputs?: boolean;
    canReenqueue?: boolean;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // Failed queue actions (cancel/delete/interrupt) used to disappear without
  // any feedback; surface them through the panel toast for a moment.
  const actionError = useQueueStore((s) => s.actionError);
  const setActionError = useQueueStore((s) => s.setActionError);
  useEffect(() => {
    if (!actionError) return;
    const timer = window.setTimeout(() => setActionError(null), 2500);
    return () => window.clearTimeout(timer);
  }, [actionError, setActionError]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const totalCountRef = useRef(0);
  const wasOpenRef = useRef(false);
  const hasMountedRef = useRef(false);
  const wasExecutingRef = useRef(isExecuting);
  const mediaReadyItemIdsRef = useRef(new Set<string>());
  const [mediaReadyVersion, setMediaReadyVersion] = useState(0);

  const handleItemMediaReady = useCallback((itemId: string) => {
    if (mediaReadyItemIdsRef.current.has(itemId)) return;
    mediaReadyItemIdsRef.current.add(itemId);
    setMediaReadyVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!visible) {
      wasOpenRef.current = false;
      return;
    }

    if (!wasOpenRef.current && hasMountedRef.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
    wasOpenRef.current = true;
    hasMountedRef.current = true;

    let disposed = false;
    let requestRunning = false;
    let retryDelay = INITIAL_HISTORY_RETRY_MS;
    let retryTimer: number | null = null;
    // Per-request success flags so a retry only repeats what actually failed.
    // Without them, a persistently failing file-state request would refetch
    // queue + history forever — and each history refetch at the initial page
    // size collapsed a deep-scrolled list back to its first page.
    let queueLoaded = false;
    let historyLoaded = false;
    let fileStateLoaded = false;

    const loadInitialState = async () => {
      if (disposed || requestRunning) return;
      requestRunning = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      // The panel is rebuilt from two independent backend views: pending /
      // running jobs in queue, and completed jobs in history. Do not declare an
      // empty panel until both survived the WebView's startup request group.
      // Start file-state hydration alongside the two display-critical requests,
      // but do not make a one-time legacy-favorite migration delay queue paint.
      // fetchHistory() with no size refreshes the store's current window, so a
      // panel re-open never shrinks history the user already scrolled to.
      const fileStateRequest = fileStateLoaded
        ? Promise.resolve(true)
        : hydrateFileState('output');
      const [queueOk, historyOk] = await Promise.all([
        queueLoaded ? Promise.resolve(true) : fetchQueue(),
        historyLoaded ? Promise.resolve(true) : fetchHistory(),
      ]);
      queueLoaded = queueLoaded || queueOk;
      historyLoaded = historyLoaded || historyOk;
      if (disposed) return;
      if (queueLoaded && historyLoaded) {
        setHasLoadedOnce(true);
      }
      // Queue history always refers to saved output files, regardless of the
      // source last selected in Outputs. A failed state request participates in
      // this retry loop without withholding otherwise-usable queue/history UI.
      fileStateLoaded = (await fileStateRequest) || fileStateLoaded;
      requestRunning = false;
      if (disposed) return;
      if (queueLoaded && historyLoaded && fileStateLoaded) return;

      // A WebView navigation or connection reset can cancel the whole startup
      // request group. Keep the panel in its loading state and retry, capping
      // the delay so a recovered connection never requires another refresh.
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        void loadInitialState();
      }, retryDelay);
      retryDelay = Math.min(MAX_HISTORY_RETRY_MS, retryDelay * 2);
    };

    const retryNow = () => {
      if (document.visibilityState === 'hidden') return;
      retryDelay = INITIAL_HISTORY_RETRY_MS;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      void loadInitialState();
    };

    void loadInitialState();
    window.addEventListener('online', retryNow);
    document.addEventListener('visibilitychange', retryNow);
    return () => {
      disposed = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      window.removeEventListener('online', retryNow);
      document.removeEventListener('visibilitychange', retryNow);
    };
  }, [visible, fetchQueue, fetchHistory, hydrateFileState]);

  useEffect(() => {
    const justFinished = wasExecutingRef.current && !isExecuting;
    wasExecutingRef.current = isExecuting;
    if (justFinished && visible) void fetchHistory();
  }, [isExecuting, visible, fetchHistory]);

  // --- Push-notification deep link ------------------------------------------
  // Arm at most once per page load (ref-guarded for StrictMode's double
  // effect): show the queue panel right away, then once the prompt's history
  // entry has loaded, open the image viewer on its outputs — the same action
  // as manually tapping the finished item's first image.
  const deepLinkReadRef = useRef(false);
  const [deepLinkPromptId, setDeepLinkPromptId] = useState<string | null>(null);
  useEffect(() => {
    if (deepLinkReadRef.current) return;
    deepLinkReadRef.current = true;
    const promptId = consumePromptDeepLink();
    if (!promptId) return;
    setDeepLinkPromptId(promptId);
    setCurrentPanel('queue');
  }, [setCurrentPanel]);

  // For an already-running app this postMessage is the ONLY path, not a
  // fallback: sw.js deliberately never calls WindowClient.navigate, because
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
      if (!promptId) return;
      setDeepLinkPromptId(promptId);
      setCurrentPanel('queue');
    };
    serviceWorker.addEventListener('message', handleNotificationClick);
    return () => serviceWorker.removeEventListener('message', handleNotificationClick);
  }, [setCurrentPanel]);

  // Same idea for the native iOS app: WKWebView has no service worker to
  // relay through, so the app calls this directly (window.__comfyuiMobile*
  // bridge, same shape as the savePhoto completion callback in
  // WebViewPool.swift) when the page is already booted, instead of forcing
  // the full-page reload `enter()` otherwise falls back to.
  useEffect(() => {
    (window as unknown as { __cueforgeDeepLinkPromptId?: (id: string) => void })
      .__cueforgeDeepLinkPromptId = (promptId: string) => {
        if (!promptId) return;
        setDeepLinkPromptId(promptId);
        setCurrentPanel('queue');
      };
    return () => {
      delete (window as unknown as { __cueforgeDeepLinkPromptId?: (id: string) => void })
        .__cueforgeDeepLinkPromptId;
    };
  }, [setCurrentPanel]);

  // A pending deep link re-asserts the queue panel for as long as it's armed.
  // Setting it once above isn't enough: startup session restore (loadWorkflow)
  // and the navigation store's own persisted-state rehydration both land after
  // this component's mount effect and default back to 'workflow', clobbering
  // the one-shot set above before the user ever sees the queue.
  const currentPanel = useNavigationStore((s) => s.currentPanel);
  useEffect(() => {
    if (deepLinkPromptId && currentPanel !== 'queue') {
      setCurrentPanel('queue');
    }
  }, [deepLinkPromptId, currentPanel, setCurrentPanel]);

  // Queue view is embedded; no modal scroll locking.

  useQueueMenuDismiss(Boolean(menuState?.open), () => setMenuState(null), 'queue-image-menu');

  const handleCopyWorkflow = async (workflow: Workflow | undefined) => {
    if (!workflow) return;
    const text = JSON.stringify(workflow, null, 2);
    const copied = await copyTextToClipboard(text);
    setToastMessage(copied ? t('Copied to clipboard') : t('Failed to copy'));
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleDownload = async (src: string) => {
    // Derive the real name, like the batch path does. Hardcoding 'image.png'
    // saved every asset under that name — a video landed in Downloads as a
    // .png the gallery refuses to open.
    await downloadImage(src, filenameFromSrc(src));
  };

  const unifiedList = useMemo(() => {
    const items: Record<string, UnifiedItem> = {};

    history.forEach(item => {
      items[item.prompt_id] = { id: item.prompt_id, status: 'done', data: item, timestamp: item.timestamp };
    });

    running.forEach(item => {
      if (!items[item.prompt_id]) {
        items[item.prompt_id] = { id: item.prompt_id, status: 'running', data: item };
      }
    });

    completing.forEach(item => {
      if (!items[item.prompt_id]) {
        items[item.prompt_id] = { id: item.prompt_id, status: 'running', data: item };
      }
    });

    pending.forEach(item => {
      if (!items[item.prompt_id]) {
        items[item.prompt_id] = { id: item.prompt_id, status: 'pending', data: item };
      }
    });

    if (executingPromptId && items[executingPromptId]) {
      items[executingPromptId].status = 'running';
    }

    const list = Object.values(items);
    list.sort((a, b) => {
      const statusOrder = { 'pending': 0, 'running': 1, 'done': 2 };
      if(statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      if (a.status === 'pending') {
        const aNumber = (a.data as QueueItemData).number;
        const bNumber = (b.data as QueueItemData).number;
        return bNumber - aNumber; // Highest number (newest) first
      }
      if (a.status === 'done') {
        return (b.timestamp || 0) - (a.timestamp || 0); // Newest timestamp first
      }
      return 0;
    });

    return list;
  }, [pending, running, completing, history, executingPromptId]);

  // Prune persisted per-card UI state for items that no longer exist anywhere.
  // Dropping unknown ids is only safe once the whole history is loaded, which
  // is what hasMoreHistory gates — but that stays true until the user pages
  // back to their oldest run, so for most people this never fires. Growth is
  // bounded on the write path instead (see touchEntry); this is the precise
  // cleanup for when we do know the full set.
  const pruneQueueItemUiState = useQueueStore((s) => s.pruneQueueItemUiState);
  useEffect(() => {
    if (hasMoreHistory || isLoadingHistory) return;
    pruneQueueItemUiState(unifiedList.map((item) => item.id));
  }, [hasMoreHistory, isLoadingHistory, pruneQueueItemUiState, unifiedList]);

  const initialVisibleCount = useMemo(() => {
    if (unifiedList.length === 0) return 0;
    const pendingCount = unifiedList.filter((item) => item.status === 'pending').length;
    const runningCount = unifiedList.filter((item) => item.status === 'running').length;
    const doneCount = unifiedList.filter((item) => item.status === 'done').length;
    const topDone = doneCount > 0 ? 1 : 0;
    return Math.min(unifiedList.length, pendingCount + runningCount + topDone);
  }, [unifiedList]);

  const viewerImages = useMemo(() => {
    const doneItems = unifiedList.filter((item) => item.status === 'done').map((item) => item.data);
    return doneItems.flatMap((item) => {
      const previewsVisible = item.prompt_id
        ? previewVisibility[item.prompt_id] ?? previewVisibilityDefault
        : previewVisibilityDefault;
      return previewsVisible
        ? buildViewerImages([item], { alt: t('Generation') })
        : buildOutputPreferredViewerImages([item], { alt: t('Generation') });
    });
  }, [unifiedList, previewVisibility, previewVisibilityDefault, t]);

  const firstDoneItemId = useMemo(() => {
    const firstDone = unifiedList.find((item) => item.status === 'done');
    return firstDone?.id ?? null;
  }, [unifiedList]);

  // Release the slot only when the owning item is gone from the list entirely
  // (deleted / pruned). Checking the visible slice instead would evict an
  // actively watched card the moment a newly enqueued item pushes it past the
  // reveal boundary for a frame.
  useEffect(() => {
    if (
      queueVideoOwner !== null &&
      !unifiedList.some((item) => item.id === queueVideoOwner.itemId)
    ) {
      setQueueVideoOwner(null);
    }
  }, [queueVideoOwner, unifiedList]);

  // Deep link, phase 2: history for the notified prompt loads asynchronously,
  // so watch the store until its entry appears, then open the viewer at that
  // prompt's first image in the panel's flat image list — identical to the
  // manual tap in QueueCard (including follow-queue when it's the top item).
  // A prompt with no viewable outputs (errored run) just clears the deep link,
  // leaving the queue panel showing. If the initial history fetch completes
  // without the prompt at all, give up rather than waiting forever.
  useEffect(() => {
    if (!deepLinkPromptId) {
      // Re-arm: without this the ref latches the id for the session, so tapping
      // the SAME notification again takes neither the fetch branch nor the
      // give-up branch below — no fetch, no viewer, nothing.
      deepLinkFetchedForRef.current = null;
      return;
    }
    const entry = history.find((item) => item.prompt_id === deepLinkPromptId);
    if (entry) {
      setDeepLinkPromptId(null);
      // Flash the underlying queue card in the same beat as opening the
      // viewer, so closing the viewer lands back on a card that still reads
      // as "that's the one that just finished" instead of an unmarked list.
      flashQueueCard(deepLinkPromptId);
      const index = viewerImages.findIndex((image) => image.promptId === deepLinkPromptId);
      if (index >= 0) {
        onImageClick?.(viewerImages, index, firstDoneItemId === deepLinkPromptId);
      }
      return;
    }
    // Not in the loaded window. `hasLoadedOnce` describes the panel's own first
    // load and says nothing about whether THIS prompt has been fetched — on the
    // service-worker notification-click path the app was sitting on another
    // panel, whose history poll is gated on `visible`, so the run that just
    // finished was never fetched. Giving up on that flag drops the deep link and
    // leaves the user on the queue list. Fetch once for this prompt instead, and
    // only stop waiting if it still isn't there afterwards.
    if (deepLinkFetchedForRef.current === deepLinkPromptId) return;
    deepLinkFetchedForRef.current = deepLinkPromptId;
    // Deliberately no cleanup flag: this effect re-runs on every history change,
    // including the routine 2s poll, and cancelling the outcome there would
    // strand the deep link armed forever (the re-run bails at the ref guard
    // above). The handler is safe to let finish because it re-reads the store
    // and only clears a deep link still pointing at this same prompt.
    const disarmIfStillPending = () => {
      setDeepLinkPromptId((current) => (current === deepLinkPromptId ? null : current));
    };
    void fetchHistory().then(
      () => {
        const arrived = useHistoryStore
          .getState()
          .history.some((item) => item.prompt_id === deepLinkPromptId);
        // Arrived: the store update re-runs this effect, which opens the viewer.
        if (arrived) return;
        disarmIfStillPending();
      },
      () => {
        // Defense-in-depth: fetchHistory's contract is to never reject (it
        // catches internally and resolves false, so a real server blip takes
        // the arrived-false branch above). But the ref above has already
        // latched this prompt, so if that contract ever drifts, an armed deep
        // link would pin the panel to the queue for the rest of the session —
        // fail open by disarming.
        disarmIfStillPending();
      },
    );
  }, [deepLinkPromptId, history, viewerImages, fetchHistory, firstDoneItemId, onImageClick]);

  useEffect(() => {
    if (!visible || !hasLoadedOnce) return;
    void fetchQueueMetadata(unifiedList.map((item) => item.id));
  }, [fetchQueueMetadata, unifiedList, visible, hasLoadedOnce]);

  useEffect(() => {
    if (!visible) return;
    totalCountRef.current = unifiedList.length;
    queueMicrotask(() => {
      setVisibleCount((prev) => Math.max(prev, initialVisibleCount));
    });
  }, [visible, unifiedList.length, initialVisibleCount]);

  // Pull the next history page from the server, guarding against overlapping
  // loads. Local `loadingMore` drives the bottom spinner; the store guards the
  // actual fetch against the background poll.
  const triggerLoadMore = useCallback(() => {
    if (!hasMoreHistory || isLoadingHistory) return;
    setLoadingMore(true);
    void loadMoreHistory().finally(() => setLoadingMore(false));
  }, [hasMoreHistory, isLoadingHistory, loadMoreHistory]);

  useEffect(() => {
    if (!visible || !hasLoadedOnce) return;
    const el = listRef.current;
    if (!el) return;
    const renderedCount = Math.min(visibleCount, unifiedList.length);
    // The preceding effect seeds pending + running + one completed card. Do not
    // race its queued state update and accidentally reveal a second completed
    // card in the same turn.
    if (renderedCount === 0 && unifiedList.length > 0) return;
    const lastRenderedItem = renderedCount > 0 ? unifiedList[renderedCount - 1] : null;
    // Reveal history progressively: the last mounted card must either load its
    // first image/video or exhaust recovery before another card is introduced.
    //
    // Time-boxed, because "ready" depends on an event that can simply never
    // arrive: a video stalled mid-fetch fires onStalled but no onError (the
    // remote-playback stall already seen over Tailscale), so its id is never
    // recorded and the whole queue stops revealing cards. Waiting a beat is a
    // loading nicety; blocking the list forever is not.
    if (lastRenderedItem && !mediaReadyItemIdsRef.current.has(lastRenderedItem.id)) {
      if (revealWaitTimerRef.current === null) {
        const stalledItemId = lastRenderedItem.id;
        revealWaitTimerRef.current = window.setTimeout(() => {
          revealWaitTimerRef.current = null;
          // Route through the same callback the real ready path uses: it adds
          // the id AND bumps mediaReadyVersion, which is what re-runs this
          // effect. Setting visibleCount to its own value instead is an
          // identity update that React bails out of, leaving the list stuck
          // exactly as if there were no timeout at all.
          handleItemMediaReady(stalledItemId);
        }, REVEAL_STALL_TIMEOUT_MS);
      }
      return;
    }
    if (revealWaitTimerRef.current !== null) {
      window.clearTimeout(revealWaitTimerRef.current);
      revealWaitTimerRef.current = null;
    }
    if (visibleCount >= unifiedList.length) {
      // Everything loaded is rendered; if it doesn't fill the viewport and the
      // server has more, pull the next page so scrolling stays possible.
      if (el.scrollHeight <= el.clientHeight + 20) triggerLoadMore();
      return;
    }
    if (el.scrollHeight <= el.clientHeight + 20) {
      queueMicrotask(() => {
        setVisibleCount((prev) => Math.min(unifiedList.length, prev + 1));
      });
    }
  }, [visible, hasLoadedOnce, visibleCount, unifiedList, mediaReadyVersion, triggerLoadMore, handleItemMediaReady]);

  // The reveal wait timer outlives the effect run that armed it, so drop it on
  // unmount rather than letting it fire against a panel that is gone.
  useEffect(() => () => {
    if (revealWaitTimerRef.current !== null) {
      window.clearTimeout(revealWaitTimerRef.current);
      revealWaitTimerRef.current = null;
    }
  }, []);

  // Stable identity (only depends on setMenuState) so memoized QueueCards don't
  // re-render on every QueuePanel render just because this callback was recreated.
  const handleOpenMenu = useCallback((payload: {
    top: number;
    right: number;
    imageSrc: string;
    imageSources: string[];
    status: ItemStatus;
    workflow?: Workflow;
    openWorkflowSessionId?: string;
    workflowLabel?: string;
    promptId?: string;
    hasVideoOutputs?: boolean;
    hasImageOutputs?: boolean;
    canReenqueue?: boolean;
  }) => {
    const { top, right, imageSrc, imageSources, status, workflow, openWorkflowSessionId, workflowLabel, promptId, hasVideoOutputs, hasImageOutputs, canReenqueue } = payload;
    setMenuState({
      open: true,
      top,
      right,
      imageSrc,
      imageSources,
      status,
      workflow,
      openWorkflowSessionId,
      workflowLabel,
      promptId,
      hasVideoOutputs,
      hasImageOutputs,
      canReenqueue,
    });
  }, []);

  const handleGoToOpenWorkflow = (sessionId: string) => {
    switchToSession(sessionId);
    setCurrentPanel('workflow');
    setMenuState(null);
  };

  const handleListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 400) {
      // Keep user-driven pagination responsive while still bounding concurrent
      // preview work on memory-constrained mobile WebViews.
      setVisibleCount((prev) => Math.min(totalCountRef.current, prev + 2));
      // Near the end of what's loaded → fetch the next history page.
      if (visibleCount >= unifiedList.length - 10) {
        triggerLoadMore();
      }
    }
  };

  const handleMenuLoadWorkflow = (workflow: Workflow, promptId: string) => {
    const historyEntry = history.find((entry) => entry.prompt_id === promptId);
    loadWorkflow(
      workflow,
      `history-${promptId}.json`,
      {
        source: {
          type: 'history',
          promptId,
          ...(historyEntry?.hidden ? { hidden: true } : {}),
        },
        navigate: false,
      }
    );
  };

  const handleBatchDownload = async (sources: string[]) => {
    await downloadBatch(sources);
  };

  const handleMenuRemoveItem = (promptId: string, status: ItemStatus) => {
    if (status === 'done') {
      deleteHistoryItem(promptId);
      return;
    }
    if (status === 'pending') {
      deleteQueueItem(promptId);
      return;
    }
    // A "completing" card is already finished on the backend (awaiting history)
    // but injected into the list as 'running'; dismiss it locally instead of
    // interrupting whatever prompt is actually executing.
    if (completing.some((item) => item.prompt_id === promptId)) {
      markPromptCompleted(promptId);
      return;
    }
    interrupt();
  };

  const handleReenqueue = async (promptId: string) => {
    const entry = history.find((candidate) => candidate.prompt_id === promptId);
    if (!entry || entry.success !== false || !entry.queueRequest) return;
    const request = buildReenqueueRequest(entry.queueRequest, api.clientId);
    try {
      const response = await api.queuePrompt(request);
      const newPromptId = response.prompt_id;
      if (!newPromptId) throw new Error(t('Backend did not return a prompt id'));

      const workflowState = useWorkflowStore.getState();
      const sessionId = workflowState.promptToSession[promptId] ?? null;
      useQueueStore.getState().registerLocalPrompt(newPromptId);
      useQueueStore.getState().recordQueuedPrompt(newPromptId, request, {
        number: response.number,
        outputsToExecute: entry.outputsToExecute ?? [],
        sessionId,
      });
      if (sessionId) {
        useWorkflowStore.setState((state) => ({
          promptToSession: {
            ...state.promptToSession,
            [newPromptId]: sessionId,
          },
        }));
      }

      const metadata = useQueueStore.getState().queueMetadata[promptId];
      if (metadata) {
        await api.upsertQueuePromptMetadata({
          ...metadata,
          promptId: newPromptId,
          sessionId: sessionId ?? metadata.sessionId,
          clientId: api.clientId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }).catch((err) => {
          console.warn('Failed to copy mobile queue metadata:', err);
        });
      }
      await fetchQueue();
      setToastMessage(t('Re-enqueued stopped prompt'));
      setTimeout(() => setToastMessage(null), 2000);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : t('Failed to re-enqueue prompt'));
      setTimeout(() => setToastMessage(null), 2500);
    }
  };

  const handleRestoreLostJobs = async () => {
    try {
      await restoreLostJobs({
        auto: false,
        onRestored: ({ oldPromptId, newPromptId, job }) => {
          const sessionId =
            job.sessionId ??
            useWorkflowStore.getState().promptToSession[oldPromptId];
          if (!sessionId) return;
          useWorkflowStore.setState((state) => ({
            promptToSession: {
              ...state.promptToSession,
              [newPromptId]: sessionId,
            },
          }));
        },
      });
      setToastMessage(recoverableJobIds.length === 1
        ? t('Restored {count} lost queued job', { count: recoverableJobIds.length })
        : t('Restored {count} lost queued jobs', { count: recoverableJobIds.length }));
      setTimeout(() => setToastMessage(null), 2000);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : t('Failed to restore lost queued jobs'));
      setTimeout(() => setToastMessage(null), 2500);
    }
  };

  return (
    <div
      id="queue-panel-wrapper"
      className="absolute inset-x-0 bottom-0"
      style={{ display: visible ? 'block' : 'none', top: 'var(--top-bar-offset, 69px)' }}
    >
      <div className="flex flex-col bg-slate-950/88 h-full min-h-full text-slate-100">
        {/* Full-width shell so the scroll container's scrollbar sits at the
            screen edge (not mid-screen). Content width is capped inside the
            scroll container and here for the banner, so nothing else changes
            size. Mirrors the workflow panel. */}
        <div className="flex flex-col flex-1 min-h-0 w-full">
          {recoverableJobIds.length > 0 && (
            <div className={`mx-auto w-full ${wideStackedLayout ? 'max-w-full' : 'max-w-3xl'}`}>
              <div className="relative mx-4 mt-4 rounded-lg border border-cyan-400/30 bg-cyan-950/55 px-3 py-3 text-sm text-slate-100">
                <div className="pr-8 font-semibold text-cyan-200">Lost queued jobs found</div>
                {/* Dismissal discards the shadow records for these jobs (not just
                    this render's banner), so it can't come back for the same lost
                    jobs on the next reload. */}
                <button
                  type="button"
                  aria-label={t('Dismiss lost jobs banner')}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-slate-100"
                  onClick={discardRecoverableJobs}
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
                <div className="mt-1 text-xs text-slate-300">
                  {recoverableJobIds.length} queued job{recoverableJobIds.length === 1 ? '' : 's'} disappeared from the backend queue after a restart.
                </div>
                <button
                  type="button"
                  className="mt-3 rounded bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleRestoreLostJobs}
                  disabled={isRestoringLostJobs}
                >
                  {isRestoringLostJobs ? t('Restoring...') : t('Restore lost jobs')}
                </button>
              </div>
            </div>
          )}
          <QueueList
            listRef={listRef}
            unifiedList={unifiedList}
            visibleCount={visibleCount}
            hasLoadedOnce={hasLoadedOnce}
            effectiveExecutingId={effectiveExecutingId}
            progress={progress}
            overallProgress={overallProgress}
            executingNodeLabel={executingNodeLabel}
            onImageClick={onImageClick}
            viewerImages={viewerImages}
            promptOutputs={promptOutputs}
            onOpenMenu={handleOpenMenu}
            firstDoneItemId={firstDoneItemId}
            queueVideoPlaybackEnabled={queueVideoPlaybackEnabled}
            activeQueueVideoOwnerId={queueVideoOwner?.itemId ?? null}
            onRequestQueueVideoPlayback={requestQueueVideoPlayback}
            onRequestAutoQueueVideoPlayback={requestAutoQueueVideoPlayback}
            onReleaseQueueVideoPlayback={releaseQueueVideoPlayback}
            onItemMediaReady={handleItemMediaReady}
            onScroll={handleListScroll}
            loadingMore={loadingMore}
          />
        </div>

        <QueueImageMenu
          menuState={menuState}
          unifiedList={unifiedList}
          onClose={() => setMenuState(null)}
          onLoadWorkflow={handleMenuLoadWorkflow}
          onShowWorkflowPanel={() => setCurrentPanel('workflow')}
          onGoToOpenWorkflow={handleGoToOpenWorkflow}
          onCopyWorkflow={handleCopyWorkflow}
          onDownload={(src) => handleDownload(src)}
          onBatchDownload={handleBatchDownload}
          onRemoveItem={handleMenuRemoveItem}
          onReenqueue={handleReenqueue}
          getBatchSources={getBatchSources}
        />

        <QueueToast message={toastMessage ?? actionError} />
      </div>
    </div>
  );
});
