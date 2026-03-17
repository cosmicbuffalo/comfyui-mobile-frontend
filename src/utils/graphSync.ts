import type { Workflow, WorkflowGroup, WorkflowNode } from '@/api/types';
import type { ItemRef, MobileLayout, NodeLayoutMembership } from '@/utils/mobileLayout';
import {
  collectScopedMembership,
  getGroupKey,
  scopedNodeKey
} from '@/utils/mobileLayout';
import {
  assignPositionsInGroup,
  clampPositionToGroup,
  expandGroupToFitNodes,
  positionBelowAll,
  type PositionedNode
} from '@/utils/nodePositioning';

interface GroupScopeRef {
  scope: 'root' | 'subgraph';
  subgraphId: string | null;
  group: WorkflowGroup;
}

export interface SyncResult {
  workflow: Workflow;
  changedNodeIds: number[];
  changedGroupKeys: string[];
}

export interface SyncWorkflowGeometryFromLayoutChangeArgs {
  oldLayout: MobileLayout;
  newLayout: MobileLayout;
  workflow: Workflow;
}

function membershipKey(member: NodeLayoutMembership | undefined): string {
  if (!member) return 'missing';
  return `${member.scope}:${member.subgraphId ?? 'root'}:${member.groupKey ?? 'none'}`;
}

function parseNodeIdFromScopedKey(nodeKey: string): number | null {
  const idx = nodeKey.lastIndexOf(':');
  if (idx < 0) return null;
  const value = Number(nodeKey.slice(idx + 1));
  return Number.isFinite(value) ? value : null;
}

function buildGroupScopeMap(
  workflow: Workflow
): Map<string, GroupScopeRef> {
  const result = new Map<string, GroupScopeRef>();
  const rootGroups = workflow.groups ?? [];
  for (const group of rootGroups) {
    result.set(getGroupKey(group.id, null), { scope: 'root', subgraphId: null, group });
  }
  for (const subgraph of workflow.definitions?.subgraphs ?? []) {
    for (const group of subgraph.groups ?? []) {
      result.set(getGroupKey(group.id, subgraph.id), {
        scope: 'subgraph',
        subgraphId: subgraph.id,
        group
      });
    }
  }
  return result;
}

function buildLayoutGroupRefs(layout: MobileLayout): Array<{ groupKey: string; depth: number }> {
  const refs: Array<{ groupKey: string; depth: number }> = [];
  const seen = new Set<string>();
  const visiting = new Set<string>();

  const visit = (items: ItemRef[], depth: number) => {
    for (const item of items) {
      if (item.type === 'group') {
        const groupKey = getGroupKey(item.id, item.subgraphId);
        if (visiting.has(groupKey)) continue;
        if (!seen.has(groupKey)) {
          refs.push({ groupKey, depth });
          seen.add(groupKey);
        }
        visiting.add(groupKey);
        visit(layout.groups[groupKey] ?? [], depth + 1);
        visiting.delete(groupKey);
        continue;
      }
      if (item.type === 'subgraph') {
        visit(layout.subgraphs[item.id] ?? [], depth);
      }
    }
  };

  visit(layout.root, 0);
  refs.sort((a, b) => b.depth - a.depth || a.groupKey.localeCompare(b.groupKey));
  return refs;
}

function collectGroupFitNodes(
  layout: MobileLayout,
  groupKey: string,
  nodeByScopedKey: Map<string, WorkflowNode>,
  groupByKey: Map<string, GroupScopeRef>
): PositionedNode[] {
  const fitNodes: PositionedNode[] = [];
  const groupScope = groupByKey.get(groupKey);
  const scopeSubgraphId = groupScope?.subgraphId ?? null;
  for (const ref of layout.groups[groupKey] ?? []) {
    if (ref.type === 'node') {
      const node = nodeByScopedKey.get(scopedNodeKey(ref.id, scopeSubgraphId));
      if (!node) continue;
      fitNodes.push({ id: node.id, pos: node.pos, size: node.size });
      continue;
    }
    if (ref.type === 'hiddenBlock') {
      for (const nodeId of layout.hiddenBlocks[ref.blockId] ?? []) {
        const node = nodeByScopedKey.get(scopedNodeKey(nodeId, scopeSubgraphId));
        if (!node) continue;
        fitNodes.push({ id: node.id, pos: node.pos, size: node.size });
      }
      continue;
    }
    if (ref.type === 'group') {
      const child = groupByKey.get(getGroupKey(ref.id, ref.subgraphId));
      if (!child) continue;
      const [x, y, width, height] = child.group.bounding;
      fitNodes.push({
        id: Number.MIN_SAFE_INTEGER + fitNodes.length,
        pos: [x, y],
        size: [width, height]
      });
    }
  }
  return fitNodes;
}

function hasGroupMemberRefs(layout: MobileLayout, groupKey: string): boolean {
  const visited = new Set<string>();
  const visit = (groupKey: string): boolean => {
    if (visited.has(groupKey)) return false;
    visited.add(groupKey);
    const refs = layout.groups[groupKey] ?? [];
    for (const ref of refs) {
      if (ref.type === 'node' || ref.type === 'hiddenBlock') return true;
      if (ref.type === 'group' && visit(getGroupKey(ref.id, ref.subgraphId))) return true;
    }
    return false;
  };
  return visit(groupKey);
}

export function syncWorkflowGeometryFromLayoutChange({
  oldLayout,
  newLayout,
  workflow
}: SyncWorkflowGeometryFromLayoutChangeArgs): SyncResult {
  const oldMembership = collectScopedMembership(oldLayout);
  const newMembership = collectScopedMembership(newLayout);
  const allNodeKeys = new Set<string>([...oldMembership.keys(), ...newMembership.keys()]);
  const changedNodeKeys = [...allNodeKeys]
    .filter((nodeKey) => membershipKey(oldMembership.get(nodeKey)) !== membershipKey(newMembership.get(nodeKey)))
    .sort((a, b) => a.localeCompare(b));
  if (changedNodeKeys.length === 0) {
    return {
      workflow,
      changedNodeIds: [],
      changedGroupKeys: [],
    };
  }

  const groupByKey = buildGroupScopeMap(workflow);

  // Build mutable copies of ALL nodes: root nodes and every subgraph's inner nodes.
  // This allows position updates for inner nodes dragged within a subgraph scope.
  const allSubgraphDefs = workflow.definitions?.subgraphs ?? [];
  const nextRootNodes = workflow.nodes.map((node) => ({ ...node, pos: [node.pos[0], node.pos[1]] as [number, number] }));
  const nextInnerNodesBySg = new Map<string, WorkflowNode[]>(
    allSubgraphDefs.map((sg) => [
      sg.id,
      (sg.nodes ?? []).map((n) => ({ ...n, pos: [n.pos[0], n.pos[1]] as [number, number] })),
    ])
  );

  // Combined lookup across all scopes. Mutations to these objects propagate back through
  // nextRootNodes and nextInnerNodesBySg since they share the same object references.
  const nextNodeByScopedKey = new Map<string, WorkflowNode>();
  for (const node of nextRootNodes) {
    nextNodeByScopedKey.set(scopedNodeKey(node.id, null), node);
  }
  for (const [subgraphId, nodes] of nextInnerNodesBySg.entries()) {
    for (const node of nodes) {
      nextNodeByScopedKey.set(scopedNodeKey(node.id, subgraphId), node);
    }
  }

  const changedGroups = new Set<string>();

  const changedNodeKeysByGroup = new Map<string, string[]>();
  for (const nodeKey of changedNodeKeys) {
    const member = newMembership.get(nodeKey);
    if (!member?.groupKey) continue;
    const bucket = changedNodeKeysByGroup.get(member.groupKey) ?? [];
    bucket.push(nodeKey);
    changedNodeKeysByGroup.set(member.groupKey, bucket);
  }

  for (const [groupKey, nodeKeys] of changedNodeKeysByGroup.entries()) {
    const groupRef = groupByKey.get(groupKey);
    if (!groupRef) continue;
    const placementNodes = nodeKeys
      .map((nodeKey) => nextNodeByScopedKey.get(nodeKey))
      .filter((node): node is WorkflowNode => Boolean(node))
      .map((node) => ({ id: node.id, pos: node.pos, size: node.size }));
    if (placementNodes.length === 0) continue;
    const assigned = assignPositionsInGroup(groupRef.group, placementNodes);
    for (const node of placementNodes) {
      const nextPos = assigned.get(node.id) ?? clampPositionToGroup(node.pos, groupRef.group, node.size);
      const expanded = nodeKeys
        .map((nodeKey) => nextNodeByScopedKey.get(nodeKey))
        .find((candidate) => candidate?.id === node.id);
      if (!expanded) continue;
      expanded.pos = nextPos;
    }
    changedGroups.add(groupKey);
  }

  let leaveOffset = 0;
  for (const nodeKey of changedNodeKeys) {
    const nextMember = newMembership.get(nodeKey);
    const prevMember = oldMembership.get(nodeKey);
    const node = nextNodeByScopedKey.get(nodeKey);
    if (!node || !nextMember || !prevMember) continue;
    // Skip nodes that moved into groups (handled above)
    if (nextMember.groupKey) continue;
    // Only update position for nodes that left a group
    if (!prevMember.groupKey) continue;

    const scopeNodes = nextMember.subgraphId
      ? (nextInnerNodesBySg.get(nextMember.subgraphId) ?? [])
      : nextRootNodes;
    const scopeGroups = nextMember.subgraphId
      ? (allSubgraphDefs.find((sg) => sg.id === nextMember.subgraphId)?.groups ?? [])
      : (workflow.groups ?? []);
    node.pos = positionBelowAll(
      workflow,
      { subgraphId: nextMember.subgraphId },
      leaveOffset,
      { scopeNodes, scopeGroups }
    );
    leaveOffset += 1;
  }

  // Reconstruct the workflow, splitting updated nodes back into root and per-subgraph buckets.
  const nextSubgraphDefs = allSubgraphDefs.map((sg) => {
    const innerNodes = nextInnerNodesBySg.get(sg.id);
    if (!innerNodes || innerNodes.length === 0) return sg;
    return {
      ...sg,
      nodes: innerNodes.map((n) => nextNodeByScopedKey.get(scopedNodeKey(n.id, sg.id)) ?? n)
    };
  });

  const baseWorkflow: Workflow = {
    ...workflow,
    nodes: nextRootNodes.map((n) => nextNodeByScopedKey.get(scopedNodeKey(n.id, null)) ?? n),
    definitions: workflow.definitions
      ? { ...workflow.definitions, subgraphs: nextSubgraphDefs }
      : workflow.definitions,
  };

  const groupRefs = buildLayoutGroupRefs(newLayout);
  let rootGroups = baseWorkflow.groups ?? [];
  let subgraphs = baseWorkflow.definitions?.subgraphs ?? [];

  for (const { groupKey } of groupRefs) {
    const scopeRef = groupByKey.get(groupKey);
    if (!scopeRef) continue;
    const fitNodes = collectGroupFitNodes(newLayout, groupKey, nextNodeByScopedKey, groupByKey);
    if (fitNodes.length === 0) {
      // Only treat as truly empty when layout has no members.
      // This avoids collapsing groups on transient lookup misses.
      if (hasGroupMemberRefs(newLayout, groupKey)) continue;
      const [gx, gy, gw, gh] = scopeRef.group.bounding;
      if (gw <= 320 && gh <= 160) continue;
      const reset: [number, number, number, number] = [gx, gy, 320, 160];
      const updatedGroup = { ...scopeRef.group, bounding: reset };
      changedGroups.add(groupKey);
      if (scopeRef.scope === 'root') {
        rootGroups = rootGroups.map((group) => (group.id === updatedGroup.id ? updatedGroup : group));
      } else {
        subgraphs = subgraphs.map((subgraph) => {
          if (subgraph.id !== scopeRef.subgraphId) return subgraph;
          return {
            ...subgraph,
            groups: (subgraph.groups ?? []).map((group) => (group.id === updatedGroup.id ? updatedGroup : group))
          };
        });
      }
      groupByKey.set(groupKey, { ...scopeRef, group: updatedGroup });
      continue;
    }
    const expandedGroup = expandGroupToFitNodes(scopeRef.group, fitNodes);
    if (expandedGroup === scopeRef.group) continue;
    changedGroups.add(groupKey);

    if (scopeRef.scope === 'root') {
      rootGroups = rootGroups.map((group) =>
        group.id === expandedGroup.id ? { ...group, bounding: expandedGroup.bounding } : group
      );
      groupByKey.set(groupKey, { ...scopeRef, group: expandedGroup });
      continue;
    }
    subgraphs = subgraphs.map((subgraph) => {
      if (subgraph.id !== scopeRef.subgraphId) return subgraph;
      return {
        ...subgraph,
        groups: (subgraph.groups ?? []).map((group) =>
          group.id === expandedGroup.id ? { ...group, bounding: expandedGroup.bounding } : group
        )
      };
    });
    groupByKey.set(groupKey, { ...scopeRef, group: expandedGroup });
  }

  const nextWorkflow: Workflow = {
    ...baseWorkflow,
    groups: rootGroups,
    definitions: baseWorkflow.definitions
      ? {
          ...baseWorkflow.definitions,
          subgraphs
        }
      : baseWorkflow.definitions
  };

  return {
    workflow: nextWorkflow,
    changedNodeIds: [
      ...new Set(
        changedNodeKeys
          .map(parseNodeIdFromScopedKey)
          .filter((id): id is number => id != null)
      )
    ],
    changedGroupKeys: [...changedGroups].sort(),
  };
}
