import type { WorkflowNode, NodeTypes, NodeTypeDefinition } from '@/api/types';
import { getWidgetValue, isWidgetInputType } from '@/utils/workflowInputs';

export interface WidgetDefinition {
  name: string;
  type: string;
  options?: Record<string, unknown> | unknown[];
  value: unknown;
  widgetIndex: number;
  isCombo: boolean;
  connected: boolean;
  inputIndex: number;
}

export function getNodeTypeDefinition(
  nodeTypes: NodeTypes | null,
  nodeType: string
): NodeTypeDefinition | null {
  if (!nodeTypes) return null;
  return nodeTypes[nodeType] || null;
}

function collectWidgetDefinitions(
  nodeTypes: NodeTypes | null,
  node: WorkflowNode
): WidgetDefinition[] {
  try {
    // Handle PrimitiveNode specially - it's a frontend-only node type
    if (node.type === 'PrimitiveNode') {
      const outputType = node.outputs?.[0]?.type;
      if (!outputType) return [];

      const normalizedType = String(outputType).toUpperCase();
      const value = Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined;

      // Determine widget name from the output name or connected target
      const outputName = node.outputs?.[0]?.name || 'value';

      return [{
        name: outputName,
        type: normalizedType,
        options: undefined,
        value,
        widgetIndex: 0,
        isCombo: false,
        connected: false,
        inputIndex: -1
      }];
    }

    // Handle Power Lora Loader (rgthree) specially
    if (node.type === 'Power Lora Loader (rgthree)') {
      const definitions: WidgetDefinition[] = [];

      const showSeparate = node.properties?.['Show Strengths'] === 'Separate Model & Clip';

      // Try to get Lora options from the standard LoraLoader if available
      let loraOptions: unknown[] = [];
      if (nodeTypes) {
        const standardLoraNode = getNodeTypeDefinition(nodeTypes, 'LoraLoader');
        if (standardLoraNode?.input?.required?.['lora_name']) {
           const [typeOrOptions] = standardLoraNode.input.required['lora_name'];
           if (Array.isArray(typeOrOptions)) {
             loraOptions = typeOrOptions;
           }
        }
      }

      if (Array.isArray(node.widgets_values)) {
        const widgetValues = node.widgets_values;
        const loraIndices: number[] = [];
        widgetValues.forEach((value, index) => {
          if (
            typeof value === 'object' &&
            value !== null &&
            'lora' in value &&
            'strength' in value
          ) {
            loraIndices.push(index);
          }
        });

        if (loraIndices.length > 0) {
          // Add Toggle All header
          definitions.push({
            name: 'Loras',
            type: 'POWER_LORA_HEADER',
            options: { loraIndices },
            value: null,
            widgetIndex: -1,
            isCombo: false,
            connected: false,
            inputIndex: -1
          });

          loraIndices.forEach((index) => {
            const value = widgetValues[index];
            definitions.push({
              name: 'Lora',
              type: 'POWER_LORA',
              options: {
                choices: loraOptions.length > 0 ? loraOptions : undefined,
                showSeparate
              },
              value,
              widgetIndex: index,
              isCombo: false,
              connected: false,
              inputIndex: -1
            });
          });
        }

        // Add the "Add Lora" button at the end
        definitions.push({
          name: 'Add Lora',
          type: 'POWER_LORA_ADD',
          options: undefined,
          value: null,
          widgetIndex: node.widgets_values.length,
          isCombo: false,
          connected: false,
          inputIndex: -1
        });
      }
      return definitions;
    }

    const typeDef = getNodeTypeDefinition(nodeTypes, node.type);
    if (!typeDef?.input) {
      const hasSeedOutput = node.outputs?.some((output) =>
        String(output.name || '').toLowerCase().includes('seed') &&
        String(output.type || '').toUpperCase().includes('INT')
      );
      if (hasSeedOutput && Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
        return [{
          name: 'seed',
          type: 'INT',
          options: undefined,
          value: node.widgets_values[0],
          widgetIndex: 0,
          isCombo: false,
          connected: false,
          inputIndex: -1
        }];
      }
      return [];
    }

    const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
    const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
    const definitions: WidgetDefinition[] = [];
    let widgetIndex = 0;

    const processInput = (name: string, input: [string | unknown[], Record<string, unknown>?]) => {
      if (!input) return; // Defensive check
      const [typeOrOptions, inputOptions] = input;
      const inputIndex = node.inputs.findIndex((i) => i.name === name);
      const inputEntry = inputIndex >= 0 ? node.inputs[inputIndex] : undefined;
      const isConnected = inputEntry?.link != null;
      const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
      const hasSocket = Boolean(inputEntry);
      const hasDefault = Object.prototype.hasOwnProperty.call(inputOptions ?? {}, 'default');
      const isWidgetType = isWidgetInputType(typeOrOptions) || isWidgetToggle || !hasSocket || hasDefault;
      const isCombo = Array.isArray(typeOrOptions);
      const comboOptions = isCombo
        ? { ...(inputOptions ?? {}), options: typeOrOptions }
        : inputOptions;
      if (isWidgetType) {
        const value = getWidgetValue(node, name, widgetIndex);
        definitions.push({
          name,
          type: isCombo ? 'COMBO' : String(typeOrOptions),
          options: comboOptions,
          value,
          widgetIndex,
          isCombo,
          connected: Boolean(isConnected),
          inputIndex
        });
      }

      if (isWidgetType) {
        widgetIndex += 1;
        if (String(typeOrOptions) === 'INT' && (name === 'seed' || name === 'noise_seed')) {
          widgetIndex += 1;
        }
      }
    };

    for (const name of requiredOrder) {
      const input = typeDef.input.required?.[name];
      if (input) processInput(name, input);
    }

    for (const name of optionalOrder) {
      const input = typeDef.input.optional?.[name];
      if (input) processInput(name, input);
    }

    return definitions;
  } catch (e) {
    console.error(`Error collecting widget definitions for node ${node.id} (${node.type}):`, e);
    return []; // Return empty array on error to prevent crash
  }
}

export function getWidgetDefinitions(
  nodeTypes: NodeTypes | null,
  node: WorkflowNode
): Array<{ name: string; type: string; options?: Record<string, unknown>; value: unknown; widgetIndex: number; connected: boolean; inputIndex: number }> {
  return collectWidgetDefinitions(nodeTypes, node)
    .filter((def) => !def.isCombo)
    .map((def) => ({
      name: def.name,
      type: def.type,
      options: def.options as Record<string, unknown> | undefined,
      value: def.value,
      widgetIndex: def.widgetIndex,
      connected: def.connected,
      inputIndex: def.inputIndex
    }));
}

export function getInputWidgetDefinitions(
  nodeTypes: NodeTypes | null,
  node: WorkflowNode
): Array<{ name: string; type: string; value: unknown; options: Record<string, unknown> | unknown[]; widgetIndex: number; connected: boolean; inputIndex: number }> {
  return collectWidgetDefinitions(nodeTypes, node)
    .filter((def) => def.isCombo)
    .map((def) => ({
      name: def.name,
      type: def.type,
      value: def.value,
      options: def.options as Record<string, unknown> | unknown[],
      widgetIndex: def.widgetIndex,
      connected: def.connected,
      inputIndex: def.inputIndex
    }));
}
