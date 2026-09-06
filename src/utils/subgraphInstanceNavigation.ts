import type { Workflow, WorkflowNode } from '@/api/types';
import type { ScopeFrame } from '@/hooks/useWorkflow';
import {
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
} from '@/utils/canonicalWorkflowOps';
import { collectSubgraphInstances } from '@/utils/boundarySlotLabels';
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';

/**
 * Navigating between the instances of a shared subgraph type.
 *
 * Entering a subgraph enters the TYPE, not one instance of it — the nodes on
 * screen are the definition's, shared by every placeholder. The scope frame
 * still records which placeholder the user came in through
 * (`placeholderNodeId`), and that is what gives the boundary its outward
 * context: which outer node each slot is wired to, and which per-instance
 * labels apply. This module resolves that context, and the trails needed to
 * travel to it.
 */

interface ScopeSearchState {
  nodes: WorkflowNode[];
  trail: ScopeFrame[];
}

/**
 * The scope stack in which `placeholderNodeId` is visible — i.e. the stack of
 * its PARENT scope, not of the subgraph it opens.
 *
 * A shared type's instances can sit in different parents, so switching to one
 * is not always a matter of changing the top frame; sometimes the whole trail
 * changes. Returns null when the node cannot be reached, which includes a
 * definition that is defined but never instantiated.
 */
export function findScopeTrailForPlaceholder(
  workflow: Workflow | null | undefined,
  placeholderNodeId: number,
  options?: {
    /**
     * Only match a node of this type. Node ids are unique per scope, not per
     * workflow — definitions restart their id space — so an unconstrained
     * root-first search can land on an unrelated same-numbered node. Every
     * caller that knows which type it is navigating should say so.
     */
    expectedType?: string;
    /** Only match in this scope: a definition id, or null for root. */
    parentSubgraphId?: string | null;
  },
): ScopeFrame[] | null {
  if (!workflow) return null;
  const byId = new Map((workflow.definitions?.subgraphs ?? []).map((sg) => [sg.id, sg]));

  const queue: ScopeSearchState[] = [
    { nodes: workflow.nodes ?? [], trail: [{ type: 'root' }] },
  ];

  while (queue.length > 0) {
    const { nodes, trail } = queue.shift() as ScopeSearchState;
    const top = trail[trail.length - 1];
    const scopeId = top && top.type === 'subgraph' ? top.id : null;
    const scopeMatches =
      options?.parentSubgraphId === undefined || options.parentSubgraphId === scopeId;
    if (
      scopeMatches &&
      nodes.some(
        (node) =>
          node.id === placeholderNodeId &&
          (options?.expectedType === undefined || node.type === options.expectedType),
      )
    ) {
      return trail;
    }

    // A shared type may appear at several depths, so guard on the ids already
    // on THIS trail rather than globally: a sibling branch must stay reachable.
    const openOnTrail = new Set(
      trail.filter((frame) => frame.type === 'subgraph').map((frame) => frame.id),
    );
    for (const node of nodes) {
      const definition = byId.get(node.type);
      if (!definition || openOnTrail.has(definition.id)) continue;
      queue.push({
        nodes: definition.nodes ?? [],
        trail: [
          ...trail,
          { type: 'subgraph', id: definition.id, placeholderNodeId: node.id },
        ],
      });
    }
  }
  return null;
}

/**
 * A scope stack that lands *inside* `subgraphId` — the trail to stand in that
 * definition, rather than the trail that contains one of its placeholders.
 *
 * With a shared type this picks the first instance found, which is why callers
 * that mean a PARTICULAR instance pass their own trail: the point here is only
 * to reach the right definition, for a caller that knows the scope it wants but
 * not which way in.
 */
export function findScopeTrailForSubgraph(
  workflow: Workflow | null | undefined,
  subgraphId: string | null,
): ScopeFrame[] | null {
  if (!workflow) return null;
  if (subgraphId == null) return [{ type: 'root' }];
  const byId = new Map((workflow.definitions?.subgraphs ?? []).map((sg) => [sg.id, sg]));

  const queue: ScopeSearchState[] = [
    { nodes: workflow.nodes ?? [], trail: [{ type: 'root' }] },
  ];
  while (queue.length > 0) {
    const { nodes, trail } = queue.shift() as ScopeSearchState;
    const openOnTrail = new Set(
      trail.filter((frame) => frame.type === 'subgraph').map((frame) => frame.id),
    );
    for (const node of nodes) {
      const definition = byId.get(node.type);
      if (!definition || openOnTrail.has(definition.id)) continue;
      const next: ScopeFrame[] = [
        ...trail,
        { type: 'subgraph', id: definition.id, placeholderNodeId: node.id },
      ];
      if (definition.id === subgraphId) return next;
      queue.push({ nodes: definition.nodes ?? [], trail: next });
    }
  }
  return null;
}

/** The links of the scope a stack points at, whatever their format. */
function scopeLinks(workflow: Workflow, trail: ScopeFrame[]) {
  const top = trail[trail.length - 1];
  if (!top || top.type === 'root') return workflow.links ?? [];
  const definition = workflow.definitions?.subgraphs?.find((sg) => sg.id === top.id);
  return definition?.links ?? [];
}

function scopeNodes(workflow: Workflow, trail: ScopeFrame[]): WorkflowNode[] {
  const top = trail[trail.length - 1];
  if (!top || top.type === 'root') return workflow.nodes ?? [];
  const definition = workflow.definitions?.subgraphs?.find((sg) => sg.id === top.id);
  return definition?.nodes ?? [];
}

export interface OuterConnection {
  /** The placeholder whose wiring this is. */
  instanceNodeId: number;
  instanceLabel: string;
  /** True for the instance the current scope was entered through. */
  isCurrentInstance: boolean;
  /** The outer node on the far side of the boundary slot. */
  outerNodeId: number;
  outerNodeKey: string;
  outerNodeName: string;
  outerSlotIndex: number;
  /** The scope stack the outer node lives in. */
  trail: ScopeFrame[];
}

/**
 * Every outer node a boundary slot reaches, across every instance of the type.
 *
 * A boundary input slot is fed by whatever feeds the matching input on each
 * placeholder; a boundary output slot feeds whatever that placeholder's
 * matching output feeds — so one output slot can reach several outer nodes on
 * a single instance.
 */
export function collectOuterConnections(
  workflow: Workflow | null | undefined,
  subgraphId: string,
  currentInstanceNodeId: number | null,
  direction: 'input' | 'output',
  slotIndex: number,
  nodeTypes: Parameters<typeof resolveWorkflowNodeDisplayName>[2] = null,
): OuterConnection[] {
  if (!workflow) return [];
  const results: OuterConnection[] = [];

  for (const { node: instance, parentSubgraphId } of collectSubgraphInstances(workflow, subgraphId)) {
    const trail = findScopeTrailForPlaceholder(workflow, instance.id, {
      expectedType: subgraphId,
      parentSubgraphId,
    });
    if (!trail) continue;
    const links = scopeLinks(workflow, trail);
    const nodes = scopeNodes(workflow, trail);

    const push = (outerNodeId: number, outerSlotIndex: number) => {
      const outerNode = nodes.find((node) => node.id === outerNodeId);
      if (!outerNode?.itemKey) return;
      results.push({
        instanceNodeId: instance.id,
        instanceLabel: resolveWorkflowNodeDisplayName(workflow, instance, nodeTypes),
        isCurrentInstance: instance.id === currentInstanceNodeId,
        outerNodeId,
        outerNodeKey: outerNode.itemKey,
        outerNodeName: resolveWorkflowNodeDisplayName(workflow, outerNode, nodeTypes),
        outerSlotIndex,
        trail,
      });
    };

    if (direction === 'input') {
      const linkId = instance.inputs?.[slotIndex]?.link;
      if (linkId == null) continue;
      const link = links.find((entry) => getLinkId(entry) === linkId);
      if (link) push(getLinkOriginId(link), getLinkOriginSlot(link));
      continue;
    }

    for (const linkId of instance.outputs?.[slotIndex]?.links ?? []) {
      const link = links.find((entry) => getLinkId(entry) === linkId);
      if (link) push(getLinkTargetId(link), getLinkTargetSlot(link));
    }
  }

  // The instance the user came in through first: it is the one they mean by
  // default, and the menu groups the rest under "other instances".
  return results.sort(
    (a, b) => Number(b.isCurrentInstance) - Number(a.isCurrentInstance),
  );
}

/**
 * A scope stack the given workflow can actually answer for.
 *
 * The browsing scope is store state, not part of the workflow, so anything that
 * removes a definition or an instance can leave it pointing at something that
 * is no longer there: the panel then renders an empty node list under a
 * breadcrumb for a subgraph that does not exist, which reads as "my whole
 * workflow vanished".
 *
 * A frame whose definition is gone truncates the stack there. A frame whose
 * definition survives but whose instance does not is re-pointed at a surviving
 * instance — the type is still real, only the window onto it closed — and
 * truncates only when the type has no instances left to read it through.
 */
export function reconcileScopeStack(
  scopeStack: ScopeFrame[],
  workflow: Workflow | null,
): ScopeFrame[] {
  const definitions = workflow?.definitions?.subgraphs ?? [];
  const kept: ScopeFrame[] = [];
  for (const frame of scopeStack) {
    if (frame.type !== 'subgraph') {
      kept.push(frame);
      continue;
    }
    if (!definitions.some((definition) => definition.id === frame.id)) break;
    const instances = collectSubgraphInstances(workflow, frame.id).map(({ node }) => node.id);
    if (instances.includes(frame.placeholderNodeId)) {
      kept.push(frame);
      continue;
    }
    if (instances.length === 0) break;
    kept.push({ ...frame, placeholderNodeId: instances[0], enteredPlaceholderNodeId: undefined });
  }
  return kept.length > 0 ? kept : [{ type: 'root' }];
}
