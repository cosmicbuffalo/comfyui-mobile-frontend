import type { WorkflowLink, WorkflowSubgraphLink } from '@/api/types';
import { getLinkOriginId, getLinkTargetId, getLinkType } from '@/utils/canonicalWorkflowOps';
import { areTypesCompatible } from '@/utils/connectionUtils';

/** What the delete confirmation has to decide between for one node. */
export interface NodeDeletionOptions {
  /** The node has at least one link into or out of it in this scope. */
  hasConnections: boolean;
  /**
   * Deleting with `reconnect` would actually bridge something: some outgoing
   * link has a type-compatible incoming link to take its place. Without one,
   * "reconnect" and "disconnect" delete identically, so offering the choice
   * asks the user to pick between two names for the same outcome.
   */
  canReconnect: boolean;
}

/**
 * Read a node's connectivity from the scope's link table rather than from the
 * `inputs[].link` / `outputs[].links` caches on the node itself: the table is
 * what every edit operates on, and a cache left behind by another tool (or by
 * a slot that outlived its link) would otherwise advertise connections the
 * graph no longer has.
 *
 * The bridging rule mirrors `deleteNode`'s: one incoming link is matched to
 * each outgoing link by type compatibility.
 */
export function getNodeDeletionOptions(
  links: Array<WorkflowLink | WorkflowSubgraphLink> | undefined,
  nodeId: number,
): NodeDeletionOptions {
  const incoming = (links ?? []).filter((link) => getLinkTargetId(link) === nodeId);
  const outgoing = (links ?? []).filter((link) => getLinkOriginId(link) === nodeId);

  return {
    hasConnections: incoming.length > 0 || outgoing.length > 0,
    canReconnect: outgoing.some((outLink) =>
      incoming.some((inLink) => areTypesCompatible(getLinkType(inLink), getLinkType(outLink))),
    ),
  };
}
