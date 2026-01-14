import type { WorkflowInput, WorkflowNode } from '@/api/types';
import { ConnectionButton } from '../ConnectionButton';

interface NodeCardConnectionsProps {
  nodeId: number;
  inputs: WorkflowInput[];
  outputs: WorkflowNode['outputs'];
  allInputs: WorkflowInput[];
  allOutputs: WorkflowNode['outputs'];
}

export function NodeCardConnections({ nodeId, inputs, outputs, allInputs, allOutputs }: NodeCardConnectionsProps) {
  if (inputs.length === 0 && outputs.length === 0) return null;

  return (
    <div className="mb-3 grid grid-cols-2 gap-3">
      <div>
        {inputs.length > 0 && (
          <>
            <div className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">
              Inputs
            </div>
            <div className="flex flex-col gap-1.5">
              {inputs.map((input) => {
                const originalIdx = allInputs.findIndex((item) => item.name === input.name);
                return (
                  <ConnectionButton
                    key={`input-${input.name}`}
                    slot={input}
                    nodeId={nodeId}
                    direction="input"
                    slotIndex={originalIdx}
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
              {outputs.map((output) => {
                const originalIdx = allOutputs.findIndex((item) => item.name === output.name);
                return (
                  <ConnectionButton
                    key={`output-${originalIdx}`}
                    slot={output}
                    nodeId={nodeId}
                    direction="output"
                    slotIndex={originalIdx}
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
