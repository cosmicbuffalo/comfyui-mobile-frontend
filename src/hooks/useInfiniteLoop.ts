import { useEffect, useRef } from 'react';
import { useWorkflowStore } from './useWorkflow';
import { useWorkflowErrorsStore } from './useWorkflowErrors';

export function useInfiniteLoop() {
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const queueWorkflow = useWorkflowStore((s) => s.queueWorkflow);
  const error = useWorkflowErrorsStore((s) => s.error);

  const wasExecutingRef = useRef(false);

  useEffect(() => {
    const wasExecuting = wasExecutingRef.current;
    wasExecutingRef.current = isExecuting;

    if (!infiniteLoop) return;
    if (!wasExecuting) return;
    if (isExecuting) return;
    if (error) return;

    queueWorkflow(1);
  }, [isExecuting, infiniteLoop, error, queueWorkflow]);
}
