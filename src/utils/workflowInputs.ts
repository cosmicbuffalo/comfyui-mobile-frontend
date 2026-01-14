import type { Workflow, WorkflowNode, NodeTypes } from '@/api/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getWidgetValue(
  node: WorkflowNode,
  name: string,
  index: number | undefined
): unknown {
  const values = node.widgets_values;
  if (Array.isArray(values)) {
    if (index === undefined || index < 0 || index >= values.length) return undefined;
    return values[index];
  }
  if (isRecord(values)) {
    if (values[name] !== undefined) return values[name];
    if (node.type === 'VHS_VideoCombine' && name === 'save_image' && values.save_output !== undefined) {
      return values.save_output;
    }
  }
  return undefined;
}

export function getWorkflowWidgetIndexMap(
  workflow: Workflow,
  nodeId: number
): Record<string, number> | null {
  const entry = workflow.widget_idx_map?.[String(nodeId)];
  if (entry) {
    return entry;
  }
  const extraMap = workflow.extra?.widget_idx_map as Record<string, Record<string, number>> | undefined;
  return extraMap?.[String(nodeId)] ?? null;
}

export function isWidgetInputType(typeOrOptions: string | unknown[]): boolean {
  if (Array.isArray(typeOrOptions)) return true;
  const normalized = String(typeOrOptions).toUpperCase();
  return normalized === 'INT' || normalized === 'FLOAT' || normalized === 'BOOLEAN' || normalized === 'STRING';
}

export function normalizeWidgetValue(
  value: unknown,
  typeOrOptions: string | unknown[],
  options?: { comboIndexToValue?: boolean }
): unknown {
  if (Array.isArray(typeOrOptions)) {
    if (options?.comboIndexToValue && typeof value === 'number' && Number.isFinite(value)) {
      const idx = Math.trunc(value);
      return typeOrOptions[idx] ?? value;
    }
    return value;
  }

  if (typeOrOptions === 'INT') {
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Math.trunc(Number(value));
    }
  }

  if (typeOrOptions === 'FLOAT') {
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }

  if (typeOrOptions === 'BOOLEAN' && typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }

  return value;
}

export function normalizeComboValue(
  value: unknown,
  options: unknown[],
  defaultValue: unknown
): unknown {
  if (options.length === 0) return value;
  const normalized = normalizeWidgetValue(value, options, { comboIndexToValue: true });
  const normalizedString = String(normalized);
  const normalizedBase = normalizedString.split(/[\\/]/).pop() ?? normalizedString;
  const directMatch = options.find((opt) => String(opt) === normalizedString);
  if (directMatch !== undefined) {
    return directMatch;
  }
  const baseMatch = options.find((opt) => String(opt) === normalizedBase);
  if (baseMatch !== undefined) {
    return baseMatch;
  }
  if (defaultValue !== undefined && options.some((opt) => String(opt) === String(defaultValue))) {
    return defaultValue;
  }
  return options[0];
}

export function isValueCompatible(value: unknown, typeOrOptions: string | unknown[]): boolean {
  if (Array.isArray(typeOrOptions)) {
    const asString = String(value);
    return typeOrOptions.some((opt) => String(opt) === asString);
  }

  if (typeOrOptions === 'INT' || typeOrOptions === 'FLOAT') {
    if (typeof value === 'number' && Number.isFinite(value)) return true;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return true;
    return false;
  }

  if (typeOrOptions === 'BOOLEAN') {
    return typeof value === 'boolean' ||
      (typeof value === 'string' && ['true', 'false'].includes(value.toLowerCase()));
  }

  if (typeOrOptions === 'STRING') {
    return typeof value === 'string';
  }

  return true;
}

export function resolveSource(
  workflow: Workflow,
  linkId: number
): { nodeId: number; slotIndex: number } | null {
  const link = workflow.links.find((l) => l[0] === linkId);
  if (!link) return null;

  const sourceNodeId = link[1];
  const sourceSlotIndex = link[2];
  const sourceNode = workflow.nodes.find((n) => n.id === sourceNodeId);

  if (!sourceNode) return null;

  if (sourceNode.mode === 4 || sourceNode.type === 'Reroute') {
    const outputDef = sourceNode.outputs[sourceSlotIndex];
    if (!outputDef) return null;

    const matchingInput = sourceNode.inputs.find((input) => {
      if (input.link === null) return false;
      const inType = String(input.type).toUpperCase();
      const outType = String(outputDef.type).toUpperCase();
      return inType === outType || inType === '*' || outType === '*';
    });

    if (matchingInput?.link != null) {
      return resolveSource(workflow, matchingInput.link);
    }
    return null;
  }

  return { nodeId: sourceNodeId, slotIndex: sourceSlotIndex };
}

export function buildQueuePromptInputs(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  node: Workflow['nodes'][number],
  classType: string,
  allowedNodeIds: Set<number>,
  widgetIndexMap: Record<string, number> | null,
  seedOverrides?: Record<number, number>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  // Add connections from links first.
  for (const input of node.inputs) {
    if (input.link != null) {
      const link = workflow.links.find((l) => l[0] === input.link);
      if (link) {
        const sourceNodeId = link[1];
        if (allowedNodeIds.has(sourceNodeId)) {
          inputs[input.name] = [String(sourceNodeId), link[2]];
        }
      }
    }
  }

  const typeDef = nodeTypes[classType];
  if (!typeDef?.input) {
    return inputs;
  }

  const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
  const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
  const orderedInputs = [...requiredOrder, ...optionalOrder];
  const usedWidgetIndices = new Set<number>();
  let widgetCursor = 0;
  const widgetValuesArray = Array.isArray(node.widgets_values) ? node.widgets_values : null;

  if (widgetIndexMap) {
    Object.values(widgetIndexMap).forEach((idx) => usedWidgetIndices.add(idx));
  }

  for (const name of orderedInputs) {
    const inputDef = typeDef.input.required?.[name] || typeDef.input.optional?.[name];
    if (!inputDef) continue;

    const [typeOrOptions] = inputDef;
    const inputEntry = node.inputs.find((i) => i.name === name);
    const isConnected = inputEntry?.link != null;
    const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
    const hasSocket = Boolean(inputEntry);
    const isCombo = Array.isArray(typeOrOptions);
    const isWidget = isCombo || !hasSocket || isWidgetToggle;

    if (isWidget) {
      if (!widgetValuesArray) {
        if (name === 'seed' && seedOverrides?.[node.id] !== undefined && !(name in inputs)) {
          inputs[name] = seedOverrides[node.id];
        } else if (!isConnected && !(name in inputs)) {
          const rawValue = getWidgetValue(node, name, undefined);
          if (rawValue !== undefined) {
            inputs[name] = normalizeWidgetValue(rawValue, typeOrOptions);
          }
        }
        continue;
      }

      let indexToUse = widgetIndexMap?.[name];

      if (indexToUse === undefined) {
        for (let idx = widgetCursor; idx < widgetValuesArray.length; idx += 1) {
          if (usedWidgetIndices.has(idx)) continue;
          const candidate = widgetValuesArray[idx];
          if (isValueCompatible(candidate, typeOrOptions)) {
            indexToUse = idx;
            break;
          }
        }

        if (indexToUse === undefined && widgetCursor < widgetValuesArray.length) {
          while (usedWidgetIndices.has(widgetCursor) && widgetCursor < widgetValuesArray.length) {
            widgetCursor += 1;
          }
          if (widgetCursor < widgetValuesArray.length) {
            indexToUse = widgetCursor;
          }
        }
      }

      if (name === 'seed' && seedOverrides?.[node.id] !== undefined && !(name in inputs)) {
        inputs[name] = seedOverrides[node.id];
      } else if (indexToUse !== undefined && !isConnected && !(name in inputs)) {
        const rawValue = getWidgetValue(node, name, indexToUse);
        if (rawValue !== undefined) {
          inputs[name] = normalizeWidgetValue(rawValue, typeOrOptions);
        }
      }

      if (indexToUse !== undefined) {
        usedWidgetIndices.add(indexToUse);
        widgetCursor = Math.max(widgetCursor, indexToUse + 1);
      }
    }
  }

  if (seedOverrides?.[node.id] !== undefined && !('seed' in inputs) && !('noise_seed' in inputs)) {
    inputs.seed = seedOverrides[node.id];
  }

  return inputs;
}

export function buildWorkflowPromptInputs(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  node: WorkflowNode,
  classType: string,
  allowedNodeIds: Set<number>,
  widgetIndexMap: Record<string, number> | null,
  seedOverrides?: Record<number, number>
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  for (const input of node.inputs) {
    if (input.link != null) {
      const resolved = resolveSource(workflow, input.link);
      if (resolved) {
        if (allowedNodeIds.has(resolved.nodeId)) {
          inputs[input.name] = [String(resolved.nodeId), resolved.slotIndex];
        } else {
          // Handle PrimitiveNode - frontend-only node type that provides inline values
          const sourceNode = workflow.nodes.find((n) => n.id === resolved.nodeId);
          if (sourceNode && sourceNode.type === 'PrimitiveNode') {
            const value = Array.isArray(sourceNode.widgets_values) ? sourceNode.widgets_values[0] : undefined;
            if (value !== undefined) {
              inputs[input.name] = value;
            }
          }
        }
      }
    }
  }

  const typeDef = nodeTypes[classType];
  if (!typeDef?.input) {
    return inputs;
  }

  const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
  const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
  const orderedInputs = [...requiredOrder, ...optionalOrder];
  let widgetCursor = 0;
  const widgetValuesArray = Array.isArray(node.widgets_values) ? node.widgets_values : null;

  for (const name of orderedInputs) {
    try {
      const inputDef = typeDef.input.required?.[name] || typeDef.input.optional?.[name];
      if (!inputDef) continue;

      const [typeOrOptions] = inputDef;
      const inputEntry = node.inputs.find((i) => i.name === name);
      const isConnected = inputEntry?.link != null;
      const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
      const hasSocket = Boolean(inputEntry);
      const defaultValue = inputDef[1]?.default;
      const hasDefault = Object.prototype.hasOwnProperty.call(inputDef[1] ?? {}, 'default');
      const isWidgetType = isWidgetInputType(typeOrOptions) || isWidgetToggle || !hasSocket;
      const isWidget = isWidgetType;

      if (isWidget) {
        let indexToUse = widgetIndexMap?.[name];

        if (indexToUse === undefined) {
          indexToUse = widgetCursor;
        }

        if (name === 'seed' && seedOverrides?.[node.id] !== undefined && !(name in inputs)) {
          inputs[name] = seedOverrides[node.id];
        } else if (indexToUse !== undefined && !isConnected && !(name in inputs)) {
          const rawValue = getWidgetValue(node, name, indexToUse);
          if (rawValue !== undefined) {
            if (Array.isArray(typeOrOptions)) {
              inputs[name] = normalizeComboValue(rawValue, typeOrOptions, defaultValue);
            } else {
              inputs[name] = normalizeWidgetValue(rawValue, typeOrOptions);
            }
          }
        } else if (!isConnected && hasDefault && !(name in inputs)) {
          inputs[name] = defaultValue;
        }

        if (indexToUse !== undefined) {
          widgetCursor = Math.max(widgetCursor, indexToUse + 1);
        }

        if (String(typeOrOptions) === 'INT' && (name === 'seed' || name === 'noise_seed')) {
          if (indexToUse !== undefined) {
            widgetCursor = Math.max(widgetCursor, indexToUse + 2);
          } else {
            widgetCursor = Math.max(widgetCursor, widgetCursor + 1);
          }
        }
      }
    } catch (e) {
      console.error(`Error processing input '${name}' for node ${node.id} (${node.type}):`, e);
    }
  }

  // Include any widgets defined in widgetIndexMap that weren't captured by the type definition
  // This is important for nodes with dynamic widgets (like rgthree's) or when the object_info
  // is slightly out of sync with the workflow.
  if (widgetIndexMap) {
    for (const [name, index] of Object.entries(widgetIndexMap)) {
      if (!(name in inputs) && widgetValuesArray && index < widgetValuesArray.length) {
        const value = widgetValuesArray[index];
        if (value !== undefined && value !== null) {
          inputs[name] = value;
        }
      }
      if (!(name in inputs) && !widgetValuesArray) {
        const value = getWidgetValue(node, name, index);
        if (value !== undefined && value !== null) {
          inputs[name] = value;
        }
      }
    }
  }

  // Special handling for Power Lora Loader (rgthree) which has dynamic widgets not in object_info.
  // We ensure all widgets that look like Lora objects are included in the prompt inputs.
  if (classType === 'Power Lora Loader (rgthree)' || node.type === 'Power Lora Loader (rgthree)') {
    if (widgetValuesArray) {
      widgetValuesArray.forEach((val, idx) => {
        if (typeof val === 'object' && val !== null && 'lora' in val) {
          // Check if this index was already added under any name
          const alreadyAdded = Object.values(widgetIndexMap || {}).some(index => index === idx) || 
                               (widgetIndexMap === null && idx < widgetCursor);
          
          if (!alreadyAdded) {
            const name = `lora_${idx}`;
            if (!(name in inputs)) {
              // For rgthree nodes, if strengthTwo is missing but expected, we might want to provide it,
              // but the node's serializeValue handles it by deleting it if not in separate mode.
              // Our widget value already contains what it needs.
              inputs[name] = val;
            }
          }
        }
      });
    }
  }

  if (seedOverrides?.[node.id] !== undefined && !('seed' in inputs) && !('noise_seed' in inputs)) {
    inputs.seed = seedOverrides[node.id];
  }

  return inputs;
}
