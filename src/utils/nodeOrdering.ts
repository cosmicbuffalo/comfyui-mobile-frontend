import type { Workflow, WorkflowNode } from '@/api/types';

interface DependencyGraph {
  nodes: Map<number, WorkflowNode>;
  // Maps node id to array of node ids it depends on (inputs come from)
  dependencies: Map<number, number[]>;
  // Maps node id to array of node ids that depend on it (outputs go to)
  dependents: Map<number, number[]>;
}

function buildDependencyGraph(workflow: Workflow): DependencyGraph {
  const nodes = new Map<number, WorkflowNode>();
  const dependencies = new Map<number, number[]>();
  const dependents = new Map<number, number[]>();

  // Initialize maps
  for (const node of workflow.nodes) {
    nodes.set(node.id, node);
    dependencies.set(node.id, []);
    dependents.set(node.id, []);
  }

  // Build dependency relationships from links
  for (const link of workflow.links) {
    const [, sourceNodeId, , targetNodeId] = link;

    // Target depends on source
    const targetDeps = dependencies.get(targetNodeId);
    if (targetDeps && !targetDeps.includes(sourceNodeId)) {
      targetDeps.push(sourceNodeId);
    }

    // Source has dependent target
    const sourceDeps = dependents.get(sourceNodeId);
    if (sourceDeps && !sourceDeps.includes(targetNodeId)) {
      sourceDeps.push(targetNodeId);
    }
  }

  return { nodes, dependencies, dependents };
}

function isOutputNode(node: WorkflowNode): boolean {
  // Check if it's an output node type (SaveImage, PreviewImage, etc.)
  const outputTypes = [
    'SaveImage',
    'PreviewImage',
    'SaveAnimatedWEBP',
    'SaveAnimatedPNG',
    'SaveVideo',
    'SaveAudio'
  ];

  return outputTypes.some(t => node.type.includes(t)) ||
    // Or has no outgoing connections
    (node.outputs.length === 0 || node.outputs.every(o => !o.links || o.links.length === 0));
}

/**
 * Orders nodes for display in a vertical list.
 * Uses topological sort starting from output nodes.
 * Nodes are ordered so that dependencies come before dependents.
 */
export function orderNodesForMobile(workflow: Workflow): WorkflowNode[] {
  if (workflow.nodes.length === 0) {
    return [];
  }

  const graph = buildDependencyGraph(workflow);
  const visited = new Set<number>();
  const result: WorkflowNode[] = [];

  // DFS from a node, adding all dependencies first
  function dfs(nodeId: number) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = graph.nodes.get(nodeId);
    if (!node) return;

    // Visit all dependencies first
    const deps = graph.dependencies.get(nodeId) || [];
    for (const depId of deps) {
      dfs(depId);
    }

    // Then add this node
    result.push(node);
  }

  // Start from output nodes
  const outputNodes = workflow.nodes.filter(isOutputNode);

  // If no explicit output nodes, start from nodes with no dependents
  if (outputNodes.length === 0) {
    for (const node of workflow.nodes) {
      const deps = graph.dependents.get(node.id) || [];
      if (deps.length === 0) {
        outputNodes.push(node);
      }
    }
  }

  // Visit from each output node
  for (const node of outputNodes) {
    dfs(node.id);
  }

  // Handle any disconnected nodes
  for (const node of workflow.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return result;
}

/**
 * Find the node that a given input slot is connected to
 */
export function findConnectedNode(
  workflow: Workflow,
  nodeId: number,
  inputIndex: number
): { node: WorkflowNode; outputIndex: number } | null {
  const node = workflow.nodes.find(n => n.id === nodeId);
  if (!node || !node.inputs[inputIndex]) return null;

  const linkId = node.inputs[inputIndex].link;
  if (linkId === null) return null;

  const link = workflow.links.find(l => l[0] === linkId);
  if (!link) return null;

  const [, sourceNodeId, sourceSlot] = link;
  const sourceNode = workflow.nodes.find(n => n.id === sourceNodeId);
  if (!sourceNode) return null;

  return { node: sourceNode, outputIndex: sourceSlot };
}

/**
 * Find all nodes that an output slot is connected to
 */
export function findConnectedOutputNodes(
  workflow: Workflow,
  nodeId: number,
  outputIndex: number
): Array<{ node: WorkflowNode; inputIndex: number }> {
  const node = workflow.nodes.find(n => n.id === nodeId);
  if (!node || !node.outputs[outputIndex]) return [];

  const linkIds = node.outputs[outputIndex].links || [];
  const results: Array<{ node: WorkflowNode; inputIndex: number }> = [];

  for (const linkId of linkIds) {
    const link = workflow.links.find(l => l[0] === linkId);
    if (!link) continue;

    const [, , , targetNodeId, targetSlot] = link;
    const targetNode = workflow.nodes.find(n => n.id === targetNodeId);
    if (!targetNode) continue;

    results.push({ node: targetNode, inputIndex: targetSlot });
  }

  return results;
}
