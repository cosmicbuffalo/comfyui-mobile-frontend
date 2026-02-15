import type { Workflow, WorkflowNode, NodeTypes, NodeTypeDefinition } from '@/api/types';

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
 * Strict compatibility used by connection pickers.
 * Excludes generic wildcard-like tokens such as "*" and "OPT_CONNECTION".
 */
export function areTypesCompatibleStrict(typeA: unknown, typeB: unknown): boolean {
  const typesA = normalizeTypeTokens(typeA).filter(isConcreteToken);
  const typesB = normalizeTypeTokens(typeB).filter(isConcreteToken);
  if (typesA.length === 0 || typesB.length === 0) return false;
  return typesA.some((a) => typesB.includes(a));
}

/**
 * Find existing workflow nodes with compatible outputs for a given input slot.
 */
export function findCompatibleSourceNodes(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  targetNodeId: number,
  inputSlotIndex: number
): Array<{ node: WorkflowNode; outputIndex: number }> {
  const targetNode = workflow.nodes.find((n) => n.id === targetNodeId);
  if (!targetNode) return [];

  const input = targetNode.inputs[inputSlotIndex];
  if (!input) return [];

  const results: Array<{ node: WorkflowNode; outputIndex: number }> = [];

  for (const node of workflow.nodes) {
    if (node.id === targetNodeId) continue;
    if (node.mode === 4) continue; // Skip bypassed nodes

    for (let i = 0; i < node.outputs.length; i++) {
      const output = node.outputs[i];
      if (areTypesCompatibleStrict(output.type, input.type)) {
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
      if (areTypesCompatibleStrict(outputs[i], inputType)) {
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
  const requiredInputs = def.input?.required ?? {};
  const optionalInputs = def.input?.optional ?? {};
  const requiredOrder = def.input_order?.required ?? Object.keys(requiredInputs);
  const optionalOrder = def.input_order?.optional ?? Object.keys(optionalInputs);
  const slots: Array<{ inputIndex: number; inputName: string; inputType: string }> = [];

  const appendSlot = (name: string, value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) return;
    const [typeOrOptions] = value;
    // Ignore widget-only inputs to match addNode input construction.
    if (Array.isArray(typeOrOptions)) return;
    const normalized = String(typeOrOptions).toUpperCase();
    if (["INT", "FLOAT", "BOOLEAN", "STRING"].includes(normalized)) return;
    slots.push({
      inputIndex: slots.length,
      inputName: name,
      inputType: String(typeOrOptions)
    });
  };

  for (const name of requiredOrder) {
    appendSlot(name, requiredInputs[name]);
  }
  for (const name of optionalOrder) {
    appendSlot(name, optionalInputs[name]);
  }

  return slots;
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
      if (areTypesCompatibleStrict(outputType, input.inputType)) {
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
export function findCompatibleTargetNodesForOutput(
  workflow: Workflow,
  sourceNodeId: number,
  outputSlotIndex: number
): Array<{ node: WorkflowNode; inputIndex: number }> {
  const sourceNode = workflow.nodes.find((n) => n.id === sourceNodeId);
  if (!sourceNode) return [];
  const output = sourceNode.outputs?.[outputSlotIndex];
  if (!output) return [];

  const results: Array<{ node: WorkflowNode; inputIndex: number }> = [];
  for (const node of workflow.nodes) {
    if (node.id === sourceNodeId) continue;
    if (node.mode === 4) continue;
    for (let i = 0; i < (node.inputs?.length ?? 0); i += 1) {
      const input = node.inputs[i];
      if (areTypesCompatibleStrict(output.type, input.type)) {
        results.push({ node, inputIndex: i });
      }
    }
  }
  return results;
}
