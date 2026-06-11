import type { Workflow, WorkflowInput, WorkflowNode } from '@/api/types';
import { NodeCardConnections } from './Connections';

interface NodeCardConnectionsSectionProps {
  nodeId: number;
  nodeHierarchicalKey: string;
  nodeType: string;
  inputs: WorkflowInput[];
  outputs: Workflow['nodes'][number]['outputs'];
  allInputs: WorkflowNode['inputs'];
  allOutputs: WorkflowNode['outputs'];
}

export function NodeCardConnectionsSection({
  nodeId,
  nodeHierarchicalKey,
  nodeType,
  inputs,
  outputs,
  allInputs,
  allOutputs
}: NodeCardConnectionsSectionProps) {
  return (
    <NodeCardConnections
      nodeId={nodeId}
      nodeHierarchicalKey={nodeHierarchicalKey}
      nodeType={nodeType}
      inputs={inputs}
      outputs={outputs}
      allInputs={allInputs}
      allOutputs={allOutputs}
    />
  );
}
