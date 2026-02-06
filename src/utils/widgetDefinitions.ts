import type { WorkflowNode, NodeTypes, NodeTypeDefinition } from '@/api/types';
import { getWidgetValue, isWidgetInputType } from '@/utils/workflowInputs';
import { findLoraListIndex, isLoraList, isLoraManagerNodeType } from '@/utils/loraManager';
import {
  extractTriggerWordList,
  extractTriggerWordListLoose,
  findTriggerWordListIndex,
  isTriggerWordToggleNodeType
} from '@/utils/triggerWordToggle';

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

function getStandardLoraOptions(nodeTypes: NodeTypes | null): unknown[] {
  if (!nodeTypes) return [];
  const standardLoraNode = getNodeTypeDefinition(nodeTypes, 'LoraLoader');
  if (standardLoraNode?.input?.required?.['lora_name']) {
    const [typeOrOptions] = standardLoraNode.input.required['lora_name'];
    if (Array.isArray(typeOrOptions)) {
      return typeOrOptions;
    }
  }
  return [];
}

function buildLoraManagerWidgetDefinitions(
  node: WorkflowNode,
  nodeTypes: NodeTypes | null
): WidgetDefinition[] {
  if (!Array.isArray(node.widgets_values)) return [];
  const listIndex = findLoraListIndex(node);
  if (listIndex === null) return [];
  const rawList = node.widgets_values[listIndex];
  if (!isLoraList(rawList)) return [];

  const loraOptions = getStandardLoraOptions(nodeTypes);
  const definitions: WidgetDefinition[] = [];
  const list = rawList;

  if (list.length > 0) {
    definitions.push({
      name: 'Loras',
      type: 'LM_LORA_HEADER',
      options: undefined,
      value: list.every((entry) => entry?.active !== false),
      widgetIndex: listIndex,
      isCombo: false,
      connected: false,
      inputIndex: -1
    });
  }

  list.forEach((entry, index) => {
    definitions.push({
      name: entry?.name || 'Lora',
      type: 'LM_LORA',
      options: {
        entryIndex: index,
        choices: loraOptions.length > 0 ? loraOptions : undefined
      },
      value: entry,
      widgetIndex: listIndex,
      isCombo: false,
      connected: false,
      inputIndex: -1
    });
  });

  definitions.push({
    name: 'Add Lora',
    type: 'LM_LORA_ADD',
    options: { choices: loraOptions.length > 0 ? loraOptions : undefined },
    value: null,
    widgetIndex: listIndex,
    isCombo: false,
    connected: false,
    inputIndex: -1
  });

  return definitions;
}

function buildTriggerWordToggleWidgetDefinitions(
  node: WorkflowNode,
  allowStrengthAdjustment: boolean
): WidgetDefinition[] {
  if (!Array.isArray(node.widgets_values)) return [];
  const listIndex = findTriggerWordListIndex(node);
  if (listIndex === null) return [];

  const rawList = node.widgets_values[listIndex];
  const list = extractTriggerWordList(rawList) ?? extractTriggerWordListLoose(rawList);
  if (!Array.isArray(list) || list.length === 0) return [];

  return list.map((entry, index) => ({
    name: entry?.text || 'Trigger Word',
    type: 'TW_WORD',
    options: {
      entryIndex: index,
      allowStrengthAdjustment
    },
    value: entry,
    widgetIndex: listIndex,
    isCombo: false,
    connected: false,
    inputIndex: -1
  }));
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
      const loraOptions = getStandardLoraOptions(nodeTypes);

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
      const loraManagerDefs = isLoraManagerNodeType(node.type)
        ? buildLoraManagerWidgetDefinitions(node, nodeTypes)
        : [];
      if (loraManagerDefs.length > 0) {
        return loraManagerDefs;
      }
      const triggerWordDefs = isTriggerWordToggleNodeType(node.type)
        ? buildTriggerWordToggleWidgetDefinitions(node, false)
        : [];
      if (triggerWordDefs.length > 0) {
        return triggerWordDefs;
      }
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
      const normalizedType = String(typeOrOptions);
      const isAutocompleteLoras = normalizedType === 'AUTOCOMPLETE_TEXT_LORAS';
      const inputIndex = node.inputs.findIndex((i) => i.name === name);
      const inputEntry = inputIndex >= 0 ? node.inputs[inputIndex] : undefined;
      const isConnected = inputEntry?.link != null;
      const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
      const hasSocket = Boolean(inputEntry);
      const hasDefault = Object.prototype.hasOwnProperty.call(inputOptions ?? {}, 'default');
      const isWidgetType = isWidgetInputType(typeOrOptions) || isWidgetToggle || !hasSocket || hasDefault;
      const isCombo = Array.isArray(typeOrOptions);
      const comboOptions: Record<string, unknown> = isCombo
        ? { ...(inputOptions ?? {}), options: typeOrOptions }
        : { ...(inputOptions ?? {}) };
      if (isAutocompleteLoras) {
        comboOptions.multiline = true;
      }
      if (isWidgetType) {
        const value = getWidgetValue(node, name, widgetIndex);
        definitions.push({
          name,
          type: isCombo ? 'COMBO' : (isAutocompleteLoras ? 'STRING' : normalizedType),
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

    if (isLoraManagerNodeType(node.type)) {
      definitions.push(...buildLoraManagerWidgetDefinitions(node, nodeTypes));
    }

    if (isTriggerWordToggleNodeType(node.type)) {
      const allowStrengthValue = definitions.find(
        (def) => def.name === 'allow_strength_adjustment'
      )?.value;
      definitions.push(
        ...buildTriggerWordToggleWidgetDefinitions(node, Boolean(allowStrengthValue))
      );
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
