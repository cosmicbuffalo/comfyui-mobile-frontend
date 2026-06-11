import type { Workflow, WorkflowGroup, WorkflowNode } from '@/api/types';

/**
 * A workflow node tagged with the scope it lives in.
 * subgraphId is null for root-level nodes, otherwise the owning subgraph definition id.
 */
export interface ScopedNode {
  node: WorkflowNode;
  subgraphId: string | null;
}

/**
 * Collect every node in the workflow: root-level nodes plus the nodes inside
 * each subgraph definition. Order is root nodes first, then subgraph nodes in
 * definition order.
 */
export function collectAllWorkflowNodes(workflow: Workflow): WorkflowNode[] {
  const subgraphNodes = (workflow.definitions?.subgraphs ?? []).flatMap(
    (subgraph) => subgraph.nodes ?? [],
  );
  return [...workflow.nodes, ...subgraphNodes];
}

/**
 * Like {@link collectAllWorkflowNodes} but tags each node with its owning scope
 * (null for root, otherwise the subgraph definition id).
 */
export function collectScopedWorkflowNodes(workflow: Workflow): ScopedNode[] {
  const result: ScopedNode[] = workflow.nodes.map((node) => ({
    node,
    subgraphId: null,
  }));
  for (const sg of workflow.definitions?.subgraphs ?? []) {
    for (const node of sg.nodes ?? []) {
      result.push({ node, subgraphId: sg.id });
    }
  }
  return result;
}

/**
 * Collect every group in the workflow: root-level groups plus the groups inside
 * each subgraph definition.
 */
export function collectAllWorkflowGroups(workflow: Workflow): WorkflowGroup[] {
  const subgraphGroups = (workflow.definitions?.subgraphs ?? []).flatMap(
    (subgraph) => subgraph.groups ?? [],
  );
  return [...(workflow.groups ?? []), ...subgraphGroups];
}
