import { useWorkflowStore } from '@/hooks/useWorkflow';

export function RunButton() {
  const workflow = useWorkflowStore((s) => s.workflow);
  const runCount = useWorkflowStore((s) => s.runCount);
  const queueWorkflow = useWorkflowStore((s) => s.queueWorkflow);
  const canRun = workflow !== null;

  const handleRun = () => {
    if (canRun) {
      queueWorkflow(runCount);
      if ('vibrate' in navigator) {
        navigator.vibrate(20);
      }
    }
  };

  return (
    <button
      onClick={handleRun}
      disabled={!canRun}
      className={
        `flex-1 py-3 px-6 rounded-xl font-semibold text-lg min-h-[48px] transition-all `
        + (canRun
          ? 'bg-blue-500 text-white active:bg-blue-600'
          : 'bg-gray-300 text-gray-500 cursor-not-allowed')
      }
    >
      Run
    </button>
  );
}
