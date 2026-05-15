import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';

export function SkipButton() {
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const interrupt = useQueueStore((s) => s.interrupt);

  if (!infiniteLoop || !isExecuting) return null;

  const handleSkip = async () => {
    await interrupt();
    if ('vibrate' in navigator) {
      navigator.vibrate(20);
    }
  };

  return (
    <button
      onClick={handleSkip}
      title="Skip to next iteration"
      className="w-10 h-10 rounded-lg flex items-center justify-center text-xl transition-colors bg-amber-100 text-amber-600 active:bg-amber-200"
    >
      ⏭
    </button>
  );
}
