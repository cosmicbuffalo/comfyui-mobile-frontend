import { useMemo } from 'react';
import type { WorkflowInput, WorkflowNode } from '@/api/types';
import { ConnectionButton } from './Connections/ConnectionButton';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useConnectionSectionFoldsStore } from '@/hooks/useConnectionSectionFolds';
import { Collapsible } from '@/components/Collapsible';
import { ChevronRightIcon } from '@/components/icons';

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
  const connectionButtonsVisible = useWorkflowStore((s) => s.connectionButtonsVisible);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const expanded = useConnectionSectionFoldsStore((s) =>
    s.expandedItemKeys.includes(nodeHierarchicalKey),
  );
  const toggleExpanded = useConnectionSectionFoldsStore((s) => s.toggleExpanded);

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
        {connectionCount} hidden connection{connectionCount === 1 ? '' : 's'}
      </div>
    );
  }

  return (
    // px-1 keeps the connection buttons clear of the node card's
    // `overflow-hidden` edge so the navigation highlight ring (box-shadow spread)
    // shows in full instead of being clipped on the outer side.
    <div className="node-connections mb-3 px-1">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
        <div className="flex min-w-0 items-center gap-2">
          {inputs.length > 0 && <span className="shrink-0">Inputs</span>}
          <span className="connection-section-divider h-px min-w-0 flex-1 bg-slate-700" aria-hidden="true" />
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? 'Fold connections' : 'Unfold connections'}
          data-fold-state={expanded ? 'expanded' : 'collapsed'}
          onClick={() => toggleExpanded(nodeHierarchicalKey)}
          className={`flex h-7 items-center justify-center border text-slate-400 transition-[width,border-radius,background-color,border-color,color] duration-200 ease-out focus-visible:outline-none ${
            expanded
              ? 'w-7 rounded-full border-red-500/30 bg-red-950/55 hover:text-red-300'
              : 'w-11 rounded-full border-white/10 bg-slate-950/80 hover:text-slate-200'
          }`}
        >
          <ChevronRightIcon
            data-connection-fold-chevron="left"
            className={`h-4 w-4 transition-transform duration-200 ease-out ${
              expanded ? 'translate-x-1' : 'translate-x-0'
            }`}
          />
          <ChevronRightIcon
            data-connection-fold-chevron="right"
            className={`-ml-1 h-4 w-4 transition-transform duration-200 ease-out ${
              expanded ? '-translate-x-1 rotate-180' : 'translate-x-0 rotate-180'
            }`}
          />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="connection-section-divider h-px min-w-0 flex-1 bg-slate-700" aria-hidden="true" />
          {outputs.length > 0 && <span className="shrink-0 text-right">Outputs</span>}
        </div>
      </div>

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
            )}
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
