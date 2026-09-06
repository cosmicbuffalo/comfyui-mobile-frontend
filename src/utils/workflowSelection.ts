import type { Workflow } from '@/api/types';
import {
  getGroupKey,
  makeLocationPointer,
  type ItemRef,
  type MobileLayout,
} from '@/utils/mobileLayout';

export type GroupSelectionScope = 'children' | 'descendants';

function nodeSelectionKey(
  workflow: Workflow,
  nodeId: number,
  subgraphId: string | null,
): string {
  const nodes = subgraphId == null
    ? workflow.nodes
    : workflow.definitions?.subgraphs?.find((entry) => entry.id === subgraphId)?.nodes ?? [];
  const node = nodes.find((entry) => entry.id === nodeId);
  return node?.itemKey ?? makeLocationPointer({ type: 'node', nodeId, subgraphId });
}

function groupSelectionKey(
  workflow: Workflow,
  groupId: number,
  subgraphId: string | null,
): string {
  const groups = subgraphId == null
    ? workflow.groups ?? []
    : workflow.definitions?.subgraphs?.find((entry) => entry.id === subgraphId)?.groups ?? [];
  const group = groups.find((entry) => entry.id === groupId);
  return group?.itemKey ?? makeLocationPointer({ type: 'group', groupId, subgraphId });
}

function legacyPlaceholderNodeId(
  workflow: Workflow,
  subgraphDefinitionId: string,
  ownerSubgraphId: string | null,
): number | null {
  const nodes = ownerSubgraphId == null
    ? workflow.nodes
    : workflow.definitions?.subgraphs?.find((entry) => entry.id === ownerSubgraphId)?.nodes ?? [];
  return nodes.find((node) => node.type === subgraphDefinitionId)?.id ?? null;
}

/**
 * Collect selectable children of a group from the layout hierarchy.
 *
 * `children` includes only immediate nodes, nested group containers, hidden
 * nodes represented by a hidden block, and subgraph placeholder instances.
 * `descendants` recursively walks nested groups. A subgraph placeholder is
 * always treated as a leaf: selection never crosses into its definition.
 */
export function collectGroupSelectionKeys(
  layout: MobileLayout,
  workflow: Workflow,
  groupId: number,
  subgraphId: string | null,
  scope: GroupSelectionScope,
): string[] {
  const result = new Set<string>();
  const visitingGroups = new Set<string>();
  const startGroupKey = getGroupKey(groupId, subgraphId);

  const visitRefs = (refs: ItemRef[], ownerSubgraphId: string | null) => {
    for (const ref of refs) {
      if (ref.type === 'node') {
        result.add(nodeSelectionKey(workflow, ref.id, ownerSubgraphId));
        continue;
      }

      if (ref.type === 'hiddenBlock') {
        for (const nodeId of layout.hiddenBlocks[ref.blockId] ?? []) {
          result.add(nodeSelectionKey(workflow, nodeId, ownerSubgraphId));
        }
        continue;
      }

      if (ref.type === 'subgraph') {
        // Select the placeholder in this scope, never the definition's nodes.
        const placeholderNodeId = ref.nodeId
          ?? legacyPlaceholderNodeId(workflow, ref.id, ownerSubgraphId);
        if (placeholderNodeId != null) {
          result.add(nodeSelectionKey(workflow, placeholderNodeId, ownerSubgraphId));
        }
        continue;
      }

      const childSubgraphId = ref.subgraphId ?? ownerSubgraphId;
      const childGroupKey = getGroupKey(ref.id, childSubgraphId);
      result.add(groupSelectionKey(workflow, ref.id, childSubgraphId));
      if (scope !== 'descendants' || visitingGroups.has(childGroupKey)) continue;

      visitingGroups.add(childGroupKey);
      visitRefs(layout.groups[childGroupKey] ?? [], childSubgraphId);
      visitingGroups.delete(childGroupKey);
    }
  };

  visitingGroups.add(startGroupKey);
  visitRefs(layout.groups[startGroupKey] ?? [], subgraphId);
  return [...result];
}
