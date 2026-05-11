import { useWorkflowStore } from '@/hooks/useWorkflow';

export function InfiniteLoopToggle() {
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const setInfiniteLoop = useWorkflowStore((s) => s.setInfiniteLoop);

  return (
    <button
      onClick={() => setInfiniteLoop(!infiniteLoop)}
      title={infiniteLoop ? 'Disable infinite loop' : 'Enable infinite loop'}
      className={
        `w-10 h-10 rounded-lg flex items-center justify-center text-xl font-semibold transition-colors `
        + (infiniteLoop
          ? 'bg-blue-500 text-white shadow-sm'
          : 'bg-gray-100 text-gray-500')
      }
    >
      ∞
    </button>
  );
}
