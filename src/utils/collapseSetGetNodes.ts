import type {
  Workflow,
  WorkflowNode,
  WorkflowLink,
  WorkflowSubgraphLink,
} from "@/api/types";
import {
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
  getLinkType,
  makeScopeLink,
} from "@/utils/canonicalWorkflowOps";
import {
  getSetGetName,
  isGetNode,
  isSetGetNode,
  isSetNode,
} from "@/utils/setGetNodes";

// "Collapse Set/Get nodes" rewrites the wireless KJNodes relay pairs into direct
// links: a chain A -> SetNode("x") ~ GetNode("x") -> D becomes A -> D, with the
// Set and Get nodes removed. The hop is resolved per scope (Set/Get match by name
// only within the same scope), and chains of relays (a Set fed by a Get, etc.)
// are followed transitively. The transform is pure — the store wraps it so the
// edit lands in undo history and the layout/pointer maps are reconciled.

type ScopeLink = WorkflowLink | WorkflowSubgraphLink;

export interface CollapsedNodeRef {
  nodeId: number;
  subgraphId: string | null;
}

/** Whether the workflow contains any Set/Get relay nodes (root or in a subgraph). */
export function workflowHasSetGetNodes(workflow: Workflow | null | undefined): boolean {
  if (!workflow) return false;
  const scopeHasRelay = (nodes?: WorkflowNode[]) => (nodes ?? []).some(isSetGetNode);
  if (scopeHasRelay(workflow.nodes)) return true;
  return (workflow.definitions?.subgraphs ?? []).some((sg) => scopeHasRelay(sg.nodes));
}

// Resolve the true (non-relay) source feeding `originId:originSlot` within a
// scope, hopping across each wireless Set<->Get pairing by name. Returns null for
// an orphan Get (no matching Set in scope) or a relay whose input is unconnected,
// so the consumer is simply left disconnected rather than wired to nothing.
function resolveTrueSource(
  originId: number,
  originSlot: number,
  nodes: WorkflowNode[],
  links: ScopeLink[],
  visited: Set<number>,
): { nodeId: number; slotIndex: number } | null {
  const node = nodes.find((n) => n.id === originId);
  // An id not present in the scope's node list is a virtual source — a subgraph
  // I/O boundary sentinel (e.g. -10/-20). It is a legitimate upstream endpoint,
  // so wire the consumer to it rather than dropping the connection.
  if (!node) return { nodeId: originId, slotIndex: originSlot };
  if (!isSetGetNode(node)) {
    return { nodeId: originId, slotIndex: originSlot };
  }
  if (visited.has(originId)) return null; // relay cycle — give up
  visited.add(originId);

  let inputLinkId: number | null | undefined;
  if (isGetNode(node)) {
    const name = getSetGetName(node);
    if (!name) return null;
    const setter = nodes.find((n) => isSetNode(n) && getSetGetName(n) === name);
    inputLinkId = setter?.inputs?.[0]?.link;
  } else {
    inputLinkId = node.inputs?.[0]?.link;
  }
  if (inputLinkId == null) return null;

  const link = links.find((l) => getLinkId(l) === inputLinkId);
  if (!link) return null;
  return resolveTrueSource(
    getLinkOriginId(link),
    getLinkOriginSlot(link),
    nodes,
    links,
    visited,
  );
}

interface ScopeResult {
  nodes: WorkflowNode[];
  links: ScopeLink[];
  removedIds: number[];
  changed: boolean;
}

function collapseScope(
  nodes: WorkflowNode[],
  links: ScopeLink[],
  subgraphId: string | null,
): ScopeResult {
  const relayIds = new Set<number>();
  for (const n of nodes) if (isSetGetNode(n)) relayIds.add(n.id);
  if (relayIds.size === 0) {
    return { nodes, links, removedIds: [], changed: false };
  }

  const nextLinks: ScopeLink[] = [];
  for (const link of links) {
    const targetId = getLinkTargetId(link);
    const originId = getLinkOriginId(link);
    // A link feeding INTO a relay is captured by resolving from the consumer
    // side, so drop it here.
    if (relayIds.has(targetId)) continue;
    if (!relayIds.has(originId)) {
      nextLinks.push(link); // real -> real, unchanged
      continue;
    }
    // A relay output consumed by a real node: rewire to the true upstream source.
    // Reusing the consumer link's id keeps ids unique (the original is dropped).
    const src = resolveTrueSource(originId, getLinkOriginSlot(link), nodes, links, new Set());
    if (!src) continue; // orphan relay — leave the consumer input unconnected
    nextLinks.push(
      makeScopeLink(
        getLinkId(link),
        src.nodeId,
        src.slotIndex,
        targetId,
        getLinkTargetSlot(link),
        getLinkType(link),
        subgraphId,
      ),
    );
  }

  // Rebuild every surviving node's input/output link references from the new
  // link set so nothing dangles to a removed relay or a dropped link.
  const survivingNodes = nodes
    .filter((n) => !relayIds.has(n.id))
    .map((n) => {
      // Slotless nodes (Note/MarkdownNote — and subgraph inner nodes never go
      // through load-time normalization) can lack inputs/outputs entirely.
      const inputs = (n.inputs ?? []).map((input, slot) => {
        const incoming = nextLinks.find(
          (l) => getLinkTargetId(l) === n.id && getLinkTargetSlot(l) === slot,
        );
        return { ...input, link: incoming ? getLinkId(incoming) : null };
      });
      const outputs = (n.outputs ?? []).map((output, slot) => {
        const outgoing = nextLinks
          .filter((l) => getLinkOriginId(l) === n.id && getLinkOriginSlot(l) === slot)
          .map((l) => getLinkId(l));
        return { ...output, links: outgoing.length ? outgoing : null };
      });
      return { ...n, inputs, outputs };
    });

  return { nodes: survivingNodes, links: nextLinks, removedIds: [...relayIds], changed: true };
}

/**
 * Collapse all Set/Get relay nodes in the workflow into direct connections.
 * Returns the rewired workflow and the list of removed relay nodes (with their
 * scope) so the caller can prune them from the layout / pointer registry.
 */
export function collapseSetGetNodes(
  workflow: Workflow,
): { workflow: Workflow; removed: CollapsedNodeRef[] } {
  const removed: CollapsedNodeRef[] = [];

  const root = collapseScope(workflow.nodes ?? [], (workflow.links ?? []) as ScopeLink[], null);
  for (const id of root.removedIds) removed.push({ nodeId: id, subgraphId: null });

  let subgraphsChanged = false;
  const subgraphs = (workflow.definitions?.subgraphs ?? []).map((sg) => {
    const res = collapseScope(sg.nodes ?? [], (sg.links ?? []) as ScopeLink[], sg.id);
    if (!res.changed) return sg;
    subgraphsChanged = true;
    for (const id of res.removedIds) removed.push({ nodeId: id, subgraphId: sg.id });
    return { ...sg, nodes: res.nodes, links: res.links as typeof sg.links };
  });

  if (!root.changed && !subgraphsChanged) {
    return { workflow, removed };
  }

  const next: Workflow = {
    ...workflow,
    ...(root.changed ? { nodes: root.nodes, links: root.links as WorkflowLink[] } : {}),
    ...(subgraphsChanged
      ? { definitions: { ...(workflow.definitions ?? {}), subgraphs } }
      : {}),
  };
  return { workflow: next, removed };
}
