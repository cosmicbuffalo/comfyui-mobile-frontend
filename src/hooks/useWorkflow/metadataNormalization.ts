import type { Workflow, WorkflowNode, WorkflowGroup } from "@/api/types";

/**
 * Normalize raw workflow nodes to the shape the store expects (default-filled
 * inputs/outputs/flags/properties/mode/order). Self-contained — operates purely
 * on the API node shape, so it lives outside the store body.
 */
export function normalizeWorkflowNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => {
    const normalized = {
      ...node,
      inputs: node.inputs ?? [],
      outputs: node.outputs ?? [],
      flags: node.flags ?? {},
      properties: node.properties ?? {},
      mode: node.mode ?? 0,
      order: node.order ?? 0,
    };

    if (
      normalized.type === "Fast Groups Bypasser (rgthree)" &&
      Array.isArray(normalized.widgets_values) &&
      normalized.widgets_values.length === 0
    ) {
      const { widgets_values, ...withoutWidgetsValues } = normalized;
      void widgets_values;
      return withoutWidgetsValues;
    }

    return normalized;
  });
}

function stripNodeClientMetadata(node: WorkflowNode): WorkflowNode {
  if (!("itemKey" in node)) return node;
  const { itemKey, ...rest } = node;
  void itemKey;
  return rest as WorkflowNode;
}

function stripGroupClientMetadata(group: WorkflowGroup): WorkflowGroup {
  if (!("itemKey" in group)) return group;
  const { itemKey, ...rest } = group;
  void itemKey;
  return rest as WorkflowGroup;
}

/** Strip client-only `itemKey` metadata from a workflow (root + subgraphs) before persistence. */
export function stripWorkflowClientMetadata(workflow: Workflow): Workflow {
  const nextNodes = workflow.nodes.map(stripNodeClientMetadata);
  const nextGroups = (workflow.groups ?? []).map(stripGroupClientMetadata);
  const hadRootHierarchicalKeys =
    nextNodes.some((node, index) => node !== workflow.nodes[index]) ||
    nextGroups.some((group, index) => group !== (workflow.groups ?? [])[index]);
  const subgraphs = workflow.definitions?.subgraphs;
  if (!subgraphs) {
    return hadRootHierarchicalKeys
      ? { ...workflow, nodes: nextNodes, groups: nextGroups }
      : workflow;
  }

  let subgraphChanged = false;
  const nextSubgraphs = subgraphs.map((subgraph) => {
    const cleanedNodes = subgraph.nodes.map(stripNodeClientMetadata);
    const cleanedGroups = (subgraph.groups ?? []).map(stripGroupClientMetadata);
    let changed =
      cleanedNodes.some((node, index) => node !== subgraph.nodes[index]) ||
      cleanedGroups.some((group, index) => group !== (subgraph.groups ?? [])[index]);
    if (subgraph.itemKey != null) changed = true;
    if (!changed) return subgraph;
    subgraphChanged = true;
    const { itemKey, ...subgraphRest } = subgraph;
    void itemKey;
    return { ...subgraphRest, nodes: cleanedNodes, groups: cleanedGroups };
  });

  if (!hadRootHierarchicalKeys && !subgraphChanged) return workflow;

  return {
    ...workflow,
    nodes: nextNodes,
    groups: nextGroups,
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: nextSubgraphs,
    },
  };
}
