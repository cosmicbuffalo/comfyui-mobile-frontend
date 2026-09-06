import { useMemo } from 'react';
import type { WorkflowInput, WorkflowNode } from '@/api/types';
import { ConnectionButton } from './Connections/ConnectionButton';
import { ConnectionsSectionHeader } from './Connections/ConnectionsSectionHeader';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';
import { Collapsible } from '@/components/Collapsible';
import { useI18n } from '@/i18n';

interface NodeCardConnectionsProps {
  nodeId: number;
  nodeHierarchicalKey: string;
  nodeType: string;
  inputs: WorkflowInput[];
  outputs: WorkflowNode['outputs'];
  allInputs: WorkflowInput[];
  allOutputs: WorkflowNode['outputs'];
}

export function NodeCardConnections({
  nodeId,
  nodeHierarchicalKey,
  nodeType,
  inputs,
  outputs,
  allInputs,
  allOutputs,
}: NodeCardConnectionsProps) {
  const { t } = useI18n();
  const connectionButtonsVisible = useWorkflowStore((s) => s.connectionButtonsVisible);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const expanded = useConnectionSectionFoldsStore((s) =>
    !s.collapsedItemKeys.includes(nodeHierarchicalKey),
  );
  const toggleExpanded = useConnectionSectionFoldsStore((s) => s.toggleCollapsed);

  const requiredInputNames = useMemo(() => {
    if (!nodeType || !nodeTypes) return new Set<string>();
    const typeDef = nodeTypes[nodeType];
    if (!typeDef?.input?.required) return new Set<string>();
    return new Set(Object.keys(typeDef.input.required));
  }, [nodeType, nodeTypes]);

  const connectionCount = inputs.length + outputs.length;

  if (connectionCount === 0) return null;
  if (!connectionButtonsVisible) {
    return (
      <div className="connection-hidden-summary node-connections mb-3 px-1 text-center text-xs uppercase tracking-wide text-slate-500">
        {connectionCount === 1
          ? t('{count} hidden connection', { count: connectionCount })
          : t('{count} hidden connections', { count: connectionCount })}
      </div>
    );
  }

  return (
    // px-1 keeps the connection buttons clear of the node card's
    // `overflow-hidden` edge so the navigation highlight ring (box-shadow spread)
    // shows in full instead of being clipped on the outer side.
    <div className="node-connections mb-3 px-1">
      <ConnectionsSectionHeader
        hasInputs={inputs.length > 0}
        hasOutputs={outputs.length > 0}
        expanded={expanded}
        onToggle={() => toggleExpanded(nodeHierarchicalKey)}
      />

      <Collapsible open={expanded}>
        <div className="grid grid-cols-2 gap-3 pt-1.5">
          <div>
            {inputs.length > 0 && (
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
            )}
          </div>

          <div className="flex flex-col items-end">
            {outputs.length > 0 && (
            <div className="flex flex-col gap-1.5 w-full items-end">
              {outputs.map((output, visibleIdx) => {
                const originalIdx = allOutputs.indexOf(output);
                // Synthesized outputs (an Anything Everywhere node's broadcast
                // side) are not in `allOutputs`, so they carry the slot they
                // stand for in `slot_index` rather than relying on position.
                const slotIndex = originalIdx >= 0
                  ? originalIdx
                  : output.slot_index ?? visibleIdx;
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
            )}
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
