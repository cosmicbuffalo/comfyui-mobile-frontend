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
      // pos/size can be legitimately absent in tool-generated files; a plain
      // == null check keeps LiteGraph's object-serialized Float32Array shape
      // ({"0": x, "1": y}) intact, which downstream [0]/[1] indexing handles.
      pos: node.pos == null ? ([0, 0] as [number, number]) : node.pos,
      size: node.size == null ? ([200, 100] as [number, number]) : node.size,
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

function nodeShapeProblem(candidate: unknown, where: string): string | null {
  if (!candidate || typeof candidate !== "object") {
    return `${where} contains an entry that isn't a node`;
  }
  const node = candidate as { id?: unknown; type?: unknown };
  if (typeof node.id !== "number") return `${where} has a node without a numeric id`;
  if (typeof node.type !== "string") return `${where} has a node without a type`;
  return null;
}

/**
 * Cheap structural gate for anything about to enter loadWorkflow. JSON that
 * parses and even has a `nodes` array can still be junk ({"nodes":[null]});
 * loading it used to throw midway through the tab transition, leaving the
 * user parked on a broken blank tab. Returns a human-readable problem, or
 * null when the shape is loadable.
 */
export function findWorkflowShapeProblem(workflow: unknown): string | null {
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return "not a workflow object";
  }
  const nodes = (workflow as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return "missing its nodes list";
  for (const node of nodes) {
    const problem = nodeShapeProblem(node, "the workflow");
    if (problem) return problem;
  }
  const definitions = (workflow as { definitions?: unknown }).definitions;
  if (definitions == null) return null;
  if (typeof definitions !== "object") return "has malformed definitions";
  const subgraphs = (definitions as { subgraphs?: unknown }).subgraphs;
  if (subgraphs == null) return null;
  if (!Array.isArray(subgraphs)) return "has a malformed subgraph list";
  for (const subgraph of subgraphs) {
    if (!subgraph || typeof subgraph !== "object") return "has a malformed subgraph";
    const sg = subgraph as { id?: unknown; nodes?: unknown };
    if (typeof sg.id !== "string") return "has a subgraph without an id";
    if (sg.nodes == null) continue;
    if (!Array.isArray(sg.nodes)) return "has a subgraph with a malformed nodes list";
    for (const node of sg.nodes) {
      const problem = nodeShapeProblem(node, "a subgraph");
      if (problem) return problem;
    }
  }
  return null;
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
