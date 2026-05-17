import { useWorkflowStore } from '@/hooks/useWorkflow';
import { InfiniteLoopIcon } from '@/components/icons';

export function InfiniteLoopToggle() {
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const setInfiniteLoop = useWorkflowStore((s) => s.setInfiniteLoop);

  return (
    <button
      onClick={() => setInfiniteLoop(!infiniteLoop)}
      title={infiniteLoop ? 'Disable infinite loop' : 'Enable infinite loop'}
      className={
        `relative w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors `
        + (infiniteLoop
          ? 'bg-blue-500 text-white shadow-sm'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200')
      }
      aria-label={infiniteLoop ? 'Disable infinite loop' : 'Enable infinite loop'}
    >
      <InfiniteLoopIcon className="w-7 h-7" />
    </button>
  );
}
