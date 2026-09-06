import type {
  Workflow,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphLink,
  WorkflowSubgraphDefinition,
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

// Subgraph boundary sentinel node IDs. Inside a definition's link table, the
// subgraph's own input slots act as link origins from node -10 and its output
// slots as link targets on node -20; neither is a real node in any node list.
export const SUBGRAPH_INPUT_NODE_ID = -10;
export const SUBGRAPH_OUTPUT_NODE_ID = -20;

// -----------------------------------------------------------------------------
// Mobile-specific definition metadata, namespaced under def.extra so it
// round-trips untouched through the desktop frontend and the backend.
//
// Shared-instance model: several placeholder nodes may point at ONE definition
// (node.type === def.id). Inner content — the definition's nodes, links,
// groups, proxy-widget values, and the definition-keyed inner layout — is
// shared by design across those instances; placeholder-level state (title,
// widgets_values for slot-promoted/boundary widgets, instance number) is
// per-instance, and placeholder-level operations must resolve by node id,
// never by first-placeholder-of-type.
// -----------------------------------------------------------------------------

const MOBILE_DEF_META_KEY = 'comfyui-mobile';

export interface MobileSubgraphDefMeta {
  /** Next instance number to hand out; instance numbers are stable, gaps allowed. */
  nextInstanceNumber?: number;
  /** Custom labels for proxy widgets, keyed "<innerNodeId>:<widgetName>". */
  proxyLabels?: Record<string, string>;
  /**
   * Group titles rendered from a template, keyed by group id — a group has no
   * properties bag to record it in, and without the template kept somewhere
   * the rendered title would be the only copy left of it.
   */
  autoGroupTitles?: Record<string, { template: string; rendered?: string }>;
}

export function getMobileDefMeta(def: WorkflowSubgraphDefinition): MobileSubgraphDefMeta {
  const meta = def.extra?.[MOBILE_DEF_META_KEY];
  return meta && typeof meta === 'object' ? (meta as MobileSubgraphDefMeta) : {};
}

export function withMobileDefMeta(
  def: WorkflowSubgraphDefinition,
  patch: Partial<MobileSubgraphDefMeta>,
): WorkflowSubgraphDefinition {
  return {
    ...def,
    extra: {
      ...(def.extra ?? {}),
      [MOBILE_DEF_META_KEY]: { ...getMobileDefMeta(def), ...patch },
    },
  };
}

/** Remove the mobile metadata namespace entirely (used when a def is forked
 * into a context where its promotion/instance lineage no longer applies). */
export function stripMobileDefMeta(def: WorkflowSubgraphDefinition): WorkflowSubgraphDefinition {
  if (!def.extra || !(MOBILE_DEF_META_KEY in def.extra)) return def;
  const rest = { ...def.extra };
  delete rest[MOBILE_DEF_META_KEY];
  return { ...def, extra: rest };
}

/** Node property holding a placeholder's per-instance number (distinct from node id). */
export const MOBILE_INSTANCE_NUMBER_PROPERTY = 'mobileInstanceNumber';

export function getInstanceNumber(node: WorkflowNode): number | undefined {
  const value = node.properties?.[MOBILE_INSTANCE_NUMBER_PROPERTY];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// ScopeFrame is defined here to avoid circular dependencies with useWorkflow.ts.
// useWorkflow.ts imports ScopeFrame from here and re-exports it.
export type ScopeFrame =
  | { type: 'root' }
  | {
      type: 'subgraph';
      id: string;
      /**
       * The instance the boundary is read through: which outer nodes its slots
       * reach, and which per-instance labels apply. Entering a subgraph enters
       * the TYPE — the nodes shown are the definition's — so this is context,
       * not identity, and the user can switch it without leaving.
       */
      placeholderNodeId: number;
      /**
       * The instance actually entered through, when it is no longer
       * `placeholderNodeId`. Leaving lands on the instance the user switched
       * to rather than the one they arrived by, which is where their attention
       * ended up.
       */
      enteredPlaceholderNodeId?: number;
    };

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
  /**
   * Highest link ID in use in this scope; mint new link IDs as base+1, base+2…
   * Root scope uses `last_link_id`; subgraph links have their own ID space with
   * no stored counter, so the base is derived from the existing link IDs.
   */
  linkIdBase: number;
  applyPatch: (canonical: Workflow, patch: ScopePatch) => Workflow;
}

/**
 * Highest node ID in use anywhere in the workflow (root and every subgraph
 * definition). Node IDs must be allocated above this: root and subgraph
 * scopes are separate node lists, but IDs are treated as workflow-global by
 * hierarchical-key resolution, so cross-scope collisions corrupt lookups.
 */
export function maxNodeIdAcrossScopes(workflow: Workflow): number {
  let max = workflow.last_node_id ?? 0;
  for (const node of workflow.nodes ?? []) {
    if (node.id > max) max = node.id;
  }
  for (const sg of workflow.definitions?.subgraphs ?? []) {
    for (const node of sg.nodes ?? []) {
      if (node.id > max) max = node.id;
    }
  }
  return max;
}

/** Highest root link ID actually in use (regardless of the stored counter). */
export function maxRootLinkId(workflow: Workflow): number {
  let max = 0;
  for (const link of workflow.links ?? []) {
    const id = getLinkId(link);
    if (id > max) max = id;
  }
  return max;
}

function maxSubgraphLinkId(subgraph: WorkflowSubgraphDefinition): number {
  let max = 0;
  for (const link of subgraph.links ?? []) {
    if (link.id > max) max = link.id;
  }
  // Boundary linkIds reference links that should be in subgraph.links, but a
  // repaired/imported definition can list IDs there that links no longer carry.
  for (const io of [...(subgraph.inputs ?? []), ...(subgraph.outputs ?? [])]) {
    for (const id of io.linkIds ?? []) {
      if (id > max) max = id;
    }
  }
  return max;
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
      // Never trust the stored counter alone: a stale/absent last_link_id in a
      // tool-generated file would mint a duplicate id, and disconnectInput
      // deletes by id — one duplicate silently kills two links.
      linkIdBase: Math.max(canonical.last_link_id ?? 0, maxRootLinkId(canonical)),
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
    linkIdBase: maxSubgraphLinkId(subgraph),
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

/**
 * Resolve the editing scope encoded in a hierarchical key. The key's
 * subgraph segment — not the navigation stack — decides where the node
 * lives, so actions carrying a key from another scope (e.g. the pinned
 * widget overlay used inside a subgraph) patch the right node instead of
 * an unrelated same-ID node in the current scope.
 */
export function resolveScopeForHierarchicalKey(
  canonical: Workflow,
  itemKey: string,
): ScopeContext {
  const parsed = parseLocationPointer(itemKey);
  const subgraphId =
    parsed && parsed.type !== 'subgraph' ? parsed.subgraphId : null;
  const frames: ScopeFrame[] =
    subgraphId == null
      ? [{ type: 'root' }]
      : [
          { type: 'root' },
          // placeholderNodeId is navigation metadata; unused for scope resolution.
          { type: 'subgraph', id: subgraphId, placeholderNodeId: -1 },
        ];
  return resolveCurrentScope(frames, canonical);
}

/** Convert a subgraph object-format link to the root tuple format. */
function subgraphLinkToTuple(link: WorkflowSubgraphLink): WorkflowLink {
  return [
    link.id,
    link.origin_id,
    link.origin_slot,
    link.target_id,
    link.target_slot,
    link.type,
  ];
}

/**
 * A root-shaped view of the given scope: the scope's nodes with its links
 * converted to root tuple format, so root-link utilities work unchanged.
 * Returns the workflow itself for root scope or when the subgraph is missing.
 * View only — do not persist or patch the result back into the store.
 */
export function getScopedWorkflowView(
  workflow: Workflow,
  subgraphId: string | null,
): Workflow {
  if (subgraphId == null) return workflow;
  const subgraph = (workflow.definitions?.subgraphs ?? []).find(
    (sg) => sg.id === subgraphId,
  );
  if (!subgraph) return workflow;
  return {
    ...workflow,
    nodes: subgraph.nodes ?? [],
    links: (subgraph.links ?? []).map(subgraphLinkToTuple),
  };
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
