import { useEffect, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';

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
      className="relative w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors bg-amber-100 text-amber-600 active:bg-amber-200 disabled:opacity-70"
      aria-label="Skip to next iteration"
    >
      ⏭
    </button>
  );
}
