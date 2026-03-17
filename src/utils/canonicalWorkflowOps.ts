import type {
  Workflow,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphLink,
  WorkflowGroup,
} from '@/api/types';
import { parseLocationPointer } from '@/utils/mobileLayout';

/**
 * Returns true if the given node is a subgraph placeholder:
 * a canonical root node whose `type` is a subgraph UUID present
 * in `canonical.definitions.subgraphs`.
 */
export function isSubgraphPlaceholder(node: WorkflowNode, canonical: Workflow): boolean {
  const subgraphs = canonical.definitions?.subgraphs;
  if (!subgraphs || subgraphs.length === 0) return false;
  return subgraphs.some((sg) => sg.id === node.type);
}

// ScopeFrame is defined here to avoid circular dependencies with useWorkflow.ts.
// useWorkflow.ts imports ScopeFrame from here and re-exports it.
export type ScopeFrame =
  | { type: 'root' }
  | { type: 'subgraph'; id: string; placeholderNodeId: number };

export interface ScopePatch {
  nodes?: WorkflowNode[];
  links?: WorkflowLink[] | WorkflowSubgraphLink[];
  /** Only meaningful for root scope; subgraph links have their own ID space. */
  last_link_id?: number;
}

export interface ScopeContext {
  subgraphId: string | null;
  nodes: WorkflowNode[];
  links: WorkflowLink[] | WorkflowSubgraphLink[];
  groups: WorkflowGroup[];
  applyPatch: (canonical: Workflow, patch: ScopePatch) => Workflow;
}

/**
 * Resolve the current editing scope from the scope navigation stack.
 * Root scope → canonical root nodes/links/groups.
 * Subgraph scope → that subgraph definition's nodes/links/groups.
 */
export function resolveCurrentScope(
  scopeStack: ScopeFrame[],
  canonical: Workflow,
): ScopeContext {
  const top = scopeStack[scopeStack.length - 1] ?? ({ type: 'root' } as const);

  if (top.type === 'root') {
    return {
      subgraphId: null,
      nodes: canonical.nodes,
      links: canonical.links,
      groups: canonical.groups ?? [],
      applyPatch: (c, patch) => ({
        ...c,
        ...(patch.nodes != null ? { nodes: patch.nodes } : {}),
        ...(patch.links != null ? { links: patch.links as WorkflowLink[] } : {}),
        ...(patch.last_link_id != null ? { last_link_id: patch.last_link_id } : {}),
      }),
    };
  }

  // Subgraph scope
  const subgraphId = top.id;
  const subgraph = (canonical.definitions?.subgraphs ?? []).find(
    (sg) => sg.id === subgraphId,
  );
  if (!subgraph) {
    // Fallback to root if subgraph not found in definitions
    return resolveCurrentScope([{ type: 'root' }], canonical);
  }

  return {
    subgraphId,
    nodes: subgraph.nodes ?? [],
    links: subgraph.links ?? [],
    groups: subgraph.groups ?? [],
    applyPatch: (c, patch) => ({
      ...c,
      definitions: {
        ...(c.definitions ?? {}),
        subgraphs: (c.definitions?.subgraphs ?? []).map((sg) =>
          sg.id === subgraphId
            ? {
                ...sg,
                ...(patch.nodes != null ? { nodes: patch.nodes } : {}),
                ...(patch.links != null
                  ? { links: patch.links as WorkflowSubgraphLink[] }
                  : {}),
              }
            : sg,
        ),
      },
    }),
  };
}

// ---------------------------------------------------------------------------
// Scope-agnostic link accessors
// Root links are tuples [id, originId, originSlot, targetId, targetSlot, type].
// Subgraph links are objects { id, origin_id, origin_slot, target_id, target_slot, type }.
// These helpers let the same code operate on both without unsafe tuple casts.
// ---------------------------------------------------------------------------

export function getLinkId(l: WorkflowLink | WorkflowSubgraphLink): number {
  return Array.isArray(l) ? l[0] : l.id;
}

export function getLinkOriginId(l: WorkflowLink | WorkflowSubgraphLink): number {
  return Array.isArray(l) ? l[1] : l.origin_id;
}

export function getLinkOriginSlot(l: WorkflowLink | WorkflowSubgraphLink): number {
  return Array.isArray(l) ? l[2] : l.origin_slot;
}

export function getLinkTargetId(l: WorkflowLink | WorkflowSubgraphLink): number {
  return Array.isArray(l) ? l[3] : l.target_id;
}

export function getLinkTargetSlot(l: WorkflowLink | WorkflowSubgraphLink): number {
  return Array.isArray(l) ? l[4] : l.target_slot;
}

export function getLinkType(l: WorkflowLink | WorkflowSubgraphLink): string {
  return Array.isArray(l) ? l[5] : l.type;
}

/**
 * Create a new link in the correct format for the given scope.
 * Root scope → WorkflowLink tuple; subgraph scope → WorkflowSubgraphLink object.
 */
export function makeScopeLink(
  id: number,
  originId: number,
  originSlot: number,
  targetId: number,
  targetSlot: number,
  type: string,
  subgraphId: string | null,
): WorkflowLink | WorkflowSubgraphLink {
  if (subgraphId != null) {
    return { id, origin_id: originId, origin_slot: originSlot, target_id: targetId, target_slot: targetSlot, type };
  }
  return [id, originId, originSlot, targetId, targetSlot, type];
}

/** Find a node in the given nodes array by its hierarchical pointer. */
export function resolveNodeByHierarchicalKey(
  nodes: WorkflowNode[],
  pointer: string,
): WorkflowNode | null {
  const parsed = parseLocationPointer(pointer);
  if (!parsed || parsed.type !== 'node') return null;
  return nodes.find((n) => n.id === parsed.nodeId) ?? null;
}

/**
 * Apply a node patch to the node matching nodeId in the given scope,
 * returning an updated canonical workflow.
 */
export function updateNodeInScope(
  canonical: Workflow,
  scope: ScopeContext,
  nodeId: number,
  patchFn: (node: WorkflowNode) => WorkflowNode,
): Workflow {
  const nextNodes = scope.nodes.map((n) => (n.id === nodeId ? patchFn(n) : n));
  return scope.applyPatch(canonical, { nodes: nextNodes });
}
