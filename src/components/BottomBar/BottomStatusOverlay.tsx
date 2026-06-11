import { useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { XMarkIcon } from '@/components/icons';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useQueueStore } from '@/hooks/useQueue';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import { resolveExecutingNodeLabel } from '@/utils/executionLabels';

export function BottomStatusOverlay() {
  const currentPanel = useNavigationStore((s) => s.currentPanel);
  const viewerOpen = useImageViewerStore((s) => s.viewerOpen);
  const workflow = useWorkflowStore((s) => s.workflow);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const progress = useWorkflowStore((s) => s.progress);
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const executingNodePath = useWorkflowStore((s) => s.executingNodePath);
  const executingPromptId = useWorkflowStore((s) => s.executingPromptId);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);
  const error = useWorkflowErrorsStore((s) => s.error);
  const nodeErrors = useWorkflowErrorsStore((s) => s.nodeErrors);
  const errorsDismissed = useWorkflowErrorsStore((s) => s.errorsDismissed);
  const setErrorsDismissed = useWorkflowErrorsStore((s) => s.setErrorsDismissed);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const errorCycleIndex = useWorkflowErrorsStore((s) => s.errorCycleIndex);
  const setErrorCycleIndex = useWorkflowErrorsStore((s) => s.setErrorCycleIndex);
  const revealNodeWithParents = useWorkflowStore((s) => s.revealNodeWithParents);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const running = useQueueStore((s) => s.running);
  const [dismissedRunKey, setDismissedRunKey] = useState<string | null>(null);

  const isQueuePanel = currentPanel === 'queue';
  const isOutputsPanel = currentPanel === 'outputs';
  const isWorkflowPanel = currentPanel === 'workflow';

  const nodeErrorCount = Object.values(nodeErrors).reduce(
    (total, errors) => total + errors.length,
    0,
  );
  const hasNodeErrors = nodeErrorCount > 0;
  const isWorkflowLoadError =
    Boolean(error?.startsWith("Workflow load error")) || hasNodeErrors;
  const isBackendConnectionError =
    Boolean(error?.startsWith("Backend connection"));
  const errorTitle = isWorkflowLoadError
    ? "Workflow load error"
    : isBackendConnectionError
      ? "Backend connection"
    : "Prompt error";
  const errorMessage = isWorkflowLoadError && error
    ? error.replace(/^Workflow load error:\s*/i, '')
    : error ?? (hasNodeErrors ? `${nodeErrorCount} inputs reference missing options.` : null);

  const executingNodeLabel = useMemo(() => {
    return resolveExecutingNodeLabel(
      executingNodePath,
      executingNodeId,
      workflow,
      nodeTypes,
    );
  }, [workflow, executingNodeId, executingNodePath, nodeTypes]);

  const runKey = executingPromptId || (running[0]?.prompt_id ?? null);
  const overallProgress = useOverallProgress({
    workflow,
    runKey,
    isRunning: isExecuting || running.length > 0,
    workflowDurationStats,
  });
  const displayNodeProgress = overallProgress === 100 ? 100 : progress;
  // Workflow load errors (and node errors) are only relevant on the workflow
  // panel — don't surface them while browsing the queue or outputs.
  const hasErrorToast = (Boolean(error) || hasNodeErrors) && !errorsDismissed
    && (!isWorkflowLoadError || isWorkflowPanel);
  const progressDismissed = dismissedRunKey !== null && dismissedRunKey === runKey;
  const showProgress =
    overallProgress !== null &&
    !isQueuePanel &&
    !isOutputsPanel &&
    !progressDismissed;
  const visible = !viewerOpen && (hasErrorToast || showProgress);
  const shouldShowError = hasErrorToast;

  const handleErrorClick = () => {
    if (!workflow) return;
    if (!hasNodeErrors) return;
    const errorNodes = workflow.nodes.filter((node) => nodeErrors[String(node.id)]?.length);
    if (errorNodes.length === 0) return;

    const nextIndex = errorCycleIndex % errorNodes.length;
    const closestNode = errorNodes[nextIndex];
    if (!closestNode) return;
    const closestId = closestNode.id;
    const itemKey = closestNode.itemKey;
    if (!itemKey) return;
    const label = `Error #${nextIndex + 1}`;
    revealNodeWithParents(itemKey);
    setErrorCycleIndex((nextIndex + 1) % errorNodes.length);

    window.dispatchEvent(new CustomEvent('workflow-label-error-node', { detail: { nodeId: closestId, label } }));
    window.dispatchEvent(new CustomEvent('workflow-scroll-to-node', { detail: { nodeId: closestId, label } }));
    scrollToNode(itemKey, label);
  };

  const handleErrorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleErrorClick();
    }
  };

  const handleErrorDismissPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleErrorDismissClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setErrorsDismissed(true);
  };

  const handleProgressDismiss = () => {
    if (!runKey) return;
    setDismissedRunKey(runKey);
    // Dismissing the progress card is an explicit "I'm done watching this" — also
    // disengage the execution auto-follow so it stops scrolling the workflow list.
    window.dispatchEvent(
      new CustomEvent("workflow-stop-following-executing-node"),
    );
  };

  const handleProgressDismissPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
  };

  const handleProgressDismissClick = (
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
    handleProgressDismiss();
  };

  const handleProgressCardClick = () => {
    window.dispatchEvent(new CustomEvent("workflow-follow-executing-node"));
  };

  const handleProgressCardKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleProgressCardClick();
    }
  };

  if (!visible) return null;

  return (
    <div
      id="bottom-status-overlay"
      className="fixed inset-x-0 bottom-20 z-[2000] flex flex-col items-center gap-3 pointer-events-none"
    >
      {shouldShowError && (
        <div
          id="error-notification-wrapper"
          className="relative pointer-events-auto"
        >
          <div
            id="error-notification-toast"
            className="bg-red-950/90 border border-red-500/40 text-slate-100 rounded-xl shadow-lg px-4 py-3 w-[70vw] max-w-sm"
            role="button"
            tabIndex={0}
            onClick={handleErrorClick}
            onKeyDown={handleErrorKeyDown}
          >
            <div className="error-toast-content flex items-start justify-between gap-3">
              <div className="error-text-container pr-16">
                <div className="error-title text-sm font-semibold text-red-200">
                  {errorTitle}
                </div>
                <div className="error-message mt-1 text-xs text-slate-200 break-words">
                  {errorMessage}
                </div>
              </div>
            </div>
          </div>
          <button
            id="error-dismiss-button"
            type="button"
            aria-label="Dismiss error"
            className="absolute top-3 right-3 shrink-0 px-3 py-1 text-xs font-semibold bg-red-600 text-white rounded-full z-10"
            onPointerDown={handleErrorDismissPointerDown}
            onClick={handleErrorDismissClick}
          >
            Dismiss
          </button>
        </div>
      )}
      {showProgress && (
        <div
          id="execution-progress-card"
          className="relative bg-slate-950/55 border border-white/10 text-slate-100 rounded-lg shadow-sm backdrop-blur-md px-3 py-2 w-[70vw] max-w-sm pointer-events-auto"
          role="button"
          tabIndex={0}
          onClick={handleProgressCardClick}
          onKeyDown={handleProgressCardKeyDown}
        >
          <button
            type="button"
            aria-label="Dismiss progress"
            className="absolute -top-3.5 -right-3.5 w-7 h-7 rounded-full flex items-center justify-center bg-slate-800 border border-white/15 text-slate-300 shadow-md hover:text-white hover:bg-slate-700"
            onPointerDown={handleProgressDismissPointerDown}
            onClick={handleProgressDismissClick}
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
          <div className="node-progress-info flex min-w-0 items-center justify-between gap-2 text-xs leading-snug">
            <span className="executing-node-name min-w-0 truncate font-semibold text-slate-100">
              {executingNodeLabel || "Running"}
            </span>
            <span className="shrink-0 font-semibold text-emerald-200">{displayNodeProgress}%</span>
          </div>
          <div className="node-progress-track mt-1 h-1 rounded-full bg-slate-800/75 overflow-hidden">
            <div
              className="node-progress-bar h-full bg-emerald-400 transition-none"
              style={{
                width: `${Math.min(100, Math.max(0, displayNodeProgress))}%`,
              }}
            />
          </div>
          {overallProgress !== null && (
            <div className="overall-progress-container">
              <div className="overall-progress-info mt-1.5 flex items-center justify-between gap-2 text-[10px] leading-none text-slate-400">
                <span>Overall</span>
                <span className="font-semibold text-cyan-200">{overallProgress}%</span>
              </div>
              <div className="overall-progress-track mt-1 h-1 rounded-full bg-slate-800/75 overflow-hidden">
                <div
                  className="overall-progress-bar h-full bg-cyan-400 transition-none"
                  style={{
                    width: `${Math.min(100, Math.max(0, overallProgress))}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
