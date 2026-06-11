import { useEffect } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';
import { appChromePrimaryButtonClassName, appChromePrimaryButtonDisabledClassName } from '@/components/chromeStyles';

export function RunButton() {
  const workflow = useWorkflowStore((s) => s.workflow);
  const runCount = useWorkflowStore((s) => s.runCount);
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
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
  const showStop = (infiniteLoop && hasActiveRun) || isStopping;

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
        {isStopping ? 'Stopping...' : 'Stop'}
      </button>
    );
  }

  return (
    <button
      onClick={handleRun}
      disabled={!canRun || isLoading}
      aria-busy={isLoading}
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
        {isLoading ? 'Queueing...' : 'Run'}
      </span>
    </button>
  );
}
