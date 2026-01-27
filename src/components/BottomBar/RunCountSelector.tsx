import { useWorkflowStore } from '@/hooks/useWorkflow';

export function RunCountSelector() {
  const runCount = useWorkflowStore((s) => s.runCount);
  const setRunCount = useWorkflowStore((s) => s.setRunCount);

  const handleDecrement = () => {
    setRunCount(runCount - 1);
  };

  const handleIncrement = () => {
    setRunCount(runCount + 1);
  };

  return (
    <div
      id="run-count-selector"
      className="flex items-center gap-1 bg-gray-100 rounded-lg p-1"
    >
      <button
        onClick={handleDecrement}
        disabled={runCount <= 1}
        className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center
                   text-lg font-medium text-gray-700 disabled:opacity-40 disabled:shadow-none"
      >
        −
      </button>
      <span className="w-8 text-center font-semibold text-gray-900">
        {runCount}
      </span>
      <button
        onClick={handleIncrement}
        className="w-10 h-10 rounded-lg bg-white shadow-sm flex items-center justify-center
                   text-lg font-medium text-gray-700"
      >
        +
      </button>
    </div>
  );
}
