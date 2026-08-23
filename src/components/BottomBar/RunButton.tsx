import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';
import { useLongPress } from '@/hooks/useLongPress';
import { appChromePrimaryButtonClassName, appChromePrimaryButtonDisabledClassName } from '@/components/chromeStyles';
import { useI18n } from '@/i18n';

const FRONT_QUEUE_CONFIRMATION_MS = 1800;

export function RunButton() {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const runCount = useWorkflowStore((s) => s.runCount);
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const infiniteLoopAwaitingRun = useWorkflowStore((s) => s.infiniteLoopAwaitingRun);
  const setInfiniteLoop = useWorkflowStore((s) => s.setInfiniteLoop);
  const isStopping = useWorkflowStore((s) => s.isStopping);
  const setIsStopping = useWorkflowStore((s) => s.setIsStopping);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const isLoading = useWorkflowStore((s) => s.isLoading);
  const queueWorkflow = useWorkflowStore((s) => s.queueWorkflow);
  const interrupt = useQueueStore((s) => s.interrupt);
  const running = useQueueStore((s) => s.running);
  const pending = useQueueStore((s) => s.pending);
  const canRun = workflow !== null;

  // Bridge the brief gap between iterations (when isExecuting flips false before
  // the websocket re-queues the loop) so the Stop button doesn't flash to Run.
  const hasActiveRun =
    isExecuting || isLoading || running.length > 0 || pending.length > 0;
  // While infinite mode is merely *armed* (toggled on but the user hasn't hit
  // Run yet), don't show Stop just because other items happen to be running —
  // those are pre-existing queue items, not the loop. Keep showing Run so the
  // user can start the loop after the existing queue drains.
  const showStop =
    (infiniteLoop && !infiniteLoopAwaitingRun && hasActiveRun) || isStopping;

  useEffect(() => {
    if (!hasActiveRun && isStopping) {
      queueMicrotask(() => {
        setIsStopping(false);
      });
    }
  }, [hasActiveRun, isStopping, setIsStopping]);

  const frontConfirmationTimerRef = useRef<number | null>(null);
  const [showFrontConfirmation, setShowFrontConfirmation] = useState(false);

  const clearFrontConfirmationTimer = useCallback(() => {
    if (frontConfirmationTimerRef.current !== null) {
      window.clearTimeout(frontConfirmationTimerRef.current);
      frontConfirmationTimerRef.current = null;
    }
  }, []);

  const confirmFrontQueue = useCallback(() => {
    clearFrontConfirmationTimer();
    setShowFrontConfirmation(true);
    frontConfirmationTimerRef.current = window.setTimeout(() => {
      frontConfirmationTimerRef.current = null;
      setShowFrontConfirmation(false);
    }, FRONT_QUEUE_CONFIRMATION_MS);
  }, [clearFrontConfirmationTimer]);

  const handleRun = useCallback(async (queueFront = false) => {
    if (canRun) {
      setIsStopping(false);
      const queuePromise = queueFront
        ? queueWorkflow(infiniteLoop ? 1 : runCount, undefined, false, true)
        : queueWorkflow(infiniteLoop ? 1 : runCount);
      if ('vibrate' in navigator) {
        navigator.vibrate(20);
      }
      const queued = await queuePromise;
      if (queueFront && queued) confirmFrontQueue();
    }
  }, [canRun, confirmFrontQueue, infiniteLoop, queueWorkflow, runCount, setIsStopping]);

  // Long-press queues at the front of the queue instead of appending.
  const { handlers: longPressHandlers, consumeLongPress } = useLongPress({
    onLongPress: () => { void handleRun(true); },
    enabled: canRun && !isLoading,
  });

  const handleRunClick = (event: MouseEvent<HTMLButtonElement>) => {
    // A real pointer click follows pointerup. Once the hold already submitted,
    // consume that click so release cannot also append the same run. Keyboard
    // activation has detail=0 and remains a normal append action.
    const triggered = consumeLongPress();
    if (event.detail !== 0 && triggered) {
      event.preventDefault();
      return;
    }
    void handleRun();
  };

  useEffect(() => clearFrontConfirmationTimer, [clearFrontConfirmationTimer]);

  const handleStop = async () => {
    if (isStopping) return;
    setIsStopping(true);
    setInfiniteLoop(false);
    await interrupt();
    if ('vibrate' in navigator) {
      navigator.vibrate(20);
    }
  };

  const frontConfirmation = showFrontConfirmation ? (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute bottom-full left-1/2 z-[2100] mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-cyan-200/60 bg-cyan-400 px-3 py-1.5 text-xs font-semibold text-slate-950 shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      {t('Queued at front')}
      <span className="absolute left-1/2 top-full -translate-x-1/2 border-x-[6px] border-t-[6px] border-x-transparent border-t-cyan-400" />
    </div>
  ) : null;

  if (showStop) {
    return (
      <div className="relative min-w-0 flex-1">
        {frontConfirmation}
      <button
        onClick={handleStop}
        disabled={isStopping}
        className="w-full py-3 px-6 rounded-xl font-semibold text-lg min-h-[48px] transition-all bg-red-500 text-white active:bg-red-600 disabled:opacity-70"
      >
        {isStopping ? 'Stopping...' : 'Stop'}
      </button>
      </div>
    );
  }

  return (
    <div className="relative min-w-0 flex-1">
      {frontConfirmation}
    <button
      onClick={handleRunClick}
      {...longPressHandlers}
      onContextMenu={(event) => event.preventDefault()}
      disabled={!canRun || isLoading}
      aria-busy={isLoading}
      aria-description={t('Tap to queue; hold to run next')}
      title={t('Tap to queue; hold to run next')}
      // The visible "Queueing..." label is desktop-only (see below), so on a
      // phone the button would otherwise have no accessible name while loading.
      aria-label={isLoading ? 'Queueing...' : undefined}
      className={
        `w-full select-none py-3 px-6 rounded-xl font-semibold text-lg min-h-[48px] transition-all `
        + (canRun && !isLoading
          ? appChromePrimaryButtonClassName
          : appChromePrimaryButtonDisabledClassName)
      }
    >
      <span className="flex items-center justify-center gap-2">
        {isLoading && (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
        )}
        {isLoading ? (
          // On phone-sized screens the "Queueing..." label is too wide for the
          // narrow Run button, so the spinner alone stands in for it there; the
          // full label only appears at the desktop breakpoint (lg / 1024px, see
          // DESKTOP_MIN_WIDTH). This avoids the jarring Run -> Queueing... text
          // swap on small screens.
          <span className="hidden lg:inline">{t('Queueing...')}</span>
        ) : (
          t('Run')
        )}
      </span>
    </button>
    </div>
  );
}
