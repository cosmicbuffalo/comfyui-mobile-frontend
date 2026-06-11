import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore, INITIAL_HISTORY_PAGE_SIZE } from '@/hooks/useHistory';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import type { Workflow } from '@/api/types';
import { buildOutputPreferredViewerImages, buildViewerImages } from '@/utils/viewerImages';
import type { ItemStatus, QueueItemData, UnifiedItem, ViewerImage } from './QueuePanel/types';
import { QueueImageMenu } from './QueuePanel/QueueImageMenu';
import { QueueToast } from './QueuePanel/QueueToast';
import { getBatchSources } from './QueuePanel/queueUtils';
import { downloadBatch, downloadImage } from '@/utils/downloads';
import { copyTextToClipboard } from '@/utils/clipboard';
import { QueueList } from './QueuePanel/QueueList';
import { useQueueMenuDismiss } from '@/hooks/useQueueMenuDismiss';
import { resolveExecutingNodeLabel } from '@/utils/executionLabels';
import { resolveQueueExecutionContext } from './QueuePanel/executionContext';
import { CloseIcon } from './icons';
import * as api from '@/api/client';
import { buildReenqueueRequest } from './QueuePanel/queueReenqueue';

interface QueuePanelProps {
  visible: boolean;
  onImageClick?: (images: Array<ViewerImage>, index: number, enableFollowQueue?: boolean) => void;
}

export const QueuePanel = memo(function QueuePanel({ visible, onImageClick }: QueuePanelProps) {
  const running = useQueueStore((s) => s.running);
  const pending = useQueueStore((s) => s.pending);
  const completing = useQueueStore((s) => s.completing);
  const fetchQueue = useQueueStore((s) => s.fetchQueue);
  const deleteQueueItem = useQueueStore((s) => s.deleteItem);
  const interrupt = useQueueStore((s) => s.interrupt);
  const markPromptCompleted = useQueueStore((s) => s.markPromptCompleted);
  const recoverableJobIds = useQueueStore((s) => s.recoverableJobIds);
  const isRestoringLostJobs = useQueueStore((s) => s.isRestoringLostJobs);
  const restoreLostJobs = useQueueStore((s) => s.restoreLostJobs);
  const recoverableJobsKey = recoverableJobIds.join('\0');
  const [dismissedRecoverableJobsKey, setDismissedRecoverableJobsKey] = useState<string | null>(null);
  const fetchQueueMetadata = useQueueStore((s) => s.fetchQueueMetadata);
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
  const loadMoreHistory = useHistoryStore((s) => s.loadMoreHistory);
  const hasMoreHistory = useHistoryStore((s) => s.hasMoreHistory);
  const isLoadingHistory = useHistoryStore((s) => s.isLoading);
  const deleteHistoryItem = useHistoryStore((s) => s.deleteItem);
  const [loadingMore, setLoadingMore] = useState(false);
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
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
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

  useEffect(() => {
    if (visible) {
      if (!wasOpenRef.current) {
        if (hasMountedRef.current) {
          if (listRef.current) {
            listRef.current.scrollTop = 0;
          }
        }
      }
      // Load just the newest page; more pages stream in as the user scrolls.
      Promise.all([fetchQueue(), fetchHistory(INITIAL_HISTORY_PAGE_SIZE)]).then(() => {
        setHasLoadedOnce(true);
      });
    }
    wasOpenRef.current = visible;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
    }
  }, [visible, fetchQueue, fetchHistory]);

  useEffect(() => {
    if (!isExecuting && visible) {
      fetchHistory();
    }
  }, [isExecuting, visible, fetchHistory]);

  // Queue view is embedded; no modal scroll locking.

  useQueueMenuDismiss(Boolean(menuState?.open), () => setMenuState(null), 'queue-image-menu');

  const handleCopyWorkflow = async (workflow: Workflow | undefined) => {
    if (!workflow) return;
    const text = JSON.stringify(workflow, null, 2);
    const copied = await copyTextToClipboard(text);
    setToastMessage(copied ? 'Copied to clipboard' : 'Failed to copy');
    setTimeout(() => setToastMessage(null), 2000);
  };

  const handleDownload = async (src: string) => {
    await downloadImage(src, 'image.png', (downloadedSrc) => {
      setDownloaded((prev) => ({ ...prev, [downloadedSrc]: true }));
    });
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
        ? buildViewerImages([item], { alt: 'Generation' })
        : buildOutputPreferredViewerImages([item], { alt: 'Generation' });
    });
  }, [unifiedList, previewVisibility, previewVisibilityDefault]);

  const firstDoneItemId = useMemo(() => {
    const firstDone = unifiedList.find((item) => item.status === 'done');
    return firstDone?.id ?? null;
  }, [unifiedList]);

  useEffect(() => {
    if (!visible) return;
    void fetchQueueMetadata(unifiedList.map((item) => item.id));
  }, [fetchQueueMetadata, unifiedList, visible]);

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
    if (!visible) return;
    const el = listRef.current;
    if (!el) return;
    if (visibleCount >= unifiedList.length) {
      // Everything loaded is rendered; if it doesn't fill the viewport and the
      // server has more, pull the next page so scrolling stays possible.
      if (el.scrollHeight <= el.clientHeight + 20) triggerLoadMore();
      return;
    }
    if (el.scrollHeight <= el.clientHeight + 20) {
      queueMicrotask(() => {
        setVisibleCount((prev) => Math.min(unifiedList.length, prev + 10));
      });
    }
  }, [visible, visibleCount, unifiedList.length, triggerLoadMore]);

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
      setVisibleCount((prev) => Math.min(totalCountRef.current, prev + 10));
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
    await downloadBatch(sources, (downloadedSrc) => {
      setDownloaded((prev) => ({ ...prev, [downloadedSrc]: true }));
    });
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
      if (!newPromptId) throw new Error('Backend did not return a prompt id');

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
      setToastMessage('Re-enqueued stopped prompt');
      setTimeout(() => setToastMessage(null), 2000);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Failed to re-enqueue prompt');
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
      setToastMessage(`Restored ${recoverableJobIds.length} lost queued job${recoverableJobIds.length === 1 ? '' : 's'}`);
      setTimeout(() => setToastMessage(null), 2000);
    } catch (err) {
      setToastMessage(err instanceof Error ? err.message : 'Failed to restore lost queued jobs');
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
        <div className="flex flex-col flex-1 min-h-0 w-full max-w-3xl mx-auto">
          {recoverableJobIds.length > 0 && dismissedRecoverableJobsKey !== recoverableJobsKey && (
            <div className="relative mx-4 mt-4 rounded-lg border border-cyan-400/30 bg-cyan-950/55 px-3 py-3 text-sm text-slate-100">
              <div className="pr-8 font-semibold text-cyan-200">Lost queued jobs found</div>
              <button
                type="button"
                aria-label="Dismiss lost jobs banner"
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-slate-100"
                onClick={() => setDismissedRecoverableJobsKey(recoverableJobsKey)}
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
                {isRestoringLostJobs ? 'Restoring...' : 'Restore lost jobs'}
              </button>
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
            downloaded={downloaded}
            firstDoneItemId={firstDoneItemId}
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
