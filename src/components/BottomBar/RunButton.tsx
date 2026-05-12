import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';

export function RunButton() {
  const workflow = useWorkflowStore((s) => s.workflow);
  const runCount = useWorkflowStore((s) => s.runCount);
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const setInfiniteLoop = useWorkflowStore((s) => s.setInfiniteLoop);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const queueWorkflow = useWorkflowStore((s) => s.queueWorkflow);
  const interrupt = useQueueStore((s) => s.interrupt);
  const canRun = workflow !== null;

  const showStop = infiniteLoop && isExecuting;

  const handleRun = () => {
    if (canRun) {
      queueWorkflow(infiniteLoop ? 1 : runCount);
      if ('vibrate' in navigator) {
        navigator.vibrate(20);
      }
    }
  };

  const handleStop = async () => {
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
        className="flex-1 py-3 px-6 rounded-xl font-semibold text-lg min-h-[48px] transition-all bg-red-500 text-white active:bg-red-600"
      >
        Stop
      </button>
    );
  }

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
