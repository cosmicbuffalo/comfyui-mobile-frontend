import { useEffect, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';
import { SkipForwardIcon } from '@/components/icons';
import { chromeBarButtonClassName } from '@/components/chromeStyles';

export function SkipButton() {
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const isLoading = useWorkflowStore((s) => s.isLoading);
  const interrupt = useQueueStore((s) => s.interrupt);
  const running = useQueueStore((s) => s.running);
  const pending = useQueueStore((s) => s.pending);
  const [isSkipping, setIsSkipping] = useState(false);

  const hasActiveRun =
    isExecuting || isLoading || running.length > 0 || pending.length > 0;

  useEffect(() => {
    if (!isExecuting && isSkipping) {
      queueMicrotask(() => {
        setIsSkipping(false);
      });
    }
  }, [isExecuting, isSkipping]);

  if (!infiniteLoop || (!hasActiveRun && !isSkipping)) return null;

  const handleSkip = async () => {
    if (isSkipping) return;
    setIsSkipping(true);
    await interrupt();
    if ('vibrate' in navigator) {
      navigator.vibrate(20);
    }
  };

  return (
    <button
      onClick={handleSkip}
      disabled={isSkipping}
      title="Skip to next iteration"
      className={`${chromeBarButtonClassName} bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 active:bg-cyan-500/25 disabled:opacity-70`}
      aria-label="Skip to next iteration"
    >
      <SkipForwardIcon className="w-6 h-6" />
    </button>
  );
}
