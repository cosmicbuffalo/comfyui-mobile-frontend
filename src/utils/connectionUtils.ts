import type { Workflow, WorkflowNode, NodeTypes, NodeTypeDefinition } from '@/api/types';
import { buildDefaultConnectionInputs } from '@/utils/workflowInputs';

function normalizeTypeTokens(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => normalizeTypeTokens(entry))
      .filter(Boolean);
  }
  const text = String(value);
  if (!text) return [];
  return text.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function isConcreteToken(token: string): boolean {
  // These are too generic for strict picker suggestions.
  if (token === '*') return false;
  if (token === 'OPT_CONNECTION') return false;
  return true;
}

function buildAdjacency(workflow: Workflow): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  for (const link of workflow.links) {
    const [, sourceNodeId, , targetId] = link;
    const next = adjacency.get(sourceNodeId) ?? [];
    next.push(targetId);
    adjacency.set(sourceNodeId, next);
  }
  return adjacency;
}

function collectReachableNodes(
  adjacency: Map<number, number[]>,
  startNodeId: number
): Set<number> {
  const visited = new Set<number>([startNodeId]);
  const queue: number[] = [startNodeId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push(neighbor);
    }
  }
  return visited;
}

function buildReverseAdjacency(
  adjacency: Map<number, number[]>
): Map<number, number[]> {
  const reverseAdjacency = new Map<number, number[]>();
  for (const [fromId, toIds] of adjacency.entries()) {
    for (const toId of toIds) {
      const incoming = reverseAdjacency.get(toId) ?? [];
      incoming.push(fromId);
      reverseAdjacency.set(toId, incoming);
    }
  }
  return reverseAdjacency;
}

function collectNodesThatCanReach(
  reverseAdjacency: Map<number, number[]>,
  targetNodeId: number
): Set<number> {
  const visited = new Set<number>([targetNodeId]);
  const queue: number[] = [targetNodeId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const parents = reverseAdjacency.get(current) ?? [];
    for (const parentId of parents) {
      if (visited.has(parentId)) continue;
      visited.add(parentId);
      queue.push(parentId);
    }
  }
  return visited;
}

/**
 * Check if two types are compatible.
 * Normalizes to uppercase, splits on commas, checks intersection.
 * "*" matches anything.
 */
export function areTypesCompatible(typeA: unknown, typeB: unknown): boolean {
  const typesA = normalizeTypeTokens(typeA);
  const typesB = normalizeTypeTokens(typeB);
  if (typesA.length === 0 || typesB.length === 0) return false;
  if (typesA.includes('*') || typesB.includes('*')) return true;
  return typesA.some((a) => typesB.includes(a));
}

/**
 * Check if two types are compatible but ONLY via the "*" wildcard token.
 * Returns true when at least one side has "*", types are compatible,
 * and there is no concrete type overlap.
 */
export function isWildcardOnlyMatch(typeA: unknown, typeB: unknown): boolean {
  if (!areTypesCompatible(typeA, typeB)) return false;
  const tokensA = normalizeTypeTokens(typeA);
  const tokensB = normalizeTypeTokens(typeB);
  if (!tokensA.includes('*') && !tokensB.includes('*')) return false;
  const concreteA = tokensA.filter(isConcreteToken);
  const concreteB = tokensB.filter(isConcreteToken);
  return !concreteA.some((a) => concreteB.includes(a));
}

/**
 * Find existing workflow nodes with compatible outputs for a given input slot.
 */
export function findCompatibleSourceNodes(
  workflow: Workflow,
  targetNodeId: number,
  inputSlotIndex: number
): Array<{ node: WorkflowNode; outputIndex: number }> {
  const targetNode = workflow.nodes.find((n) => n.id === targetNodeId);
  if (!targetNode) return [];

  const input = targetNode.inputs[inputSlotIndex];
  if (!input) return [];

  const results: Array<{ node: WorkflowNode; outputIndex: number }> = [];
  const adjacency = buildAdjacency(workflow);
  const nodesReachableFromTarget = collectReachableNodes(adjacency, targetNodeId);

  for (const node of workflow.nodes) {
    if (node.id === targetNodeId) continue;
    if (node.mode === 4) continue; // Skip bypassed nodes
    // Prevent cycle: target ... -> candidate, then candidate -> target.
    if (nodesReachableFromTarget.has(node.id)) continue;

    for (let i = 0; i < node.outputs.length; i++) {
      const output = node.outputs[i];
      if (areTypesCompatible(output.type, input.type)) {
        results.push({ node, outputIndex: i });
        break; // Only include first compatible output per node
      }
    }
  }

  return results;
}

/**
 * Find node types from object_info that can produce a compatible output.
 */
export function findCompatibleNodeTypesForInput(
  nodeTypes: NodeTypes,
  inputType: string
): Array<{ typeName: string; def: NodeTypeDefinition; outputIndex: number }> {
  const results: Array<{ typeName: string; def: NodeTypeDefinition; outputIndex: number }> = [];

  for (const [typeName, def] of Object.entries(nodeTypes)) {
    const outputs = def.output ?? [];
    for (let i = 0; i < outputs.length; i++) {
      if (areTypesCompatible(outputs[i], inputType)) {
        results.push({ typeName, def, outputIndex: i });
        break; // Only include first compatible output per type
      }
    }
  }

  return results;
}

function getConnectableInputSlots(
  def: NodeTypeDefinition
): Array<{ inputIndex: number; inputName: string; inputType: string }> {
  // Use the same active-default schema walk as addNode so DynamicCombo child
  // sockets occupy exactly the indices that the newly-created node receives.
  return buildDefaultConnectionInputs(def).map((input, inputIndex) => ({
    inputIndex,
    inputName: input.name,
    inputType: input.type,
  }));
}

/**
 * Find node types from object_info that can consume a compatible input.
 */
export function findCompatibleNodeTypesForOutput(
  nodeTypes: NodeTypes,
  outputType: string
): Array<{ typeName: string; def: NodeTypeDefinition; inputIndex: number; inputName: string; inputType: string }> {
  const results: Array<{ typeName: string; def: NodeTypeDefinition; inputIndex: number; inputName: string; inputType: string }> = [];

  for (const [typeName, def] of Object.entries(nodeTypes)) {
    const connectableInputs = getConnectableInputSlots(def);
    for (const input of connectableInputs) {
      if (areTypesCompatible(outputType, input.inputType)) {
        results.push({
          typeName,
          def,
          inputIndex: input.inputIndex,
          inputName: input.inputName,
          inputType: input.inputType
        });
        break; // Only include first compatible input per type
      }
    }
  }

  return results;
}

/**
 * Find compatible target node inputs for a given source output slot.
 * Returns all compatible inputs per node.
 */
export interface OutputTargetMatch {
  node: WorkflowNode;
  // Index in node.inputs, or -1 for a widget-input that isn't materialized yet
  // (it only exists in the node type definition — see widgetInputName/Type).
  inputIndex: number;
  widgetInputName?: string;
  widgetInputType?: string;
}

const SCALAR_WIDGET_TYPES = new Set(['STRING', 'INT', 'FLOAT', 'BOOLEAN']);

export function findCompatibleTargetNodesForOutput(
  workflow: Workflow,
  sourceNodeId: number,
  outputSlotIndex: number,
  nodeTypes?: NodeTypes | null,
): OutputTargetMatch[] {
  const sourceNode = workflow.nodes.find((n) => n.id === sourceNodeId);
  if (!sourceNode) return [];
  const output = sourceNode.outputs?.[outputSlotIndex];
  if (!output) return [];

  const results: OutputTargetMatch[] = [];
  const adjacency = buildAdjacency(workflow);
  const reverseAdjacency = buildReverseAdjacency(adjacency);
  const nodesThatCanReachSource = collectNodesThatCanReach(
    reverseAdjacency,
    sourceNodeId
  );
  for (const node of workflow.nodes) {
    if (node.id === sourceNodeId) continue;
    if (node.mode === 4) continue;
    // Prevent cycle: candidate target ... -> source, then source -> candidate target.
    if (nodesThatCanReachSource.has(node.id)) continue;
    const materializedNames = new Set<string>();
    for (let i = 0; i < (node.inputs?.length ?? 0); i += 1) {
      const input = node.inputs[i];
      materializedNames.add(input.name);
      if (areTypesCompatible(output.type, input.type)) {
        results.push({ node, inputIndex: i });
      }
    }
    // Also surface scalar widget-inputs that aren't materialized in node.inputs
    // yet — connecting overrides the widget's current value (the slot is created
    // on connect). Only scalar widget types qualify, so unconnected optional
    // *connection* inputs aren't mistaken for overrideable widgets.
    const typeDef = nodeTypes?.[node.type];
    if (typeDef?.input) {
      const inputDefs = { ...typeDef.input.required, ...typeDef.input.optional };
      for (const [name, def] of Object.entries(inputDefs)) {
        if (materializedNames.has(name) || !Array.isArray(def)) continue;
        const [typeOrOptions] = def;
        if (Array.isArray(typeOrOptions)) continue; // combo
        const type = String(typeOrOptions);
        if (!SCALAR_WIDGET_TYPES.has(type.toUpperCase())) continue;
        if (!areTypesCompatible(output.type, type)) continue;
        results.push({ node, inputIndex: -1, widgetInputName: name, widgetInputType: type });
      }
    }
  }
  return results;
}
