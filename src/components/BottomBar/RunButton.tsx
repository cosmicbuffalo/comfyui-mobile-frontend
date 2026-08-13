import { useEffect } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';
import { appChromePrimaryButtonClassName, appChromePrimaryButtonDisabledClassName } from '@/components/chromeStyles';
import { useT } from '@/i18n';

export function RunButton() {
  const t = useT();
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

  const handleRun = () => {
    if (canRun) {
      setIsStopping(false);
      queueWorkflow(infiniteLoop ? 1 : runCount);
      if ('vibrate' in navigator) {
        navigator.vibrate(20);
      }
    }
  };

  const handleStop = async () => {
    if (isStopping) return;
    setIsStopping(true);
    setInfiniteLoop(false);
    await interrupt();
    if ('vibrate' in navigator) {
      navigator.vibrate(20);
    }
  };

  if (showStop) {
    return (
      <button
        onClick={handleStop}
        disabled={isStopping}
        className="flex-1 py-3 px-6 rounded-xl font-semibold text-lg min-h-[48px] transition-all bg-red-500 text-white active:bg-red-600 disabled:opacity-70"
      >
        {isStopping ? t('Stopping...') : t('Stop')}
      </button>
    );
  }

  return (
    <button
      onClick={handleRun}
      disabled={!canRun || isLoading}
      aria-busy={isLoading}
      // The visible "Queueing..." label is desktop-only (see below), so on a
      // phone the button would otherwise have no accessible name while loading.
      aria-label={isLoading ? t('Queueing...') : undefined}
      className={
        `flex-1 py-3 px-6 rounded-xl font-semibold text-lg min-h-[48px] transition-all `
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
  );
}
