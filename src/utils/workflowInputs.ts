import type { Workflow, WorkflowNode, NodeTypes } from '@/api/types';
import { extractLoraList, findLoraListIndex } from '@/utils/loraManager';
import {
  extractTriggerWordList,
  extractTriggerWordListLoose,
  extractTriggerWordMessage,
  findTriggerWordListIndex,
  findTriggerWordMessageIndex,
  isTriggerWordToggleNodeType
} from '@/utils/triggerWordToggle';

const DATE_PARTS = {
  d: (date: Date) => date.getDate(),
  M: (date: Date) => date.getMonth() + 1,
  h: (date: Date) => date.getHours(),
  m: (date: Date) => date.getMinutes(),
  s: (date: Date) => date.getSeconds(),
};

const DATE_FORMAT_PATTERN =
  Object.keys(DATE_PARTS)
    .map((key) => `${key}${key}?`)
    .join("|") + "|yyy?y?";

const ILLEGAL_FILENAME_CHARS =
  // eslint-disable-next-line no-control-regex
  /[/?<>\\:*|"\x00-\x1F\x7F]/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatDateToken(text: string, date: Date): string {
  return text.replace(new RegExp(DATE_FORMAT_PATTERN, "g"), (token: string): string => {
    if (token === "yy") return `${date.getFullYear()}`.substring(2);
    if (token === "yyyy") return date.getFullYear().toString();
    if (token[0] in DATE_PARTS) {
      const part = DATE_PARTS[token[0] as keyof typeof DATE_PARTS](date);
      return `${part}`.padStart(token.length, "0");
    }
    return token;
  });
}

function collectAllWorkflowNodes(workflow: Workflow): WorkflowNode[] {
  const subgraphNodes = (workflow.definitions?.subgraphs ?? []).flatMap(
    (subgraph) => subgraph.nodes ?? []
  );
  return [...workflow.nodes, ...subgraphNodes];
}

function resolveReplacementWidgetValue(
  workflow: Workflow,
  node: WorkflowNode,
  widgetName: string,
): unknown {
  const widgetIndexMap = getWorkflowWidgetIndexMap(workflow, node.id);
  const mappedIndex = widgetIndexMap?.[widgetName];
  if (mappedIndex !== undefined) {
    return getWidgetValue(node, widgetName, mappedIndex);
  }

  return getWidgetValue(node, widgetName, undefined);
}

function applyTextReplacements(workflow: Workflow, value: string): string {
  const allNodes = collectAllWorkflowNodes(workflow);

  return value.replace(/%([^%]+)%/g, (match, text: string) => {
    const split = text.split(".");
    if (split.length !== 2) {
      if (split[0]?.startsWith("date:")) {
        return formatDateToken(split[0].substring(5), new Date());
      }

      if (text !== "width" && text !== "height") {
        console.warn("[workflowInputs] Invalid replacement pattern", text);
      }
      return match;
    }

    let nodes = allNodes.filter(
      (nodeItem) => nodeItem.properties?.["Node name for S&R"] === split[0]
    );
    if (!nodes.length) {
      nodes = allNodes.filter(
        (nodeItem) => (nodeItem as { title?: unknown }).title === split[0]
      );
    }
    if (!nodes.length) {
      console.warn("[workflowInputs] Unable to find node", split[0]);
      return match;
    }
    if (nodes.length > 1) {
      console.warn("[workflowInputs] Multiple nodes matched", split[0], "using first match");
    }

    const node = nodes[0];
    const widgetValue = resolveReplacementWidgetValue(workflow, node, split[1]);
    if (widgetValue === undefined) {
      console.warn(
        "[workflowInputs] Unable to find widget",
        split[1],
        "on node",
        split[0],
        node
      );
      return match;
    }

    return `${widgetValue ?? ""}`.replace(ILLEGAL_FILENAME_CHARS, "_");
  });
}

function finalizeInputValue(
  workflow: Workflow,
  inputName: string,
  value: unknown,
): unknown {
  if (inputName === "filename_prefix" && typeof value === "string") {
    return applyTextReplacements(workflow, value);
  }
  return value;
}

function getPrimitiveInlineValue(node: WorkflowNode): unknown {
  const type = String(node.type || '');
  if (!type.startsWith('Primitive') && node.type !== 'PrimitiveNode') {
    return undefined;
  }

  if (Array.isArray(node.widgets_values)) {
    return node.widgets_values[0];
  }

  if (isRecord(node.widgets_values)) {
    const value = node.widgets_values.value;
    return value !== undefined ? value : node.widgets_values[0];
  }

  return undefined;
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
  if (Array.isArray(typeOrOptions)) {
    const signature = typeOrOptions.map((entry) => String(entry)).join(',').toUpperCase();
    if (signature.includes('AUTOCOMPLETE_TEXT_PROMPT') || signature.includes('AUTOCOMPLETE_TEXT_LORAS')) {
      return true;
    }
    return true;
  }
  const normalized = String(typeOrOptions).toUpperCase();
  return normalized === 'INT' ||
    normalized === 'FLOAT' ||
    normalized === 'BOOLEAN' ||
    normalized === 'STRING' ||
    normalized.includes('AUTOCOMPLETE_TEXT_LORAS') ||
    normalized.includes('AUTOCOMPLETE_TEXT_PROMPT');
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
  const resolved = resolveComboOption(value, options);
  if (resolved !== undefined) {
    return resolved;
  }
  if (defaultValue !== undefined && options.some((opt) => String(opt) === String(defaultValue))) {
    return defaultValue;
  }
  return options[0];
}

const SAFETENSORS_SUFFIX = '.safetensors';

function stripSafetensorsSuffix(value: string): string {
  const lower = value.toLowerCase();
  if (lower.endsWith(SAFETENSORS_SUFFIX)) {
    return value.slice(0, value.length - SAFETENSORS_SUFFIX.length);
  }
  return value;
}

function getComboBase(value: string): string {
  return value.split(/[\\/]/).pop() ?? value;
}

export function resolveComboOption(
  value: unknown,
  options: unknown[]
): unknown | undefined {
  if (!Array.isArray(options) || options.length === 0) return undefined;
  const normalized = normalizeWidgetValue(value, options, { comboIndexToValue: true });
  const normalizedString = String(normalized);
  const normalizedBase = getComboBase(normalizedString);

  const directMatch = options.find((opt) => String(opt) === normalizedString);
  if (directMatch !== undefined) {
    return directMatch;
  }

  const baseMatch = options.find((opt) => String(opt) === normalizedBase);
  if (baseMatch !== undefined) {
    return baseMatch;
  }

  const normalizedNoExt = stripSafetensorsSuffix(normalizedBase);
  const normalizedNoExtLower = normalizedNoExt.toLowerCase();
  const extensionlessMatch = options.find((opt) => {
    const optString = String(opt);
    const optBase = getComboBase(optString);
    const optNoExt = stripSafetensorsSuffix(optBase);
    return optNoExt.toLowerCase() === normalizedNoExtLower;
  });

  return extensionlessMatch;
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
          const sourceNode = workflow.nodes.find((n) => n.id === resolved.nodeId);
          if (sourceNode) {
            const value = getPrimitiveInlineValue(sourceNode);
            if (value !== undefined) {
              inputs[input.name] = value;
            } else {
              console.warn(
                `[workflowInputs] Missing source node for input '${input.name}' on node ${node.id} (${node.type}).`,
                {
                  sourceNodeId: resolved.nodeId,
                  sourceNodeType: sourceNode.type,
                  sourceAllowed: false
                }
              );
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
              inputs[name] = finalizeInputValue(
                workflow,
                name,
                normalizeComboValue(rawValue, typeOrOptions, defaultValue)
              );
            } else {
              inputs[name] = finalizeInputValue(
                workflow,
                name,
                normalizeWidgetValue(rawValue, typeOrOptions)
              );
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
          inputs[name] = finalizeInputValue(workflow, name, value);
        }
      }
      if (!(name in inputs) && !widgetValuesArray) {
        const value = getWidgetValue(node, name, index);
        if (value !== undefined && value !== null) {
          inputs[name] = finalizeInputValue(workflow, name, value);
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

  appendLoraManagerInputs(node, inputs, widgetValuesArray, widgetIndexMap);
  appendTriggerWordToggleInputs(node, inputs, widgetValuesArray, widgetIndexMap);

  return inputs;
}

function appendLoraManagerInputs(
  node: WorkflowNode,
  inputs: Record<string, unknown>,
  widgetValuesArray: unknown[] | null,
  widgetIndexMap: Record<string, number> | null
) {
  if ('loras' in inputs) return;

  const mappedIndex = widgetIndexMap?.loras;
  const listIndex = mappedIndex !== undefined ? mappedIndex : findLoraListIndex(node);
  if (listIndex === null) return;

  const rawValue = widgetValuesArray?.[listIndex];
  const loraList = extractLoraList(rawValue);
  if (loraList) {
    inputs.loras = loraList;
  }
}

function appendTriggerWordToggleInputs(
  node: WorkflowNode,
  inputs: Record<string, unknown>,
  widgetValuesArray: unknown[] | null,
  widgetIndexMap: Record<string, number> | null
) {
  if (!isTriggerWordToggleNodeType(node.type)) return;

  const mappedListIndex = widgetIndexMap?.toggle_trigger_words;
  const listIndex = mappedListIndex !== undefined
    ? mappedListIndex
    : findTriggerWordListIndex(node);
  if (listIndex === null) return;

  if (!('toggle_trigger_words' in inputs)) {
    const rawValue = widgetValuesArray?.[listIndex];
    const triggerList = extractTriggerWordList(rawValue) ?? extractTriggerWordListLoose(rawValue);
    if (triggerList) {
      inputs.toggle_trigger_words = triggerList;
    }
  }

  const mappedMessageIndex = widgetIndexMap?.originalMessage ?? widgetIndexMap?.orinalMessage;
  const messageIndex = mappedMessageIndex !== undefined
    ? mappedMessageIndex
    : findTriggerWordMessageIndex(node, listIndex);
  if (messageIndex === null) return;

  const messageValue = widgetValuesArray?.[messageIndex];
  const message = extractTriggerWordMessage(messageValue);
  if (message === null) return;

  const messageKey = widgetIndexMap && 'originalMessage' in widgetIndexMap
    ? 'originalMessage'
    : (widgetIndexMap && 'orinalMessage' in widgetIndexMap
      ? 'orinalMessage'
      : 'orinalMessage');

  if (!(messageKey in inputs)) {
    inputs[messageKey] = message;
  }
}
