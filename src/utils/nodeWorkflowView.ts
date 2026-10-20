import type { Workflow, WorkflowNode } from '@/api/types';
import { isSetGetNode } from './setGetNodes';
import { isUseEverywhereNode } from './useEverywhere';

interface RenderIndex {
  workflow: Workflow;
  structure: object;
  nodes: Map<number, WorkflowNode>;
  incoming: Map<number, number[]>;
  dependencies: Map<number, number[]>;
  globalValues: boolean;
}

// Build structural information once per immutable workflow update, rather than
// once per card/connection. Weak keys let undo snapshots and closed tabs expire.
const indexes = new WeakMap<Workflow, RenderIndex>();
let latest: RenderIndex | undefined;

function sameExcept(a: object, b: object, ignored: string): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter((key) => key !== ignored);
  return keys.length === Object.keys(right).filter((key) => key !== ignored).length
    && keys.every((key) => Object.hasOwn(right, key) && left[key] === right[key]);
}

function indexFor(workflow: Workflow): RenderIndex {
  const cached = indexes.get(workflow);
  if (cached) return cached;
  const previous = latest;
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const sameStructure = previous != null
    && sameExcept(previous.workflow, workflow, 'nodes')
    && previous.workflow.nodes.length === workflow.nodes.length
    && workflow.nodes.every((node, i) => {
      const before = previous.workflow.nodes[i];
      return before === node || (before.id === node.id && sameExcept(before, node, 'widgets_values'));
    });
  const incoming = sameStructure ? previous.incoming : new Map<number, number[]>();
  if (!sameStructure) {
    for (const [, origin, , target] of workflow.links ?? []) {
      const sources = incoming.get(target) ?? [];
      sources.push(origin);
      incoming.set(target, sources);
    }
  }
  const index: RenderIndex = {
    workflow, nodes, incoming,
    structure: sameStructure ? previous.structure : {},
    dependencies: sameStructure ? previous.dependencies : new Map(),
    // Promotions, proxy widgets and wireless links have dependencies beyond
    // drawn root links. Keep their existing full-workflow invalidation.
    globalValues: sameStructure ? previous.globalValues : Boolean(
      workflow.definitions?.subgraphs?.length
      || workflow.nodes.some((node) => isSetGetNode(node) || isUseEverywhereNode(node) || node.properties?.ue_convert),
    ),
  };
  indexes.set(workflow, index);
  latest = index;
  return index;
}

function dependenciesFor(index: RenderIndex, nodeId: number): number[] {
  const cached = index.dependencies.get(nodeId);
  if (cached) return cached;
  // Follow the whole upstream chain, including reroutes. An editor can display
  // a connected primitive's value even though that value lives on another card.
  const ids = new Set<number>();
  const pending = [nodeId];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    pending.push(...(index.incoming.get(id) ?? []));
  }
  const result = [...ids];
  index.dependencies.set(nodeId, result);
  return result;
}

/**
 * A render snapshot for one node. Unrelated root widget edits reuse the prior
 * snapshot; topology, labels, metadata, this node and upstream values refresh
 * it. Store actions must continue reading getState() when mutating the graph.
 */
export function createNodeWorkflowSelector(nodeId: number) {
  let previous: { index: RenderIndex; nodes: Array<WorkflowNode | undefined>; result: Workflow } | undefined;
  return ({ workflow }: { workflow: Workflow | null }): Workflow | null => {
    if (!workflow) { previous = undefined; return null; }
    const index = indexFor(workflow);
    if (index.globalValues) { previous = undefined; return workflow; }
    const nodes = dependenciesFor(index, nodeId).map((id) => index.nodes.get(id));
    const prior = previous;
    if (prior && prior.index.structure === index.structure
      && nodes.length === prior.nodes.length
      && nodes.every((node, i) => node === prior.nodes[i])) return prior.result;
    previous = { index, nodes, result: workflow };
    return workflow;
  };
}
