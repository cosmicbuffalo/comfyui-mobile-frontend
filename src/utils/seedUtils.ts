import type { Workflow, WorkflowNode, NodeTypes } from '@/api/types';
import { getNodeWidgetIndexMap, isWidgetInputType, skipImplicitSeedControlSlot } from '@/utils/workflowInputs';

// Seed mode type
export type SeedMode = 'fixed' | 'randomize' | 'increment' | 'decrement';
export interface SeedWidgetDescriptor {
  name: string;
  type: string;
  widgetIndex: number;
}

// Special seed values used by ComfyUI
export const SPECIAL_SEED_RANDOM = -1;
export const SPECIAL_SEED_INCREMENT = -2;
export const SPECIAL_SEED_DECREMENT = -3;
// Default ceiling for a generated random seed: 2^32-1. A node's own seed widget
// is further clamped to its declared max (see clampSeedToNodeBounds), but a seed
// PROVIDER (Seed (rgthree), a primitive) feeds its value to consumers by
// connection, where the consumer's max isn't known at generation time. Many
// nodes cap the seed at 2^32-1 (e.g. Qwen-VL); generating beyond that made
// ComfyUI reject the consumer's whole branch at validation. 2^32-1 is accepted
// by ~every node (those allowing 2^64 still accept anything <= 2^32-1), so it's
// the safe universal ceiling.
export const DEFAULT_SPECIAL_SEED_RANGE = 4294967295;

export const RGTHREE_SEED_NODE_TYPE = 'Seed (rgthree)';

// Node types that explicitly strip the auto-added control_after_generate widget
// from their seed input. For these, the seed widget itself encodes the mode via
// special values (-1/-2/-3), and any value at widgets_values[seedIndex + 1] is
// unrelated stale data — typically an empty string left over from older saves.
const NODE_TYPES_WITHOUT_SEED_CONTROL: ReadonlySet<string> = new Set([
  RGTHREE_SEED_NODE_TYPE,
]);

/**
 * True when the value at widgets_values[seedIndex + 1] represents a real
 * control_after_generate widget driving the seed mode. False for nodes that
 * explicitly remove that widget (e.g. rgthree's Seed) and for blank/missing
 * values that would otherwise be misread as a control mode.
 */
export function hasSeedControlWidget(
  node: WorkflowNode,
  controlWidgetValue: unknown,
): boolean {
  if (NODE_TYPES_WITHOUT_SEED_CONTROL.has(node.type)) return false;
  return typeof controlWidgetValue === 'string' && controlWidgetValue.length > 0;
}

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

  const widgetIndexMap = getNodeWidgetIndexMap(workflow, node);
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
        if (skipImplicitSeedControlSlot(node, widgetIndex)) {
          widgetIndex += 1;
        }
      }
    }
  }

  return null;
}

// Find seed widget index by looking for any INT input containing 'seed' in its name
export function findSeedWidgetIndex(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
  options?: {
    widgetDescriptors?: SeedWidgetDescriptor[];
  }
): number | null {
  const descriptorSeedIndex = options?.widgetDescriptors
    ?.find(
      (entry) =>
        String(entry.type).toUpperCase() === 'INT' &&
        (entry.name === 'seed' ||
          entry.name === 'noise_seed' ||
          entry.name.toLowerCase().includes('seed'))
    )
    ?.widgetIndex;
  if (typeof descriptorSeedIndex === 'number') {
    return descriptorSeedIndex;
  }

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

  const widgetIndexMap = getNodeWidgetIndexMap(workflow, node);
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
        if (skipImplicitSeedControlSlot(node, widgetIndex)) {
          widgetIndex += 1;
        }
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

/**
 * The min/max the node's seed INPUT actually accepts, read from object_info.
 * Many samplers allow a huge range (2^64), but some custom nodes cap the seed at
 * 2^32-1 (e.g. SeedVR2). Generating outside this range makes ComfyUI silently
 * reject that node's whole branch at validation, so the random seed must respect
 * it. Returns null when the node declares no numeric bounds.
 */
export function getSeedInputTypeBounds(
  nodeTypes: NodeTypes,
  node: WorkflowNode,
): { min?: number; max?: number } | null {
  const typeDef = nodeTypes[node.type];
  if (!typeDef?.input) return null;
  const inputDef =
    typeDef.input.required?.seed ||
    typeDef.input.optional?.seed ||
    typeDef.input.required?.noise_seed ||
    typeDef.input.optional?.noise_seed;
  const options = inputDef?.[1];
  const min = typeof options?.min === 'number' ? options.min : undefined;
  const max = typeof options?.max === 'number' ? options.max : undefined;
  if (min === undefined && max === undefined) return null;
  return { min, max };
}

/** Clamp a resolved seed into the node's declared seed-input range (if any). */
export function clampSeedToNodeBounds(
  seed: number,
  nodeTypes: NodeTypes,
  node: WorkflowNode,
): number {
  const bounds = getSeedInputTypeBounds(nodeTypes, node);
  if (!bounds) return seed;
  let clamped = seed;
  if (bounds.max !== undefined && clamped > bounds.max) clamped = bounds.max;
  if (bounds.min !== undefined && clamped < bounds.min) clamped = bounds.min;
  return clamped;
}

export function generateSeedFromNode(nodeTypes: NodeTypes, node: WorkflowNode): number {
  const step = getSeedStep(nodeTypes, node);
  const bounds = getSeedRandomBounds(node);
  // Intersect the (properties-based) random range with what the seed input
  // actually accepts, so we never generate a value the node will reject.
  const typeBounds = getSeedInputTypeBounds(nodeTypes, node);
  const min = typeBounds?.min !== undefined ? Math.max(bounds.min, typeBounds.min) : bounds.min;
  const max = typeBounds?.max !== undefined ? Math.min(bounds.max, typeBounds.max) : bounds.max;
  const scaledStep = step > 0 ? step / 10 : 1;
  const range = Math.max(0, max - min);
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
