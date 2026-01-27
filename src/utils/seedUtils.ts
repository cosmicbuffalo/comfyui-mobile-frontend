import type { Workflow, WorkflowNode, NodeTypes } from '@/api/types';
import { getWorkflowWidgetIndexMap, isWidgetInputType } from '@/utils/workflowInputs';

// Seed mode type
export type SeedMode = 'fixed' | 'randomize' | 'increment' | 'decrement';

// Special seed values used by ComfyUI
export const SPECIAL_SEED_RANDOM = -1;
export const SPECIAL_SEED_INCREMENT = -2;
export const SPECIAL_SEED_DECREMENT = -3;
export const DEFAULT_SPECIAL_SEED_RANGE = 1125899906842624;

const SPECIAL_SEED_VALUES = new Set([
  SPECIAL_SEED_RANDOM,
  SPECIAL_SEED_INCREMENT,
  SPECIAL_SEED_DECREMENT
]);

export function isSpecialSeedValue(value: number): boolean {
  return SPECIAL_SEED_VALUES.has(value);
}

export function getSpecialSeedMode(value: number): SeedMode | null {
  if (value === SPECIAL_SEED_RANDOM) return 'randomize';
  if (value === SPECIAL_SEED_INCREMENT) return 'increment';
  if (value === SPECIAL_SEED_DECREMENT) return 'decrement';
  return null;
}

export function getSpecialSeedValueForMode(mode: SeedMode): number | null {
  if (mode === 'randomize') return SPECIAL_SEED_RANDOM;
  if (mode === 'increment') return SPECIAL_SEED_INCREMENT;
  if (mode === 'decrement') return SPECIAL_SEED_DECREMENT;
  return null;
}

export function getWidgetIndexForInput(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
  inputName: string
): number | null {
  if (!nodeTypes) return null;

  const widgetIndexMap = getWorkflowWidgetIndexMap(workflow, node.id);
  const mappedIndex = widgetIndexMap?.[inputName];
  if (mappedIndex !== undefined) {
    return mappedIndex;
  }

  const typeDef = nodeTypes[node.type];
  if (!typeDef?.input) return null;

  const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
  const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
  const orderedInputs = [...requiredOrder, ...optionalOrder];
  let widgetIndex = 0;

  for (const name of orderedInputs) {
    const inputDef = typeDef.input.required?.[name] || typeDef.input.optional?.[name];
    if (!inputDef) continue;

    const [typeOrOptions] = inputDef;
    const inputEntry = node.inputs.find((i) => i.name === name);
    const isConnected = inputEntry?.link != null;
    const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
    const hasSocket = Boolean(inputEntry);
    const isWidgetType = isWidgetInputType(typeOrOptions) || isWidgetToggle || !hasSocket;
    const isWidget = isWidgetType;

    if (isWidget) {
      if (name === inputName) {
        return widgetIndex;
      }
      widgetIndex += 1;

      if (String(typeOrOptions) === 'INT' && (name === 'seed' || name === 'noise_seed')) {
        widgetIndex += 1;
      }
    }
  }

  return null;
}

// Find seed widget index by looking for any INT input containing 'seed' in its name
export function findSeedWidgetIndex(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode
): number | null {
  // First try the standard names
  const standardIndex = getWidgetIndexForInput(workflow, nodeTypes, node, 'seed') ??
    getWidgetIndexForInput(workflow, nodeTypes, node, 'noise_seed');
  if (standardIndex !== null) return standardIndex;

  if (!nodeTypes) {
    const hasSeedOutput = node.outputs?.some((output) =>
      String(output.name || '').toLowerCase().includes('seed') &&
      String(output.type || '').toUpperCase().includes('INT')
    );
    if (hasSeedOutput && Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
      return 0;
    }
    return null;
  }
  const typeDef = nodeTypes[node.type];
  if (!typeDef?.input) {
    const hasSeedOutput = node.outputs?.some((output) =>
      String(output.name || '').toLowerCase().includes('seed') &&
      String(output.type || '').toUpperCase().includes('INT')
    );
    if (hasSeedOutput && Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
      return 0;
    }
    return null;
  }

  const widgetIndexMap = getWorkflowWidgetIndexMap(workflow, node.id);
  const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
  const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
  const orderedInputs = [...requiredOrder, ...optionalOrder];
  let widgetIndex = 0;

  for (const name of orderedInputs) {
    const inputDef = typeDef.input.required?.[name] || typeDef.input.optional?.[name];
    if (!inputDef) continue;

    const [typeOrOptions] = inputDef;
    const inputEntry = node.inputs.find((i) => i.name === name);
    const isConnected = inputEntry?.link != null;
    const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
    const hasSocket = Boolean(inputEntry);
    const isWidgetType = isWidgetInputType(typeOrOptions) || isWidgetToggle || !hasSocket;

    if (isWidgetType) {
      const mappedIndex = widgetIndexMap?.[name];
      const indexToUse = mappedIndex ?? widgetIndex;

      // Check if this is an INT input with 'seed' in its name (case-insensitive)
      if (String(typeOrOptions) === 'INT' && name.toLowerCase().includes('seed')) {
        return indexToUse;
      }

      widgetIndex += 1;
      if (String(typeOrOptions) === 'INT' && (name === 'seed' || name === 'noise_seed')) {
        widgetIndex += 1;
      }
    }
  }

  return null;
}

export function getSeedStep(nodeTypes: NodeTypes, node: WorkflowNode): number {
  const typeDef = nodeTypes[node.type];
  if (!typeDef?.input) return 1;
  const inputDef = typeDef.input.required?.seed || typeDef.input.optional?.seed;
  const options = inputDef?.[1];
  const step = typeof options?.step === 'number' ? options.step : 1;
  return step > 0 ? step : 1;
}

export function getSeedRandomBounds(node: WorkflowNode): { min: number; max: number } {
  const rawMin = Number(node.properties?.randomMin ?? 0);
  const rawMax = Number(node.properties?.randomMax ?? DEFAULT_SPECIAL_SEED_RANGE);
  const min = Number.isFinite(rawMin) ? Math.max(-DEFAULT_SPECIAL_SEED_RANGE, rawMin) : 0;
  const max = Number.isFinite(rawMax) ? Math.min(DEFAULT_SPECIAL_SEED_RANGE, rawMax) : DEFAULT_SPECIAL_SEED_RANGE;
  return min <= max ? { min, max } : { min: max, max: min };
}

export function generateSeedFromNode(nodeTypes: NodeTypes, node: WorkflowNode): number {
  const step = getSeedStep(nodeTypes, node);
  const { min, max } = getSeedRandomBounds(node);
  const scaledStep = step > 0 ? step / 10 : 1;
  const range = max - min;
  let seed = min + Math.random() * range;
  if (scaledStep > 0) {
    seed = Math.round((seed - min) / scaledStep) * scaledStep + min;
  }
  if (seed > max) seed = max;
  if (seed < min) seed = min;
  if (SPECIAL_SEED_VALUES.has(seed)) {
    seed = 0;
  }
  return seed;
}

export function resolveSpecialSeedToUse(
  inputSeed: number,
  lastSeed: number | null,
  nodeTypes: NodeTypes,
  node: WorkflowNode
): number {
  if (SPECIAL_SEED_VALUES.has(inputSeed)) {
    if (typeof lastSeed === 'number' && !SPECIAL_SEED_VALUES.has(lastSeed)) {
      if (inputSeed === SPECIAL_SEED_INCREMENT) {
        return lastSeed + 1;
      }
      if (inputSeed === SPECIAL_SEED_DECREMENT) {
        return lastSeed - 1;
      }
    }
    return generateSeedFromNode(nodeTypes, node);
  }
  return Number.isFinite(inputSeed) ? inputSeed : 0;
}
