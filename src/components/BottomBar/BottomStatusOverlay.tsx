import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import { CheckIcon, ClipboardIcon, XMarkIcon } from '@/components/icons';
import { copyTextToClipboard } from '@/utils/clipboard';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useWidgetModalOpenStore } from '@/hooks/useWidgetModalOpen';
import { useQueueStore } from '@/hooks/useQueue';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import { useConnectionStatusStore } from '@/hooks/useConnectionStatus';
import { useLiveProgressStore } from '@/hooks/useLiveProgress';
import { resolveExecutingNodeLabel } from '@/utils/executionLabels';
import { useI18n } from '@/i18n';

// Clamp the inline error message so a long backend traceback can't grow the toast
// off-screen (which would carry the Dismiss button out of reach); the full text is
// available via the Copy button.
const ERROR_MESSAGE_CLAMP_LINES = 5;
const clampLinesStyle = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical' as const,
  WebkitLineClamp: ERROR_MESSAGE_CLAMP_LINES,
  overflow: 'hidden',
};

export function BottomStatusOverlay() {
  const { t } = useI18n();
  const currentPanel = useNavigationStore((s) => s.currentPanel);
  const viewerOpen = useImageViewerStore((s) => s.viewerOpen);
  const widgetModalOpen = useWidgetModalOpenStore((s) => s.openCount > 0);
  const workflow = useWorkflowStore((s) => s.workflow);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const executingNodeId = useWorkflowStore((s) => s.executingNodeId);
  const executingNodePath = useWorkflowStore((s) => s.executingNodePath);
  const executingPromptId = useWorkflowStore((s) => s.executingPromptId);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);
  const error = useWorkflowErrorsStore((s) => s.error);
  const errorKind = useWorkflowErrorsStore((s) => s.errorKind);
  const nodeErrors = useWorkflowErrorsStore((s) => s.nodeErrors);
  const nodeErrorsByItemKey = useWorkflowErrorsStore((s) => s.nodeErrorsByItemKey);
  const nodeErrorsFromRun = useWorkflowErrorsStore((s) => s.nodeErrorsFromRun);
  const errorsDismissed = useWorkflowErrorsStore((s) => s.errorsDismissed);
  const setErrorsDismissed = useWorkflowErrorsStore((s) => s.setErrorsDismissed);
  const scrollToNode = useWorkflowStore((s) => s.scrollToNode);
  const errorCycleIndex = useWorkflowErrorsStore((s) => s.errorCycleIndex);
  const setErrorCycleIndex = useWorkflowErrorsStore((s) => s.setErrorCycleIndex);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const running = useQueueStore((s) => s.running);
  const isConnected = useConnectionStatusStore((s) => s.isConnected);
  const hasEverConnected = useConnectionStatusStore((s) => s.hasEverConnected);
  const liveProgressSnapshot = useLiveProgressStore((s) => s.snapshot);
  const liveProgressConnected = useLiveProgressStore((s) => s.isConnected);
  const liveProgressEverConnected = useLiveProgressStore((s) => s.hasEverConnected);
  const [dismissedRunKey, setDismissedRunKey] = useState<string | null>(null);
  const [errorCopied, setErrorCopied] = useState(false);

  const isQueuePanel = currentPanel === 'queue';
  const isOutputsPanel = currentPanel === 'outputs';
  const isWorkflowPanel = currentPanel === 'workflow';

  const nodeErrorCount = Object.values(nodeErrors).reduce(
    (total, errors) => total + errors.length,
    0,
  );
  const hasNodeErrors = nodeErrorCount > 0;
  // Run/queue node errors (ComfyUI excluded a branch from the run) are surfaced
  // loudly on every panel — the user has just hit Run and is usually watching
  // the queue. Load-time node errors only matter on the workflow panel.
  const isRunNodeError = hasNodeErrors && nodeErrorsFromRun;
  // `errorKind` is set by whoever raised the error. The English prefix test is
  // only a fallback for a message persisted by a build that predates the kind
  // field; new errors always carry one.
  const isWorkflowLoadError =
    errorKind === "workflow-load" ||
    (errorKind == null && Boolean(error?.startsWith("Workflow load error"))) ||
    (hasNodeErrors && !nodeErrorsFromRun);
  const isBackendConnectionError =
    errorKind === "backend-connection" ||
    (errorKind == null && Boolean(error?.startsWith("Backend connection")));
  const skippedNodeCount = Object.keys(nodeErrors).length;

  const resolveErrorTitle = () => {
    if (isWorkflowLoadError) return t("Workflow load error");
    if (isBackendConnectionError) return t("Backend connection");
    if (isRunNodeError && !error) return t("Nodes skipped");
    return t("Prompt error");
  };
  const errorTitle = resolveErrorTitle();
  const stripWorkflowLoadErrorPrefix = (message: string) => {
    const prefixes = ["Workflow load error:", t("Workflow load error:")];
    for (const prefix of prefixes) {
      if (message.startsWith(prefix)) return message.slice(prefix.length).trim();
    }
    return message;
  };
  // Fallback copy for when there is no explicit `error` string — derived from
  // whichever kind of node errors are outstanding.
  const resolveNodeErrorSummary = () => {
    if (isRunNodeError) {
      return skippedNodeCount === 1
        ? t("{count} node had invalid inputs and was skipped — tap to view.", { count: skippedNodeCount })
        : t("{count} nodes had invalid inputs and were skipped — tap to view.", { count: skippedNodeCount });
    }
    if (hasNodeErrors) {
      return nodeErrorCount === 1
        ? t("{count} input references missing options.", { count: nodeErrorCount })
        : t("{count} inputs reference missing options.", { count: nodeErrorCount });
    }
    return null;
  };
  const errorMessage = isWorkflowLoadError && error
    ? stripWorkflowLoadErrorPrefix(error)
    : error ?? resolveNodeErrorSummary();

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
  const hasActiveRun = Boolean(runKey) || isExecuting || running.length > 0;
  const isReconnecting = !isConnected && hasEverConnected && hasActiveRun;
  const liveProgress = runKey && liveProgressSnapshot?.promptId === runKey
    ? liveProgressSnapshot
    : null;
  const progressStreamUnavailable =
    isConnected && liveProgressEverConnected && !liveProgressConnected && hasActiveRun;
  const displayedNodeName = liveProgress
    ? (liveProgress.nodeName ?? t("Running"))
    : (executingNodeLabel ?? t("Running"));
  const nodeProgressPercent = liveProgress?.nodeName
    ? liveProgress.nodeProgressPercent
    : null;
  // Workflow load errors (and node errors) are only relevant on the workflow
  // panel — don't surface them while browsing the queue or outputs.
  const hasErrorToast = (Boolean(error) || hasNodeErrors) && !errorsDismissed
    && (!isWorkflowLoadError || isWorkflowPanel);
  const progressDismissed = dismissedRunKey !== null && dismissedRunKey === runKey;
  // A fullscreen widget editor suppresses the progress card entirely — it
  // would otherwise poke through the translucent backdrop and update behind
  // the editor. It re-appears (per the rules above) as soon as the modal closes.
  const showProgress =
    (overallProgress !== null || isReconnecting) &&
    !isQueuePanel &&
    !isOutputsPanel &&
    !widgetModalOpen &&
    !progressDismissed;
  const visible = !viewerOpen && (hasErrorToast || showProgress);
  const shouldShowError = hasErrorToast;

  // Every node carrying an error, in a stable order, as {itemKey, id} pairs.
  // Item keys are what the cycle walks: an error can belong to a node inside a
  // subgraph, which is not in `workflow.nodes` at all (a stock template is
  // often ONE placeholder over a subgraph holding every real node), and keying
  // the walk on root nodes found nothing and made the toast a dead tap.
  // `scrollToNode` travels to the item's own scope, so a jump into a subgraph
  // needs nothing extra here.
  const errorItems = useMemo(() => {
    if (!workflow) return [];
    const items: Array<{ itemKey: string; nodeId: number | null }> = [];
    const seen = new Set<string>();
    // Root nodes first, in workflow order, so the common case cycles in the
    // order the user sees; then anything reachable only by item key.
    for (const node of workflow.nodes) {
      const itemKey = node.itemKey;
      const hasError = itemKey
        ? nodeErrorsByItemKey[itemKey]?.length
        : nodeErrors[String(node.id)]?.length;
      if (!hasError || !itemKey) continue;
      seen.add(itemKey);
      items.push({ itemKey, nodeId: node.id });
    }
    for (const [itemKey, errors] of Object.entries(nodeErrorsByItemKey)) {
      if (!errors.length || seen.has(itemKey)) continue;
      seen.add(itemKey);
      items.push({ itemKey, nodeId: null });
    }
    return items;
  }, [workflow, nodeErrors, nodeErrorsByItemKey]);

  const handleErrorClick = () => {
    if (!hasNodeErrors) return;
    if (errorItems.length === 0) return;

    const nextIndex = errorCycleIndex % errorItems.length;
    const target = errorItems[nextIndex];
    if (!target) return;
    const label = `Error #${nextIndex + 1}`;
    setErrorCycleIndex((nextIndex + 1) % errorItems.length);

    if (target.nodeId !== null) {
      window.dispatchEvent(new CustomEvent('workflow-label-error-node', { detail: { nodeId: target.nodeId, label } }));
      window.dispatchEvent(new CustomEvent('workflow-scroll-to-node', { detail: { nodeId: target.nodeId, label } }));
    }
    scrollToNode(target.itemKey, label);
  };

  const handleErrorKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleErrorClick();
    }
  };

  const buildErrorClipboardText = () => {
    const parts: string[] = [errorTitle];
    if (errorMessage) parts.push(errorMessage);
    if (hasNodeErrors) {
      for (const [id, errs] of Object.entries(nodeErrors)) {
        for (const e of errs) {
          const detail =
            e.details && e.details !== e.message ? ` — ${e.details}` : '';
          parts.push(`[node ${id}] ${e.inputName ? `${e.inputName}: ` : ''}${e.message}${detail}`);
        }
      }
    }
    return parts.join('\n');
  };

  const handleErrorCopyPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  const handleErrorCopyClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const ok = await copyTextToClipboard(buildErrorClipboardText());
    if (ok) {
      setErrorCopied(true);
      window.setTimeout(() => setErrorCopied(false), 1500);
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

  // Portaled to the body: inside #bottom-bar-root (z-[2200]) any z-index here
  // is only ranked against the bar's own children, so the banner painted over
  // every body-level popover regardless of its value (see zLayers.ts). On the
  // body, z-[950] puts this passive status layer below every interactive
  // popover (context menus start at z-[1000], modal backdrops at z-[1450]) —
  // with a load error up, the banner used to cover the bottom entries of any
  // card menu opened near the fold.
  return createPortal(
    <div
      id="bottom-status-overlay"
      className="fixed inset-x-0 bottom-20 z-[950] flex flex-col items-center gap-3 pointer-events-none"
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
            <div className="error-title text-sm font-semibold text-red-200">
              {errorTitle}
            </div>
            <div className="error-message mt-1 text-xs text-slate-200 break-words" style={clampLinesStyle}>
              {errorMessage}
            </div>
            {/* Action row at the bottom — stays put because the message above is
                clamped, so the toast can never grow these buttons off-screen. */}
            <div className="error-actions mt-2 flex items-center justify-end gap-1.5">
              <button
                id="error-copy-button"
                type="button"
                aria-label={t("Copy error to clipboard")}
                className="flex items-center gap-1 shrink-0 px-2.5 py-1 text-xs font-semibold bg-red-600/80 hover:bg-red-600 text-white rounded-full"
                onPointerDown={handleErrorCopyPointerDown}
                onClick={handleErrorCopyClick}
              >
                {errorCopied ? <CheckIcon className="w-3 h-3" /> : <ClipboardIcon className="w-3 h-3" />}
                {errorCopied ? t('Copied') : t('Copy')}
              </button>
              <button
                id="error-dismiss-button"
                type="button"
                aria-label={t("Dismiss error")}
                className="shrink-0 px-3 py-1 text-xs font-semibold bg-red-600 text-white rounded-full"
                onPointerDown={handleErrorDismissPointerDown}
                onClick={handleErrorDismissClick}
              >
                {t('Dismiss')}
              </button>
            </div>
          </div>
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
            aria-label={t("Dismiss progress")}
            className="absolute -top-3.5 -right-3.5 w-7 h-7 rounded-full flex items-center justify-center bg-slate-800 border border-white/15 text-slate-300 shadow-md hover:text-white hover:bg-slate-700"
            onPointerDown={handleProgressDismissPointerDown}
            onClick={handleProgressDismissClick}
          >
            <XMarkIcon className="w-4 h-4" />
          </button>
          {isReconnecting ? (
            <div
              className="progress-reconnecting flex items-center justify-center gap-2 py-1 text-xs font-semibold text-cyan-200"
              role="status"
              aria-live="polite"
            >
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-cyan-300/30 border-t-cyan-300 animate-spin"
                aria-hidden="true"
              />
              <span>{t("Reconnecting…")}</span>
            </div>
          ) : progressStreamUnavailable ? (
            <div className="progress-stream-unavailable py-1" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                <span className="text-slate-200">{t("Running")}</span>
                <span className="text-cyan-200">…</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800/75">
                <div className="h-full w-1/3 rounded-full bg-cyan-400/80 animate-pulse" />
              </div>
            </div>
          ) : (
            <>
              <div className="node-progress-info flex min-w-0 items-center justify-between gap-2 text-xs leading-snug">
                <span className="executing-node-name min-w-0 truncate font-semibold text-slate-100">
                  {liveProgress?.nodeIndex !== null && liveProgress?.nodesTotal ? (
                    <span className="node-progress-position mr-1.5 text-cyan-200">
                      {liveProgress.nodeIndex}/{liveProgress.nodesTotal}
                    </span>
                  ) : null}
                  {displayedNodeName}
                </span>
                {nodeProgressPercent !== null && (
                  <span className="node-progress-percent shrink-0 font-semibold text-emerald-200">
                    {nodeProgressPercent}%
                  </span>
                )}
              </div>
              <div className="node-progress-track mt-1 h-1 rounded-full bg-slate-800/75 overflow-hidden">
                <div
                  key={`${runKey ?? 'idle'}:${liveProgress?.nodeName ?? 'between-nodes'}`}
                  className="node-progress-bar h-full bg-emerald-400 transition-[width] duration-200 ease-linear"
                  style={{
                    width: `${Math.min(100, Math.max(0, nodeProgressPercent ?? 0))}%`,
                  }}
                />
              </div>
              {overallProgress !== null && (
                <div className="overall-progress-container">
                  <div className="overall-progress-info mt-1.5 flex items-center justify-between gap-2 text-[10px] leading-none text-slate-400">
                    <span>{t("Overall")}</span>
                    <span className="font-semibold text-cyan-200">{overallProgress}%</span>
                  </div>
                  <div className="overall-progress-track mt-1 h-1 rounded-full bg-slate-800/75 overflow-hidden">
                    <div
                      key={runKey ?? 'idle'}
                      className="overall-progress-bar h-full bg-cyan-400 transition-[width] duration-200 ease-linear"
                      style={{
                        width: `${Math.min(100, Math.max(0, overallProgress))}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
