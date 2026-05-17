import { useEffect, useRef } from 'react';
import { useWorkflowStore } from './useWorkflow';
import { useWorkflowErrorsStore } from './useWorkflowErrors';
import { useGenerationSettingsStore } from './useGenerationSettings';

export function useInfiniteLoop() {
  const infiniteModeEnabled = useGenerationSettingsStore((s) => s.infiniteModeEnabled);
  const infiniteLoop = useWorkflowStore((s) => s.infiniteLoop);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const queueWorkflow = useWorkflowStore((s) => s.queueWorkflow);
  const error = useWorkflowErrorsStore((s) => s.error);

  const wasExecutingRef = useRef(false);

  useEffect(() => {
    const wasExecuting = wasExecutingRef.current;
    wasExecutingRef.current = isExecuting;

    if (!infiniteModeEnabled) return;
    if (!infiniteLoop) return;
    if (!wasExecuting) return;
    if (isExecuting) return;
    if (error) return;

    queueWorkflow(1);
  }, [isExecuting, infiniteModeEnabled, infiniteLoop, error, queueWorkflow]);
}
