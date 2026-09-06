import type { Workflow, WorkflowNode } from '@/api/types';
import {
  MOBILE_INSTANCE_NUMBER_PROPERTY,
  getInstanceNumber,
  getMobileDefMeta,
} from '@/utils/canonicalWorkflowOps';
import { collectSubgraphInstances } from '@/utils/boundarySlotLabels';

/**
 * Give every instance of a subgraph a stable number, and say which number the
 * next one should take.
 *
 * Numbers used to be handed out when a definition was promoted into a reusable
 * type. Every subgraph is a type now, so there is no such moment: instead they
 * are assigned the first time a second instance appears, which is also the
 * first time a number says anything. A subgraph that arrived from desktop, or
 * from a file written before this, has no numbers at all until then.
 *
 * Numbers already assigned are left alone. They may be showing right now in a
 * `{n}` name, and renumbering to close a gap would rename instances the user
 * never touched — so gaps stay, and a new instance takes the lowest number
 * nothing else holds.
 */
export function numberSubgraphInstances(
  workflow: Workflow,
  subgraphId: string,
): { workflow: Workflow; next: number } {
  const instances = collectSubgraphInstances(workflow, subgraphId);
  const taken = new Set<number>();
  for (const { node } of instances) {
    const number = getInstanceNumber(node);
    if (number != null) taken.add(number);
  }

  // By node id, so the same file numbers the same way every time.
  const unnumbered = instances
    .filter(({ node }) => getInstanceNumber(node) == null)
    .sort((a, b) => a.node.id - b.node.id);

  const assigned = new Map<number, number>();
  let cursor = 1;
  for (const { node } of unnumbered) {
    while (taken.has(cursor)) cursor += 1;
    taken.add(cursor);
    assigned.set(node.id, cursor);
  }

  const def = workflow.definitions?.subgraphs?.find((sg) => sg.id === subgraphId);
  const highest = taken.size > 0 ? Math.max(...taken) : 0;
  // The stored counter wins when it is ahead: an instance can be deleted, and
  // reusing its number would make two different things share a name over time.
  const stored = def ? getMobileDefMeta(def).nextInstanceNumber : undefined;
  const next = Math.max(stored ?? 0, highest + 1);

  if (assigned.size === 0) return { workflow, next };

  const number = (node: WorkflowNode): WorkflowNode => {
    const value = assigned.get(node.id);
    if (value == null) return node;
    return {
      ...node,
      properties: { ...(node.properties ?? {}), [MOBILE_INSTANCE_NUMBER_PROPERTY]: value },
    };
  };

  return {
    workflow: {
      ...workflow,
      nodes: (workflow.nodes ?? []).map(number),
      definitions: {
        ...(workflow.definitions ?? {}),
        subgraphs: (workflow.definitions?.subgraphs ?? []).map((sg) => ({
          ...sg,
          nodes: (sg.nodes ?? []).map(number),
        })),
      },
    },
    next,
  };
}
