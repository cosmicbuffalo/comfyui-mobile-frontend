import { useMemo, useState } from 'react';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { XMarkIcon } from '@/components/icons';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useQueueStore } from '@/hooks/useQueue';
import { useOverallProgress } from '@/hooks/useOverallProgress';

function resolveExecutingNodeLabel(
  executingNodePath: string | null,
  executingNodeId: string | null,
  workflow: ReturnType<typeof useWorkflowStore.getState>['workflow'],
  nodeTypes: ReturnType<typeof useWorkflowStore.getState>['nodeTypes'],
): string | null {
  if (!workflow) return null;

  const toDisplayName = (
    node: { type: string; title?: unknown },
    fallback: string,
  ): string => {
    const nodeTitle =
      typeof node.title === "string" ? node.title.trim() : "";
    if (nodeTitle) return nodeTitle;
    const subgraphName = workflow.definitions?.subgraphs?.find(
      (sg) => sg.id === node.type,
    )?.name;
    if (typeof subgraphName === "string" && subgraphName.trim()) {
      return subgraphName.trim();
    }
    const typeDef = nodeTypes?.[node.type];
    return typeDef?.display_name || node.type || fallback;
  };

  if (executingNodePath) {
    const parts = executingNodePath
      .split(':')
      .map((part) => Number(part))
      .filter((value) => Number.isFinite(value));
    if (parts.length > 0) {
      if (parts.length === 1) {
        const rootNode = workflow.nodes.find((n) => n.id === parts[0]);
        if (rootNode) return toDisplayName(rootNode, `Node ${parts[0]}`);
      } else {
        let subgraphId: string | null = null;
        const rootPlaceholder = workflow.nodes.find((n) => n.id === parts[0]);
        if (rootPlaceholder) subgraphId = rootPlaceholder.type;

        for (let i = 1; i < parts.length; i += 1) {
          if (!subgraphId) break;
          const subgraph = workflow.definitions?.subgraphs?.find(
            (sg) => sg.id === subgraphId,
          );
          if (!subgraph) break;
          const nodeId = parts[i];
          const node = (subgraph.nodes ?? []).find((n) => n.id === nodeId);
          if (!node) break;
          if (i === parts.length - 1) {
            return toDisplayName(node, `Node ${nodeId}`);
          }
          subgraphId = node.type;
        }
      }
      const leaf = parts[parts.length - 1];
      return Number.isFinite(leaf) ? `Node ${leaf}` : `Node ${executingNodePath}`;
    }
    return `Node ${executingNodePath}`;
  }

  if (!executingNodeId) return null;
  const node = workflow.nodes.find((n) => String(n.id) === executingNodeId);
  if (!node) return `Node ${executingNodeId}`;
  return toDisplayName(node, `Node ${executingNodeId}`);
}

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

  const nodeErrorCount = Object.values(nodeErrors).reduce(
    (total, errors) => total + errors.length,
    0,
  );
  const hasNodeErrors = nodeErrorCount > 0;
  const isWorkflowLoadError =
    Boolean(error?.startsWith("Workflow load error")) || hasNodeErrors;
  const errorTitle = isWorkflowLoadError
    ? "Workflow load error"
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
  const hasErrorToast = (Boolean(error) || hasNodeErrors) && !errorsDismissed;
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
            className="bg-red-100 text-red-900 rounded-xl shadow-lg px-4 py-3 w-[70vw] max-w-sm"
            role="button"
            tabIndex={0}
            onClick={handleErrorClick}
            onKeyDown={handleErrorKeyDown}
          >
            <div className="error-toast-content flex items-start justify-between gap-3">
              <div className="error-text-container pr-16">
                <div className="error-title text-sm font-semibold text-red-800">
                  {errorTitle}
                </div>
                <div className="error-message mt-1 text-xs text-red-800 break-words">
                  {errorMessage}
                </div>
              </div>
            </div>
          </div>
          <button
            id="error-dismiss-button"
            type="button"
            aria-label="Dismiss error"
            className="absolute top-3 right-3 shrink-0 px-3 py-1 text-xs font-semibold bg-red-700 text-white rounded-full z-10"
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
          className="relative bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-2 w-[70vw] max-w-sm pointer-events-auto"
        >
          <button
            type="button"
            aria-label="Dismiss progress"
            className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600"
            onClick={handleProgressDismiss}
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
          <div className="executing-node-name text-sm font-semibold text-gray-900">
            {executingNodeLabel || "Running"}
          </div>
          <div className="node-progress-info mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>Progress</span>
            <span>{displayNodeProgress}%</span>
          </div>
          <div className="node-progress-track mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="node-progress-bar h-full bg-green-500 transition-none"
              style={{
                width: `${Math.min(100, Math.max(0, displayNodeProgress))}%`,
              }}
            />
          </div>
          {overallProgress !== null && (
            <div className="overall-progress-container">
              <div className="overall-progress-info mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>Overall</span>
                <span>{overallProgress}%</span>
              </div>
              <div className="overall-progress-track mt-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="overall-progress-bar h-full bg-blue-500 transition-none"
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
