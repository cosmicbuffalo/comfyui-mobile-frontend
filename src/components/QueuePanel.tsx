import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/shallow';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import type { Workflow } from '@/api/types';
import { buildViewerImages } from '@/utils/viewerImages';
import type { QueueItemData, UnifiedItem, ViewerImage } from './queue/types';
import { QueueImageMenu } from './queue/QueueImageMenu';
import { QueueToast } from './queue/QueueToast';
import { getBatchSources } from './queue/queueUtils';
import { downloadBatch, downloadImage } from '@/utils/downloads';
import { copyTextToClipboard } from '@/utils/clipboard';
import { QueueList } from './queue/QueueList';
import { useQueueMenuDismiss } from '@/hooks/useQueueMenuDismiss';

interface QueuePanelProps {
  open: boolean;
  onImageClick?: (images: Array<ViewerImage>, index: number, enableFollowQueue?: boolean) => void;
}

export function QueuePanel({ open, onImageClick }: QueuePanelProps) {
  const running = useQueueStore((s) => s.running);
  const pending = useQueueStore((s) => s.pending);
  const fetchQueue = useQueueStore((s) => s.fetchQueue);
  const deleteQueueItem = useQueueStore((s) => s.deleteItem);
  const interrupt = useQueueStore((s) => s.interrupt);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const setQueuePanelOpen = useWorkflowStore((s) => s.setQueuePanelOpen);
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);
  const promptOutputs = useWorkflowStore((s) => s.promptOutputs);

  const history = useHistoryStore((s) => s.history);
  const fetchHistory = useHistoryStore((s) => s.fetchHistory);
  const deleteHistoryItem = useHistoryStore((s) => s.deleteItem);
  const { isExecuting, progress, executingPromptId } = useWorkflowStore(
    useShallow((s) => ({
      isExecuting: s.isExecuting,
      progress: s.progress,
      executingPromptId: s.executingPromptId,
    }))
  );
  const effectiveExecutingId = executingPromptId || (running.length === 1 ? running[0].prompt_id : null);
  const executingNodeLabel = useMemo(() => {
    if (!workflow || !executingNodeId) return null;
    const node = workflow.nodes.find((n) => String(n.id) === executingNodeId);
    if (!node) return `Node ${executingNodeId}`;
    const typeDef = nodeTypes?.[node.type];
    return typeDef?.display_name || node.type;
  }, [workflow, executingNodeId, nodeTypes]);
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
    workflow?: Workflow;
    promptId?: string;
    hasVideoOutputs?: boolean;
  } | null>(null);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const totalCountRef = useRef(0);
  const wasOpenRef = useRef(false);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (open) {
      if (!wasOpenRef.current) {
        if (hasMountedRef.current) {
          if (listRef.current) {
            listRef.current.scrollTop = 0;
          }
        }
      }
      Promise.all([fetchQueue(), fetchHistory()]).then(() => {
        setHasLoadedOnce(true);
      });
    }
    wasOpenRef.current = open;
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
    }
  }, [open, fetchQueue, fetchHistory]);

  useEffect(() => {
    if (!isExecuting && open) {
      fetchHistory();
    }
  }, [isExecuting, open, fetchHistory]);

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
    await downloadImage(src, (downloadedSrc) => {
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
  }, [pending, running, history, executingPromptId]);

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
    return buildViewerImages(doneItems, { onlyOutput: true, alt: 'Generation' });
  }, [unifiedList]);

  const firstDoneItemId = useMemo(() => {
    const firstDone = unifiedList.find((item) => item.status === 'done');
    return firstDone?.id ?? null;
  }, [unifiedList]);

  useEffect(() => {
    if (!open) return;
    totalCountRef.current = unifiedList.length;
    queueMicrotask(() => {
      setVisibleCount((prev) => Math.max(prev, initialVisibleCount));
    });
  }, [open, unifiedList.length, initialVisibleCount]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    if (visibleCount >= unifiedList.length) return;
    if (el.scrollHeight <= el.clientHeight + 20) {
      queueMicrotask(() => {
        setVisibleCount((prev) => Math.min(unifiedList.length, prev + 10));
      });
    }
  }, [open, visibleCount, unifiedList.length]);

  if (!open) return null;

  return (
    <div className="flex flex-col bg-gray-100 min-h-full">
      <QueueList
        listRef={listRef}
        unifiedList={unifiedList}
        visibleCount={visibleCount}
        hasLoadedOnce={hasLoadedOnce}
        effectiveExecutingId={effectiveExecutingId}
        progress={progress}
        overallProgress={overallProgress}
        executingNodeLabel={executingNodeLabel}
        onDeleteItem={(item) => {
          if (item.status === 'pending') deleteQueueItem(item.id);
          if (item.status === 'done') deleteHistoryItem(item.id);
        }}
        onStop={interrupt}
        onImageClick={onImageClick}
        viewerImages={viewerImages}
        promptOutputs={promptOutputs}
        onOpenMenu={({ top, right, imageSrc, workflow, promptId, hasVideoOutputs }) => {
          setMenuState({
            open: true,
            top,
            right,
            imageSrc,
            workflow,
            promptId,
            hasVideoOutputs
          });
        }}
        downloaded={downloaded}
        firstDoneItemId={firstDoneItemId}
        onScroll={() => {
          const el = listRef.current;
          if (!el) return;
          const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
          if (remaining < 400) {
            setVisibleCount((prev) => Math.min(totalCountRef.current, prev + 10));
          }
        }}
      />

      <QueueImageMenu
        menuState={menuState}
        unifiedList={unifiedList}
        onClose={() => setMenuState(null)}
        onLoadWorkflow={(workflow, promptId) => {
          loadWorkflow(
            workflow,
            `history-${promptId}.json`,
            { source: { type: 'history', promptId } }
          );
          setQueuePanelOpen(false);
        }}
        onCopyWorkflow={handleCopyWorkflow}
        onDownload={(src) => handleDownload(src)}
        onBatchDownload={(sources) => downloadBatch(sources, (downloadedSrc) => {
          setDownloaded((prev) => ({ ...prev, [downloadedSrc]: true }));
        })}
        onDeleteHistory={(promptId) => deleteHistoryItem(promptId)}
        getBatchSources={getBatchSources}
      />

      <QueueToast message={toastMessage} />
    </div>
  );
}
