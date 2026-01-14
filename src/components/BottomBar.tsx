import { useEffect, useMemo, useRef } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import { getWidgetValue } from '@/utils/workflowInputs';
import { useQueueStore } from '@/hooks/useQueue';
import { WidgetControl } from './WidgetControl';
import { BookmarkIconSvg, ProgressRing, QueueStackIcon } from '@/components/icons';

interface BottomBarProps {
  queueOpen: boolean;
  viewerOpen?: boolean;
  followQueue?: boolean;
  onToggleFollowQueue?: () => void;
  onOpenFollowQueue?: () => void;
}

export function BottomBar({ queueOpen, viewerOpen = false, followQueue = false, onToggleFollowQueue, onOpenFollowQueue }: BottomBarProps) {
  const runCount = useWorkflowStore((s) => s.runCount);
  const setRunCount = useWorkflowStore((s) => s.setRunCount);
  const workflow = useWorkflowStore((s) => s.workflow);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const progress = useWorkflowStore((s) => s.progress);
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const executingPromptId = useWorkflowStore((s) => s.executingPromptId);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);
  const error = useWorkflowStore((s) => s.error);
  const setError = useWorkflowStore((s) => s.setError);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const queueWorkflow = useWorkflowStore((s) => s.queueWorkflow);
  const bookmarkedWidget = useWorkflowStore((s) => s.bookmarkedWidget);
  const bookmarkOverlayOpen = useWorkflowStore((s) => s.bookmarkOverlayOpen);
  const toggleBookmarkOverlay = useWorkflowStore((s) => s.toggleBookmarkOverlay);
  const updateNodeWidget = useWorkflowStore((s) => s.updateNodeWidget);
  const pending = useQueueStore((s) => s.pending);
  const running = useQueueStore((s) => s.running);
  const barRef = useRef<HTMLDivElement>(null);

  const queueSize = pending.length + running.length;
  const canRun = workflow !== null;
  const errorTitle = error?.startsWith('Workflow load error')
    ? 'Workflow load error'
    : 'Prompt error';
  const errorMessage = error?.startsWith('Workflow load error')
    ? error.replace(/^Workflow load error:\s*/i, '')
    : error;
  const executingNodeLabel = useMemo(() => {
    if (!workflow || !executingNodeId) return null;
    const node = workflow.nodes.find((n) => String(n.id) === executingNodeId);
    if (!node) return `Node ${executingNodeId}`;
    const typeDef = nodeTypes?.[node.type];
    return typeDef?.display_name || node.type;
  }, [workflow, executingNodeId, nodeTypes]);
  const runKey = executingPromptId || (running[0]?.prompt_id ?? null);
  const overallProgress = useOverallProgress({
    workflow,
    runKey,
    isRunning: isExecuting || running.length > 0,
    workflowDurationStats,
  });
  const displayNodeProgress = overallProgress === 100 ? 100 : progress;

  // Get bookmarked widget's current value from workflow
  const bookmarkedWidgetValue = useMemo(() => {
    if (!bookmarkedWidget || !workflow) return undefined;
    const node = workflow.nodes.find((n) => n.id === bookmarkedWidget.nodeId);
    if (!node) return undefined;
    return getWidgetValue(node, bookmarkedWidget.widgetName, bookmarkedWidget.widgetIndex);
  }, [bookmarkedWidget, workflow]);

  const handleRun = () => {
    if (canRun) {
      queueWorkflow(runCount);
      // Haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate(20);
      }
    }
  };

  const decrementCount = () => {
    setRunCount(runCount - 1);
  };

  const incrementCount = () => {
    setRunCount(runCount + 1);
  };

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      document.documentElement.style.setProperty('--bottom-bar-offset', `${rect.height}px`);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return (
    <div ref={barRef} className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg safe-area-bottom z-[1600]">
      <div className="flex items-center gap-3 px-3 py-2 max-w-lg mx-auto">
        {/* Run count selector */}
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          <button
            onClick={decrementCount}
            disabled={runCount <= 1}
            className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center
                       text-lg font-medium text-gray-700 disabled:opacity-40 disabled:shadow-none"
          >
            −
          </button>
          <span className="w-8 text-center font-semibold text-gray-900">
            {runCount}
          </span>
          <button
            onClick={incrementCount}
            className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center
                       text-lg font-medium text-gray-700"
          >
            +
          </button>
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={!canRun}
          className={`
            flex-1 py-3 px-6 rounded-xl font-semibold text-lg
            min-h-[48px] transition-all
            ${canRun
              ? 'bg-blue-500 text-white active:bg-blue-600'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }
          `}
        >
          Run
        </button>

        {/* Bookmark Button - only show when there's a bookmarked widget */}
        {bookmarkedWidget && (
          <button
            onClick={toggleBookmarkOverlay}
            className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors ${
              bookmarkOverlayOpen
                ? 'bg-yellow-500 text-white'
                : 'bg-gray-100 text-yellow-500 hover:bg-gray-200'
            }`}
            aria-label={bookmarkOverlayOpen ? 'Close bookmark editor' : 'Open bookmark editor'}
          >
            <BookmarkIconSvg className="w-6 h-6" />
          </button>
        )}

        {/* Follow Queue / Viewer Button */}
        <button
          onClick={viewerOpen ? onToggleFollowQueue : onOpenFollowQueue}
          className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors ${
            viewerOpen
              ? (followQueue ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          aria-label={viewerOpen ? (followQueue ? 'Disable follow queue' : 'Enable follow queue') : 'Open image viewer'}
        >
          <span className="absolute inset-0 flex items-center justify-center">
            <QueueStackIcon className="w-6 h-6" showSlash={viewerOpen && !followQueue} />
          </span>
          {queueSize > 0 && (
            <div
              className="absolute top-0 right-0 translate-x-[18px] -translate-y-[18px] w-6 h-6 rounded-full bg-blue-500 text-white
                         flex items-center justify-center font-bold text-xs border-2 border-white relative z-20"
            >
              {overallProgress !== null && (
                <ProgressRing
                  className="absolute z-10 pointer-events-none"
                  width="24"
                  height="24"
                  style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%) rotate(-90deg)' }}
                  progress={overallProgress}
                />
              )}
              {queueSize}
            </div>
          )}
        </button>
      </div>

      {/* Bookmark Overlay (Active Modal) */}
      {bookmarkOverlayOpen && bookmarkedWidget && (
        <div className="hidden">
          <WidgetControl
            name={bookmarkedWidget.widgetName}
            type={bookmarkedWidget.widgetType}
            value={bookmarkedWidgetValue}
            options={bookmarkedWidget.options}
            onChange={(newValue) => updateNodeWidget(bookmarkedWidget.nodeId, bookmarkedWidget.widgetIndex, newValue, bookmarkedWidget.widgetName)}
            hideLabel
            compact
            forceModalOpen={true}
            onModalClose={toggleBookmarkOverlay}
          />
        </div>
      )}

      {!queueOpen && !viewerOpen && (
        <div className="fixed inset-x-0 bottom-20 z-40 flex flex-col items-center gap-3 pointer-events-none">
          {error && (
            <div className="bg-red-100 text-red-900 rounded-xl shadow-lg px-4 py-3 w-[80vw] max-w-sm pointer-events-auto">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{errorTitle}</div>
                  <div className="mt-1 text-xs text-red-800 break-words">{errorMessage}</div>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss error"
                  className="shrink-0 px-3 py-1 text-xs font-semibold bg-red-700 text-white rounded-full"
                  onClick={() => setError(null)}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          {overallProgress !== null && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-2 w-[80vw] max-w-sm">
              <div className="text-sm font-semibold text-gray-900">
                Executing: {executingNodeLabel || 'Running'}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                <span>Progress</span>
                <span>{displayNodeProgress}%</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-none"
                  style={{ width: `${Math.min(100, Math.max(0, displayNodeProgress))}%` }}
                />
              </div>
              {overallProgress !== null && (
                <>
                  <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                    <span>Overall</span>
                    <span>{overallProgress}%</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-none"
                      style={{ width: `${Math.min(100, Math.max(0, overallProgress))}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
