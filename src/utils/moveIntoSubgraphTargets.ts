import type { Workflow, WorkflowNode } from '@/api/types';
import { resolveCurrentScope, type ScopeFrame } from '@/utils/canonicalWorkflowOps';
import { resolveContainerIdentityFromHierarchicalKey } from '@/utils/workflowHierarchy';
import { collectGroupMoveSelection } from '@/utils/workflowClipboard';

/**
 * The subgraph placeholders in the current scope that the given items could be
 * moved into.
 *
 * A placeholder is not a destination for itself, and neither is one that sits
 * inside a group being moved — moving a group into a subgraph it contains would
 * put the destination inside itself. When this comes back empty there is no
 * move to offer, which is what the menus check before showing the action.
 */
export function collectMoveIntoSubgraphTargets(
  workflow: Workflow | null,
  scopeStack: ScopeFrame[],
  itemKeys: string[],
): WorkflowNode[] {
  if (!workflow) return [];
  const defIds = new Set((workflow.definitions?.subgraphs ?? []).map((sg) => sg.id));
  if (defIds.size === 0) return [];

  const moving = new Set(itemKeys);
  const currentFrame = scopeStack[scopeStack.length - 1];
  const currentSubgraphId = currentFrame?.type === 'subgraph' ? currentFrame.id : null;
  const movingGroupIds = itemKeys.flatMap((itemKey) => {
    const identity = resolveContainerIdentityFromHierarchicalKey(workflow, itemKey);
    return identity?.type === 'group'
      && (identity.subgraphId ?? null) === currentSubgraphId
      ? [identity.groupId]
      : [];
  });
  const movingGroupNodes = collectGroupMoveSelection(
    workflow,
    currentSubgraphId,
    movingGroupIds,
  ).nodeIds;

  const scopeNodes = resolveCurrentScope(scopeStack, workflow).nodes;
  // The subgraph types being moved, including any inside a group in the
  // selection. A destination cannot be one of them, nor anything they already
  // contain — that would put a subgraph inside itself.
  const movingTypes = new Set(
    scopeNodes
      .filter(
        (node) =>
          defIds.has(node.type)
          && (moving.has(node.itemKey ?? '') || movingGroupNodes.has(node.id)),
      )
      .map((node) => node.type),
  );

  const candidates = scopeNodes.filter(
    (node) =>
      defIds.has(node.type)
      && !moving.has(node.itemKey ?? '')
      && !movingGroupNodes.has(node.id)
      && !movingTypes.has(node.type)
      && ![...movingTypes].some((movingType) =>
        subgraphContains(workflow, movingType, node.type),
      ),
  );

  const selected = scopeNodes.filter(
    (node) => moving.has(node.itemKey ?? '') || movingGroupNodes.has(node.id),
  );
  return preferConnectedInstances(candidates, selected);
}

/** Every link id touching this node, in or out. */
function incidentLinkIds(node: WorkflowNode): number[] {
  const ids: number[] = [];
  for (const input of node.inputs ?? []) {
    if (input.link != null) ids.push(input.link);
  }
  for (const output of node.outputs ?? []) {
    for (const id of output.links ?? []) ids.push(id);
  }
  return ids;
}

/**
 * Where a type has several instances in scope, offer only the one the selection
 * is wired to.
 *
 * A move edits the DEFINITION, so every instance ends up with the moved node
 * either way; the instance picked only decides which one keeps its own value
 * for the boundary slot the move retires. That makes the connected instance
 * almost always the intended answer, and a list of twelve identical section
 * names is no way to find it — the twelve-section workflows this was written
 * against are unreadable otherwise.
 *
 * Read through the nodes' own link ids rather than a link table: root serializes
 * links as tuples and a subgraph definition as objects, and this runs in both.
 *
 * Narrowing needs a clear answer. A type whose instances the selection does not
 * touch, or touches in more than one place, keeps all of them — guessing there
 * would hide the destination the user meant.
 */
function preferConnectedInstances(
  candidates: WorkflowNode[],
  selected: WorkflowNode[],
): WorkflowNode[] {
  if (candidates.length < 2 || selected.length === 0) return candidates;
  const selectionLinks = new Set(selected.flatMap(incidentLinkIds));
  if (selectionLinks.size === 0) return candidates;

  const byType = new Map<string, WorkflowNode[]>();
  for (const candidate of candidates) {
    byType.set(candidate.type, [...(byType.get(candidate.type) ?? []), candidate]);
  }

  const dropped = new Set<number>();
  for (const instances of byType.values()) {
    if (instances.length < 2) continue;
    const connected = instances.filter((instance) =>
      incidentLinkIds(instance).some((id) => selectionLinks.has(id)),
    );
    if (connected.length !== 1) continue;
    for (const instance of instances) {
      if (instance !== connected[0]) dropped.add(instance.id);
    }
  }

  return dropped.size === 0 ? candidates : candidates.filter((node) => !dropped.has(node.id));
}

/**
 * Whether `rootId`'s definition holds an instance of `targetId`, at any depth.
 *
 * Moving a placeholder of type T into a subgraph D nests T inside D, so D must
 * not already live inside T. Without this the two definitions can be made to
 * contain each other, and expansion then leaves an unexpanded subgraph node in
 * the prompt for the server to reject.
 */
function subgraphContains(workflow: Workflow, rootId: string, targetId: string): boolean {
  const byId = new Map(
    (workflow.definitions?.subgraphs ?? []).map((definition) => [definition.id, definition]),
  );
  const seen = new Set<string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const node of byId.get(id)?.nodes ?? []) {
      if (node.type === targetId) return true;
      if (byId.has(node.type)) queue.push(node.type);
    }
  }
  return false;
}
