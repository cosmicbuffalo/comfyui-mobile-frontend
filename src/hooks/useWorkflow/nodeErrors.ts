import {useWorkflowErrorsStore, type NodeError} from "@/hooks/useWorkflowErrors";
import {collectNodeHierarchicalKeys} from "@/utils/workflowHierarchy";
import type {Workflow} from "@/api/types";
import type {WorkflowGet, WorkflowSet} from "./state";

/**
 * Every canonical item key the node an error was reported against renders under.
 *
 * ComfyUI keys `node_errors` by prompt id. At root that is the node id, but a
 * node inside a subgraph is reported hierarchically (`57:3`, placeholder 57's
 * inner node 3) and an expanded instance can carry a synthetic id belonging to
 * no node in the canonical workflow. `expandedNodeIdMap` — built when the
 * prompt was queued — holds both forms, so it is the fallback once the direct
 * numeric lookup misses.
 */
export function resolveErrorNodeItemKeys(
  workflow: Workflow,
  itemKeyByPointer: Record<string, string>,
  expandedNodeIdMap: Record<string, string>,
  id: string,
): string[] {
  // Try direct numeric match first (root nodes)
  const nodeId = Number(id);
  if (Number.isFinite(nodeId)) {
    const keys = collectNodeHierarchicalKeys(workflow, itemKeyByPointer, nodeId);
    if (keys.length > 0) return keys;
  }
  // Fallback: hierarchical prompt key lookup (subgraph inner nodes)
  const mappedKey = expandedNodeIdMap[id];
  return mappedKey ? [mappedKey] : [];
}

/**
 * Re-key raw `node_errors` by canonical item key, so the card badge, the error
 * toast's jump-to-node and the reposition overlay can all find the node an
 * error belongs to no matter how deep in a subgraph it sits.
 */
export function buildNodeErrorsByItemKey(
  workflow: Workflow,
  itemKeyByPointer: Record<string, string>,
  expandedNodeIdMap: Record<string, string>,
  errors: Record<string, NodeError[]>,
): Record<string, NodeError[]> {
  const byItemKey: Record<string, NodeError[]> = {};
  for (const [id, errs] of Object.entries(errors)) {
    for (const itemKey of resolveErrorNodeItemKeys(
      workflow,
      itemKeyByPointer,
      expandedNodeIdMap,
      id,
    )) {
      byItemKey[itemKey] = [...(byItemKey[itemKey] ?? []), ...errs];
    }
  }
  return byItemKey;
}

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

  const resolveErrorNodeHierarchicalKeys = (id: string): string[] =>
    resolveErrorNodeItemKeys(workflow, itemKeyByPointer, expandedNodeIdMap, id);

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
  useWorkflowErrorsStore
    .getState()
    .setNodeErrors(
      errors,
      fromRun,
      buildNodeErrorsByItemKey(workflow, itemKeyByPointer, expandedNodeIdMap, errors),
    );
};
  return applyNodeErrors;
}
