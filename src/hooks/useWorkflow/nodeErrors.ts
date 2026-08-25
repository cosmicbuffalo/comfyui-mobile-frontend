import {useWorkflowErrorsStore, type NodeError} from "@/hooks/useWorkflowErrors";
import {collectNodeHierarchicalKeys} from "@/utils/workflowHierarchy";
import type {WorkflowGet, WorkflowSet} from "./state";


export function createApplyNodeErrors(set: WorkflowSet, get: WorkflowGet) {
const applyNodeErrors = (
  rawErrors: Record<string, NodeError[]>,
  fromRun = false,
) => {
  const { hiddenItems, workflow, itemKeyByPointer, expandedNodeIdMap } = get();
  if (!workflow) {
    useWorkflowErrorsStore.getState().setNodeErrors(rawErrors, fromRun);
    return;
  }
  // A bypassed node (mode 4) is excluded from the queued prompt and never
  // runs, so an invalid value on it is irrelevant — drop its errors so it
  // doesn't raise an alarm the user can't act on.
  const errors = Object.fromEntries(
    Object.entries(rawErrors).filter(([id]) => {
      const rootNode = workflow.nodes.find((n) => String(n.id) === id);
      return !(rootNode && rootNode.mode === 4);
    }),
  );
  const errorNodeIds = Object.keys(errors);

  const resolveErrorNodeHierarchicalKeys = (id: string): string[] => {
    // Try direct numeric match first (root nodes)
    const nodeId = Number(id);
    if (Number.isFinite(nodeId)) {
      const keys = collectNodeHierarchicalKeys(workflow, itemKeyByPointer, nodeId);
      if (keys.length > 0) return keys;
    }
    // Fallback: hierarchical prompt key lookup (subgraph inner nodes)
    const mappedKey = expandedNodeIdMap[id];
    return mappedKey ? [mappedKey] : [];
  };

  const nodesToUnhide = errorNodeIds.filter((id) => {
    return resolveErrorNodeHierarchicalKeys(id).some(
      (itemKey) => Boolean(hiddenItems[itemKey]),
    );
  });
  if (nodesToUnhide.length > 0) {
    const newHiddenNodes = { ...hiddenItems };
    for (const id of nodesToUnhide) {
      for (const itemKey of resolveErrorNodeHierarchicalKeys(id)) {
        delete newHiddenNodes[itemKey];
      }
    }
    set({ hiddenItems: newHiddenNodes });
  }
  useWorkflowErrorsStore.getState().setNodeErrors(errors, fromRun);
};
  return applyNodeErrors;
}
