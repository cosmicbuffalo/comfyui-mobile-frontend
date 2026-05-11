import { useEffect, useRef } from 'react';
import { useWorkflowStore } from './useWorkflow';
import { useQueueStore } from './useQueue';
import { useWorkflowErrorsStore } from './useWorkflowErrors';

export function useInfiniteLoop() {
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const queueWorkflow = useWorkflowStore((s) => s.queueWorkflow);
  const runningCount = useQueueStore((s) => s.running.length);
  const pendingCount = useQueueStore((s) => s.pending.length);
  const error = useWorkflowErrorsStore((s) => s.error);

  const wasExecutingRef = useRef(false);

  useEffect(() => {
    const wasExecuting = wasExecutingRef.current;
    wasExecutingRef.current = isExecuting;

    if (!infiniteLoop) return;
    if (!wasExecuting) return;
    if (isExecuting) return;
    if (runningCount > 0 || pendingCount > 0) return;
    if (error) return;

    queueWorkflow(1);
  }, [isExecuting, infiniteLoop, runningCount, pendingCount, error, queueWorkflow]);
}
