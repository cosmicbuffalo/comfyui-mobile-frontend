import { useCallback, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';

export function useNodeErrorPopover() {
  const workflowLoadedAt = useWorkflowStore((s) => s.workflowLoadedAt);
  const [openWorkflowToken, setOpenWorkflowToken] = useState<number | null>(null);
  const errorPopoverOpen = openWorkflowToken === workflowLoadedAt;

  const setErrorPopoverOpen = useCallback(
    (next: boolean) => {
      setOpenWorkflowToken(next ? workflowLoadedAt : null);
    },
    [workflowLoadedAt]
  );

  const resetErrorPopover = useCallback(() => {
    setOpenWorkflowToken(null);
  }, []);

  return {
    errorPopoverOpen,
    setErrorPopoverOpen,
    resetErrorPopover
  };
}
