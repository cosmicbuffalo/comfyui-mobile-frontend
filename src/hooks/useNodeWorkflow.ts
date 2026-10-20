import { useMemo } from 'react';
import { useWorkflowStore } from './useWorkflow';
import { createNodeWorkflowSelector } from '@/utils/nodeWorkflowView';

export function useNodeWorkflow(nodeId: number) {
  const selector = useMemo(() => createNodeWorkflowSelector(nodeId), [nodeId]);
  return useWorkflowStore(selector);
}
