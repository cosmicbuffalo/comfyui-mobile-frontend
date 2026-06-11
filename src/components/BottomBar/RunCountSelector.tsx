import { useWorkflowStore } from '@/hooks/useWorkflow';
import { appChromeIconButtonClassName } from '@/components/chromeStyles';

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
      className="flex items-center gap-1 bg-slate-900/95 border border-white/10 rounded-lg p-1"
    >
      <button
        onClick={handleDecrement}
        disabled={runCount <= 1}
        className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-medium disabled:opacity-40 disabled:shadow-none ${appChromeIconButtonClassName}`}
      >
        −
      </button>
      <span className="w-8 text-center font-semibold text-slate-100">
        {runCount}
      </span>
      <button
        onClick={handleIncrement}
        className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-medium ${appChromeIconButtonClassName}`}
      >
        +
      </button>
    </div>
  );
}
