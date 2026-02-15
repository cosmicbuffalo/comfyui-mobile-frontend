import { useMemo } from 'react';
import type { WorkflowInput, WorkflowNode } from '@/api/types';
import { ConnectionButton } from './Connections/ConnectionButton';
import { useWorkflowStore } from '@/hooks/useWorkflow';

interface NodeCardConnectionsProps {
  nodeId: number;
  nodeType: string;
  inputs: WorkflowInput[];
  outputs: WorkflowNode['outputs'];
  allInputs: WorkflowInput[];
  allOutputs: WorkflowNode['outputs'];
}

export function NodeCardConnections({
  nodeId,
  nodeType,
  inputs,
  outputs,
  allInputs,
  allOutputs,
}: NodeCardConnectionsProps) {
  const connectionButtonsVisible = useWorkflowStore((s) => s.connectionButtonsVisible);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);

  const requiredInputNames = useMemo(() => {
    if (!nodeType || !nodeTypes) return new Set<string>();
    const typeDef = nodeTypes[nodeType];
    if (!typeDef?.input?.required) return new Set<string>();
    return new Set(Object.keys(typeDef.input.required));
  }, [nodeType, nodeTypes]);

  if (!connectionButtonsVisible) return null;
  if (inputs.length === 0 && outputs.length === 0) return null;

  return (
    <div className="node-connections mb-3 grid grid-cols-2 gap-3">
      <div>
        {inputs.length > 0 && (
          <>
            <div className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">
              Inputs
            </div>
            <div className="flex flex-col gap-1.5">
              {inputs.map((input, visibleIdx) => {
                const originalIdx = allInputs.indexOf(input);
                const slotIndex = originalIdx >= 0 ? originalIdx : visibleIdx;
                return (
                  <ConnectionButton
                    key={`input-${slotIndex}`}
                    slot={input}
                    nodeId={nodeId}
                    direction="input"
                    slotIndex={slotIndex}
                    isRequired={requiredInputNames.has(input.name)}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col items-end">
        {outputs.length > 0 && (
          <>
            <div className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide text-right w-full">
              Outputs
            </div>
            <div className="flex flex-col gap-1.5 w-full items-end">
              {outputs.map((output, visibleIdx) => {
                const originalIdx = allOutputs.indexOf(output);
                const slotIndex = originalIdx >= 0 ? originalIdx : visibleIdx;
                return (
                  <ConnectionButton
                    key={`output-${slotIndex}`}
                    slot={output}
                    nodeId={nodeId}
                    direction="output"
                    slotIndex={slotIndex}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
