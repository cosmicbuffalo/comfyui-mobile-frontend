import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CloseIcon,
  InfiniteLoopIcon,
  ChevronLeftBoldIcon,
  WarningTriangleIcon,
} from '@/components/icons';
import { Dialog } from '@/components/modals/Dialog';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import {
  useWorkflowStore,
  isWorkflowModified,
  MAX_WORKFLOW_SESSIONS,
  type WorkflowSource,
} from '@/hooks/useWorkflow';
import type { Workflow } from '@/api/types';
import { useQueueStore } from '@/hooks/useQueue';
import { getDisplayName } from '@/components/AppMenu/userWorkflowHelpers';
import {
  resolveWorkflowTabRunKey,
  shouldShowWorkflowTabActivity,
} from './workflowTabActivity';

// Width (px) of the squeezing edge indicator band. Revealing the active tab
// also leaves a 2× gap so the tab clears the indicator rather than tucking
// right under it.
const INDICATOR_WIDTH = 48;

interface SessionView {
  id: string;
  label: string;
  isActive: boolean;
  isModified: boolean;
  isSaving: boolean;
  isInfinite: boolean;
  isExecuting: boolean;
  workflow: Workflow | null;
  runKey: string | null;
  queuedCount: number;
  hasError: boolean;
}

function sessionDisplayLabel(
  filename: string | null,
  source: WorkflowSource | null,
): string {
  if (filename) return getDisplayName(filename);
  if (source && source.type === 'template') return source.templateName;
  return 'Untitled';
}

/** Small circular-progress ring wrapping the left-slot indicator. */
function ProgressRing({
  progress,
  active,
  children,
}: {
  progress: number;
  active: boolean;
  children: React.ReactNode;
}) {
  const r = 11;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, progress));
  const offset = c * (1 - clamped / 100);
  return (
    <span className="relative inline-flex items-center justify-center w-6 h-6 shrink-0">
      {active && (
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-white/15"
          />
          <circle
            cx="12"
            cy="12"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            className="text-cyan-300 transition-[stroke-dashoffset] duration-200"
          />
        </svg>
      )}
      <span className="relative flex items-center justify-center text-[10px] font-bold leading-none">
        {children}
      </span>
    </span>
  );
}

interface WorkflowTablineProps {
  showTabs?: boolean;
}

function WorkflowSessionTab({
  view,
  workflowDurationStats,
  onSwitch,
  onRequestClose,
}: {
  view: SessionView;
  workflowDurationStats: Record<string, { avgMs: number; count: number }>;
  onSwitch: (id: string) => void;
  onRequestClose: (view: SessionView) => void;
}) {
  const overallProgress = useOverallProgress({
    workflow: view.workflow,
    runKey: view.runKey,
    isRunning: view.isExecuting,
    workflowDurationStats,
  });
  const progress = overallProgress ?? 0;
  // `overallProgress` stays non-null through the brief "hold at 100%" after the
  // last prompt leaves the queue. Keep the ring shown and active during that
  // window so the run animates to completion instead of vanishing the instant
  // queuedCount hits 0.
  const inCompletionHold = overallProgress != null;
  const ringActive = view.isExecuting || inCompletionHold;
  const showActivity =
    shouldShowWorkflowTabActivity(view.isInfinite, view.queuedCount) || inCompletionHold;

  return (
    <div
      role="tab"
      aria-selected={view.isActive}
      data-active={view.isActive}
      onClick={() => onSwitch(view.id)}
      className={
        // Width = 1/3 of the bar on small screens; capped at 300px once the
        // viewport is wide enough that a third would exceed it (>900px).
        'group flex basis-1/3 grow-0 shrink-0 min-w-0 max-w-[300px] items-center gap-1.5 px-2 py-1.5 text-sm select-none cursor-pointer border-r border-white/10 transition-colors ' +
        (view.isActive
          ? 'bg-slate-800 text-slate-100'
          : 'bg-slate-900/70 text-slate-300 hover:bg-slate-800/70')
      }
    >
      {showActivity && (
        <span className="shrink-0 text-slate-300">
          {view.isInfinite ? (
            <ProgressRing progress={progress} active={ringActive}>
              <InfiniteLoopIcon
                className={`w-3.5 h-3.5 text-cyan-300 ${view.isExecuting ? 'animate-spin' : ''}`}
              />
            </ProgressRing>
          ) : (
            <ProgressRing progress={progress} active={ringActive}>
              {view.queuedCount}
            </ProgressRing>
          )}
        </span>
      )}

      {view.hasError && (
        <span
          className="shrink-0 text-red-400"
          role="img"
          aria-label="This workflow's last run errored"
          title="This workflow's last run errored — open the tab to see the error"
        >
          <WarningTriangleIcon className="w-3.5 h-3.5" />
        </span>
      )}

      <span className="flex-1 min-w-0 flex items-baseline justify-center gap-0.5 text-center">
        <span className={`min-w-0 truncate ${!showActivity && !view.hasError ? 'ml-1' : ''} ${view.isModified ? 'italic' : ''}`}>
          {view.label}
        </span>
        {view.isSaving ? (
          <span
            className="shrink-0 w-3 h-3 rounded-full border-2 border-cyan-300/30 border-t-cyan-300 animate-spin"
            role="status"
            aria-label="Saving"
          />
        ) : view.isModified ? (
          <span className="shrink-0 text-cyan-300 text-[20px] font-bold leading-none" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>

      <span className="shrink-0 w-5 h-5 flex items-center justify-center">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRequestClose(view);
          }}
          className="text-slate-400 hover:text-slate-100 flex items-center justify-center"
          aria-label={`Close ${view.label}${view.isModified ? ' with unsaved changes' : ''}`}
          title={view.isModified ? 'Close workflow with unsaved changes' : 'Close workflow'}
        >
          <CloseIcon className="w-3.5 h-3.5" />
        </button>
      </span>
    </div>
  );
}

export function WorkflowTabline({ showTabs = true }: WorkflowTablineProps) {
  const [closeConfirmTarget, setCloseConfirmTarget] = useState<{
    view: SessionView;
    action: 'close' | 'makeRoom';
  } | null>(null);
  const sessions = useWorkflowStore((s) => s.sessions);
  const activeSessionId = useWorkflowStore((s) => s.activeSessionId);
  const parkedSessions = useWorkflowStore((s) => s.parkedSessions);
  const infiniteLoopSessionId = useWorkflowStore((s) => s.infiniteLoopSessionId);
  const savingSessionId = useWorkflowStore((s) => s.savingSessionId);
  const promptToSession = useWorkflowStore((s) => s.promptToSession);
  const closeForNewWorkflowRequest = useWorkflowStore(
    (s) => s.closeForNewWorkflowRequest,
  );
  // Active-session flat fields (for the active tab's live state).
  const workflow = useWorkflowStore((s) => s.workflow);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const workflowSource = useWorkflowStore((s) => s.workflowSource);
  const executingPromptId = useWorkflowStore((s) => s.executingPromptId);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);

  const switchToSession = useWorkflowStore((s) => s.switchToSession);
  const closeSession = useWorkflowStore((s) => s.closeSession);
  const resolveCloseForNewWorkflow = useWorkflowStore(
    (s) => s.resolveCloseForNewWorkflow,
  );
  const cancelCloseForNewWorkflow = useWorkflowStore(
    (s) => s.cancelCloseForNewWorkflow,
  );

  const running = useQueueStore((s) => s.running);
  const pending = useQueueStore((s) => s.pending);
  // Background (parked) tabs that hit a run error carry a marker here; the active
  // tab's error lives in the global banner instead.
  const sessionErrors = useWorkflowErrorsStore((s) => s.sessionErrors);

  // Per-session queued count: queue items whose prompt_id maps to the session.
  const queuedCountBySession = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of [...running, ...pending]) {
      const sid = promptToSession[item.prompt_id];
      if (sid) counts[sid] = (counts[sid] ?? 0) + 1;
    }
    return counts;
  }, [running, pending, promptToSession]);
  const runningPromptIds = useMemo(
    () => running.map((item) => item.prompt_id),
    [running],
  );

  const views: SessionView[] = useMemo(() => {
    return sessions.map((meta) => {
      const isActive = meta.id === activeSessionId;
      const parked = parkedSessions[meta.id];
      const wf = isActive ? workflow : parked?.workflow ?? null;
      const orig = isActive ? originalWorkflow : parked?.originalWorkflow ?? null;
      const filename = isActive
        ? currentFilename
        : parked?.currentFilename ?? null;
      const source = isActive ? workflowSource : parked?.workflowSource ?? null;
      const isModified = isWorkflowModified(wf, orig);
      const runKey = resolveWorkflowTabRunKey({
        sessionId: meta.id,
        activeSessionId,
        sessionExecutingPromptId: isActive
          ? executingPromptId
          : parked?.executingPromptId ?? null,
        runningPromptIds,
        promptToSession,
      });
      return {
        id: meta.id,
        label: sessionDisplayLabel(filename, source),
        isActive,
        isModified,
        isSaving: savingSessionId === meta.id,
        isInfinite: infiniteLoopSessionId === meta.id,
        isExecuting: runKey !== null,
        workflow: wf,
        runKey,
        queuedCount: queuedCountBySession[meta.id] ?? 0,
        hasError: Boolean(sessionErrors[meta.id]),
      };
    });
  }, [
    sessions,
    sessionErrors,
    activeSessionId,
    parkedSessions,
    workflow,
    originalWorkflow,
    currentFilename,
    workflowSource,
    infiniteLoopSessionId,
    savingSessionId,
    executingPromptId,
    queuedCountBySession,
    runningPromptIds,
    promptToSession,
  ]);

  const requestCloseSession = (view: SessionView) => {
    if (view.isModified) {
      setCloseConfirmTarget({ view, action: 'close' });
      return;
    }
    closeSession(view.id);
  };

  const requestMakeRoomForWorkflow = (view: SessionView) => {
    if (view.isModified) {
      setCloseConfirmTarget({ view, action: 'makeRoom' });
      return;
    }
    resolveCloseForNewWorkflow(view.id);
  };

  // Edge indicators fade in/out proportionally to how far tabs are scrolled off
  // each side (0 = edge fully reached, 1 = at least FADE px hidden), so they
  // shrink away smoothly as a tab becomes fully visible rather than popping off.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [leftIndicator, setLeftIndicator] = useState(0);
  const [rightIndicator, setRightIndicator] = useState(0);
  // Which side (if any) the currently-selected tab is hidden under — that
  // side's button turns cyan and its first click reveals the active tab.
  const [activeHiddenSide, setActiveHiddenSide] = useState<'left' | 'right' | null>(null);

  const getActiveTab = () =>
    scrollRef.current?.querySelector<HTMLElement>('[data-active="true"]') ?? null;

  const revealActiveTab = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current;
    const active = getActiveTab();
    if (!el || !active) return;

    const cRect = el.getBoundingClientRect();
    const aRect = active.getBoundingClientRect();
    const maxScroll = el.scrollWidth - el.clientWidth;
    const leftBuffer = el.scrollLeft > 0 ? 2 * INDICATOR_WIDTH : 0;
    const rightBuffer = el.scrollLeft < maxScroll ? 2 * INDICATOR_WIDTH : 0;
    const leftEdge = cRect.left + leftBuffer;
    const rightEdge = cRect.right - rightBuffer;

    if (aRect.left < leftEdge - 1) {
      el.scrollBy({
        left: aRect.left - leftEdge,
        behavior,
      });
      return;
    }
    if (aRect.right > rightEdge + 1) {
      el.scrollBy({
        left: aRect.right - rightEdge,
        behavior,
      });
    }
  }, []);

  const updateScrollShadows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const FADE = 40;
    // Mobile browsers settle momentum scrolls at fractional positions, so a
    // strip scrolled "fully right" often reads maxScroll - ~0.5px. Without an
    // epsilon that leaves the edge button at ~1% opacity but still
    // intercepting taps — sitting exactly over the last tab's close button.
    const EDGE_EPSILON = 2;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const hiddenLeft = el.scrollLeft;
    const hiddenRight = maxScroll - el.scrollLeft;
    setLeftIndicator(hiddenLeft <= EDGE_EPSILON ? 0 : Math.min(1, hiddenLeft / FADE));
    setRightIndicator(hiddenRight <= EDGE_EPSILON ? 0 : Math.min(1, hiddenRight / FADE));

    const active = el.querySelector<HTMLElement>('[data-active="true"]');
    if (!active) {
      setActiveHiddenSide(null);
      return;
    }
    const cRect = el.getBoundingClientRect();
    const aRect = active.getBoundingClientRect();
    if (aRect.left < cRect.left - 1) setActiveHiddenSide('left');
    else if (aRect.right > cRect.right + 1) setActiveHiddenSide('right');
    else setActiveHiddenSide(null);
  }, []);

  // Clicking an edge button first reveals the active tab if it's hidden under
  // that side; otherwise (active already visible) it jumps to that far end.
  const scrollLeftEdge = () => {
    const el = scrollRef.current;
    if (!el) return;
    const active = getActiveTab();
    const cRect = el.getBoundingClientRect();
    if (active) {
      const aRect = active.getBoundingClientRect();
      if (aRect.left < cRect.left - 1) {
        // Reveal the active tab, leaving a 2× indicator-width gap from the edge.
        el.scrollBy({
          left: aRect.left - cRect.left - 2 * INDICATOR_WIDTH,
          behavior: 'smooth',
        });
        return;
      }
    }
    el.scrollTo({ left: 0, behavior: 'smooth' });
  };
  const scrollRightEdge = () => {
    const el = scrollRef.current;
    if (!el) return;
    const active = getActiveTab();
    const cRect = el.getBoundingClientRect();
    if (active) {
      const aRect = active.getBoundingClientRect();
      if (aRect.right > cRect.right + 1) {
        // Reveal the active tab, leaving a 2× indicator-width gap from the edge.
        el.scrollBy({
          left: aRect.right - cRect.right + 2 * INDICATOR_WIDTH,
          behavior: 'smooth',
        });
        return;
      }
    }
    el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Initial measure after layout settles (also keeps the setState out of
    // the synchronous effect body).
    const initialMeasure = window.requestAnimationFrame(updateScrollShadows);
    el.addEventListener('scroll', updateScrollShadows, { passive: true });
    window.addEventListener('resize', updateScrollShadows);
    return () => {
      window.cancelAnimationFrame(initialMeasure);
      el.removeEventListener('scroll', updateScrollShadows);
      window.removeEventListener('resize', updateScrollShadows);
    };
    // Re-measure when the tab count or the active tab changes.
  }, [updateScrollShadows, views.length, activeSessionId]);

  useEffect(() => {
    if (!showTabs || sessions.length <= 1) return;
    const frameId = window.requestAnimationFrame(() => {
      revealActiveTab('auto');
    });
    const timeoutId = window.setTimeout(() => {
      revealActiveTab('smooth');
    }, 80);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [activeSessionId, revealActiveTab, sessions.length, showTabs]);

  const shouldRenderTabs = showTabs && sessions.length > 1;
  if (!shouldRenderTabs && !closeForNewWorkflowRequest) return null;

  const confirmCloseSession = () => {
    if (!closeConfirmTarget) return;
    if (closeConfirmTarget.action === 'makeRoom') {
      resolveCloseForNewWorkflow(closeConfirmTarget.view.id);
    } else {
      closeSession(closeConfirmTarget.view.id);
    }
    setCloseConfirmTarget(null);
  };

  return (
    <>
      {showTabs && sessions.length > 1 && (
        // Each tab is a fixed third of the bar (capped at 300px on wide
        // screens); the strip scrolls horizontally once tabs exceed the width,
        // with edge gradients hinting at tabs scrolled off-screen.
        <div
          className="relative bg-slate-900/95 border-b border-white/10"
          data-swipe-nav-ignore="true"
        >
          <div
            ref={scrollRef}
            className="flex items-stretch overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {views.map((view) => (
              <WorkflowSessionTab
                key={view.id}
                view={view}
                workflowDurationStats={workflowDurationStats}
                onSwitch={switchToSession}
                onRequestClose={requestCloseSession}
              />
            ))}
          </div>
          {/* Squeezing gradient cue (visual only) — retracts into the edge. */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent"
            style={{ width: `${leftIndicator * INDICATOR_WIDTH}px` }}
          />
          <div
            className="pointer-events-none absolute inset-y-0 right-0 overflow-hidden bg-gradient-to-l from-slate-950 via-slate-950/80 to-transparent"
            style={{ width: `${rightIndicator * INDICATOR_WIDTH}px` }}
          />
          {/* Circular scroll buttons, inset from the edge. Cyan while the
              selected tab is hidden under that side, else the top-bar color. */}
          <button
            type="button"
            aria-label="Scroll to first tab"
            onClick={scrollLeftEdge}
            className={`absolute top-1/2 left-2 -translate-y-1/2 w-6 h-6 rounded-full border shadow flex items-center justify-center text-white transition-colors duration-200 ${
              activeHiddenSide === 'left'
                ? 'bg-slate-800 border-white/10'
                : 'bg-slate-950/88 border-white/10 text-slate-200'
            }`}
            style={{
              opacity: leftIndicator,
              // A barely-visible button must never swallow taps meant for the
              // tab (and its close X) underneath it.
              pointerEvents: leftIndicator > 0.3 ? 'auto' : 'none',
            }}
          >
            <ChevronLeftBoldIcon className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            aria-label="Scroll to last tab"
            onClick={scrollRightEdge}
            className={`absolute top-1/2 right-2 -translate-y-1/2 w-6 h-6 rounded-full border shadow flex items-center justify-center text-white transition-colors duration-200 ${
              activeHiddenSide === 'right'
                ? 'bg-slate-800 border-white/10'
                : 'bg-slate-950/88 border-white/10 text-slate-200'
            }`}
            style={{
              opacity: rightIndicator,
              // A barely-visible button must never swallow taps meant for the
              // tab (and its close X) underneath it.
              pointerEvents: rightIndicator > 0.3 ? 'auto' : 'none',
            }}
          >
            <ChevronLeftBoldIcon className="w-3.5 h-3.5 rotate-180" />
          </button>
        </div>
      )}

      {/* "Choose which to close" dialog when opening a 4th workflow. */}
      {closeForNewWorkflowRequest && (
        <div
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 p-4"
          onClick={cancelCloseForNewWorkflow}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-white/10 bg-slate-900 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-slate-100">
              Close a workflow
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              You can have up to {MAX_WORKFLOW_SESSIONS} workflows open at once.
              Choose one to close to make room for the new one.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              {views.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => requestMakeRoomForWorkflow(view)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-slate-800/70 px-3 py-2 text-left text-sm text-slate-100 hover:bg-slate-700"
                >
                  <span className="truncate">{view.label}</span>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      view.isModified ? 'text-cyan-300' : 'text-slate-500'
                    }`}
                    title={view.isModified ? 'Unsaved changes' : 'No unsaved changes'}
                  >
                    {view.isModified ? '* unsaved' : 'saved'}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={cancelCloseForNewWorkflow}
              className="mt-3 w-full rounded-lg border border-white/10 bg-slate-800/50 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {closeConfirmTarget && (
        <Dialog
          zIndex={3100}
          onClose={() => setCloseConfirmTarget(null)}
          title={
            closeConfirmTarget.action === 'makeRoom'
              ? 'Discard changes and load workflow?'
              : 'Close unsaved workflow?'
          }
          description={
            closeConfirmTarget.action === 'makeRoom'
              ? `"${closeConfirmTarget.view.label}" has unsaved changes. Dropping it will discard those changes so the new workflow can open.`
              : `"${closeConfirmTarget.view.label}" has unsaved changes. Closing this tab will discard them.`
          }
          actions={[
            {
              label: 'Cancel',
              onClick: () => setCloseConfirmTarget(null),
              variant: 'secondary',
            },
            {
              label: closeConfirmTarget.action === 'makeRoom'
                ? 'Discard and load'
                : 'Close without saving',
              onClick: confirmCloseSession,
              variant: 'danger',
              autoFocus: true,
            },
          ]}
        />
      )}
    </>
  );
}
