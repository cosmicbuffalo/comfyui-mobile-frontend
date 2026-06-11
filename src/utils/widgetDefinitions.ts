import type { WorkflowLink, WorkflowNode, NodeTypes, NodeTypeDefinition, Workflow, WorkflowSubgraphLink } from '@/api/types';
import { getNodePropertyWidgetIndexMap, getWidgetValue, isWidgetInputType, skipImplicitSeedControlSlot } from '@/utils/workflowInputs';
import { findLoraListIndex, isLoraList, isLoraManagerNodeType, isPowerLoraLoaderNodeType } from '@/utils/loraManager';
import { modelWidgetKind } from '@/utils/modelWidgetKind';
import {
  extractTriggerWordList,
  extractTriggerWordListLoose,
  findTriggerWordListIndex,
  isTriggerWordToggleNodeType
} from '@/utils/triggerWordToggle';
import { getLinkId, getLinkOriginId, getLinkOriginSlot } from '@/utils/canonicalWorkflowOps';

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
  allowStrengthAdjustment: boolean,
  preferredListIndex?: number | null
): WidgetDefinition[] {
  if (!Array.isArray(node.widgets_values)) return [];
  const listIndex = preferredListIndex ?? findTriggerWordListIndex(node);
  if (listIndex === null) return [];
  if (listIndex < 0 || listIndex >= node.widgets_values.length) return [];

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
    if (isPowerLoraLoaderNodeType(node.type)) {
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
    const propertyWidgetIndexMap = getNodePropertyWidgetIndexMap(node);
    let widgetIndex = 0;

    const processInput = (name: string, input: [string | unknown[], Record<string, unknown>?]) => {
      if (!input) return; // Defensive check
      const [typeOrOptions, inputOptions] = input;
      const typeSignature = Array.isArray(typeOrOptions)
        ? typeOrOptions.map((entry) => String(entry)).join(',')
        : String(typeOrOptions);
      const typeSignatureUpper = typeSignature.toUpperCase();
      const normalizedType = String(typeOrOptions);
      const isAutocompleteLoras = typeSignatureUpper.includes('AUTOCOMPLETE_TEXT_LORAS');
      const isAutocompletePrompt = typeSignatureUpper.includes('AUTOCOMPLETE_TEXT_PROMPT');
      const isLoraManagerTextInput =
        isLoraManagerNodeType(node.type) && name === 'text';
      const isAutocompleteTextInput =
        isAutocompleteLoras || isAutocompletePrompt || isLoraManagerTextInput;
      const inputIndex = node.inputs.findIndex((i) => i.name === name);
      const inputEntry = inputIndex >= 0 ? node.inputs[inputIndex] : undefined;
      const isConnected = inputEntry?.link != null;
      const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
      const hasSocket = Boolean(inputEntry);
      const hasDefault = Object.prototype.hasOwnProperty.call(inputOptions ?? {}, 'default');
      const isWidgetType = isWidgetInputType(typeOrOptions) || isWidgetToggle || !hasSocket || hasDefault;
      const isCombo = Array.isArray(typeOrOptions) && !isAutocompleteTextInput;
      const comboOptions: Record<string, unknown> = isCombo
        ? { ...(inputOptions ?? {}), options: typeOrOptions }
        : { ...(inputOptions ?? {}) };
      if (isAutocompleteTextInput) {
        comboOptions.multiline = true;
      }
      if (isWidgetType) {
        const resolvedWidgetIndex = propertyWidgetIndexMap?.[name] ?? widgetIndex;
        const value = getWidgetValue(node, name, resolvedWidgetIndex);
        definitions.push({
          name,
          type: isCombo ? 'COMBO' : (isAutocompleteTextInput ? 'STRING' : normalizedType),
          options: comboOptions,
          value,
          widgetIndex: resolvedWidgetIndex,
          isCombo,
          connected: Boolean(isConnected),
          inputIndex
        });
      }

      if (isWidgetType) {
        widgetIndex += 1;
        if (String(typeOrOptions) === 'INT' && (name === 'seed' || name === 'noise_seed')) {
          // ComfyUI auto-adds a control_after_generate widget after every INT
          // seed input. Some custom nodes (Efficient KSampler family) strip it
          // on the JS side, so widgets_values may be one slot shorter — or
          // keep the slot but leave it null. Skip past the slot only when it
          // doesn't look like a real subsequent widget value; bump for
          // strings ('fixed'/'randomize'/etc.), null, and out-of-bounds
          // (slot absent entirely), but NOT for numbers/booleans/objects
          // which would be the value of the next real widget.
          if (skipImplicitSeedControlSlot(node, widgetIndex)) {
            widgetIndex += 1;
          }
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
      const mappedListIndex = definitions.find(
        (def) => def.name === 'toggle_trigger_words'
      )?.widgetIndex;
      definitions.push(
        ...buildTriggerWordToggleWidgetDefinitions(
          node,
          Boolean(allowStrengthValue),
          mappedListIndex ?? null
        )
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

/**
 * widgetIndex offset applied to proxy widget indices to avoid collisions with
 * input.widget promoted widget indices.
 */
export const PROXY_INDEX_OFFSET = 10000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export interface LinkedWidgetRoute {
  subgraphId: string | null;
  nodeId: number;
  widgetIndex: number;
  widgetName?: string;
  itemKey?: string;
}

function resolvePlaceholderInlineWidgetValue(
  placeholderNode: WorkflowNode,
  input: WorkflowNode['inputs'][number],
  widgetIndex: number,
): unknown {
  const values = placeholderNode.widgets_values;
  const widgetName = input.widget?.name;
  if (Array.isArray(values)) {
    return widgetIndex >= 0 && widgetIndex < values.length
      ? values[widgetIndex]
      : undefined;
  }
  if (isRecord(values)) {
    if (widgetName && values[widgetName] !== undefined) return values[widgetName];
    if (values[input.name] !== undefined) return values[input.name];
    if (input.localized_name && values[input.localized_name] !== undefined) {
      return values[input.localized_name];
    }
  }
  return undefined;
}

function resolvePlaceholderParentScope(
  placeholderNode: WorkflowNode,
  canonical: Workflow,
): {
  subgraphId: string | null;
  nodes: WorkflowNode[];
  links: Array<WorkflowLink | WorkflowSubgraphLink>;
} | null {
  if ((canonical.nodes ?? []).some((node) => node === placeholderNode || node.itemKey === placeholderNode.itemKey)) {
    return { subgraphId: null, nodes: canonical.nodes ?? [], links: canonical.links ?? [] };
  }

  for (const subgraph of canonical.definitions?.subgraphs ?? []) {
    if ((subgraph.nodes ?? []).some((node) => node === placeholderNode || node.itemKey === placeholderNode.itemKey)) {
      return {
        subgraphId: subgraph.id,
        nodes: subgraph.nodes ?? [],
        links: subgraph.links ?? [],
      };
    }
  }

  return null;
}

function resolveLinkedWidgetRoute(
  placeholderNode: WorkflowNode,
  input: WorkflowNode['inputs'][number],
  canonical: Workflow,
): { route: LinkedWidgetRoute; value: unknown } | null {
  if (input.link == null) return null;
  const parentScope = resolvePlaceholderParentScope(placeholderNode, canonical);
  if (!parentScope) return null;
  const link = parentScope.links.find((candidate) => getLinkId(candidate) === input.link);
  if (!link) return null;

  const originNodeId = getLinkOriginId(link);
  const originSlot = getLinkOriginSlot(link);
  if (originNodeId < 0) return null;
  const sourceNode = parentScope.nodes.find((node) => node.id === originNodeId);
  if (!sourceNode) return null;

  const widgetName = sourceNode.outputs?.[originSlot]?.name ?? input.widget?.name;
  const value =
    getWidgetValue(sourceNode, widgetName ?? '', originSlot) ??
    (originSlot !== 0 ? getWidgetValue(sourceNode, widgetName ?? '', 0) : undefined);

  return {
    route: {
      subgraphId: parentScope.subgraphId,
      nodeId: sourceNode.id,
      widgetIndex: originSlot,
      widgetName,
      itemKey: sourceNode.itemKey,
    },
    value,
  };
}

/**
 * Resolve all promoted widget definitions (both COMBO and non-COMBO) for a
 * subgraph placeholder node in a single pass.
 *
 * Promoted widgets appear as placeholder inputs with `input.widget: { name }` set.
 * Their values are usually stored in `placeholderNode.widgets_values[]` in
 * promoted-input order. When ComfyUI serializes the promoted input as a linked
 * primitive/control node, values live on that linked source instead.
 */
export function resolveAllSubgraphPlaceholderWidgetDefs(
  placeholderNode: WorkflowNode,
  canonical: Workflow,
  nodeTypes: NodeTypes | null
): { widgets: ReturnType<typeof getWidgetDefinitions>; inputWidgets: ReturnType<typeof getInputWidgetDefinitions> } {
  const promotedInputs = (placeholderNode.inputs ?? []).filter((inp) => inp.widget != null);
  if (promotedInputs.length === 0) return { widgets: [], inputWidgets: [] };

  const sg = canonical.definitions?.subgraphs?.find((s) => s.id === placeholderNode.type);

  const widgets: ReturnType<typeof getWidgetDefinitions> = [];
  const inputWidgets: ReturnType<typeof getInputWidgetDefinitions> = [];

  promotedInputs.forEach((inp, widgetIndex) => {
    const typeName = String(inp.type);
    const isCombo = typeName.toUpperCase() === 'COMBO';
    const widgetName = inp.widget!.name;
    const name = inp.localized_name || inp.name;
    const linkedSource = resolveLinkedWidgetRoute(placeholderNode, inp, canonical);
    const inlineValue = resolvePlaceholderInlineWidgetValue(placeholderNode, inp, widgetIndex);
    const value = inlineValue !== undefined ? inlineValue : linkedSource?.value;
    const inputIndex = placeholderNode.inputs.indexOf(inp);

    if (isCombo) {
      let options: Record<string, unknown> | unknown[] = [];
      if (sg && nodeTypes) {
        for (const innerNode of sg.nodes ?? []) {
          const typeDef = nodeTypes[innerNode.type];
          if (!typeDef) continue;
          const entry =
            typeDef.input?.required?.[widgetName] ??
            typeDef.input?.optional?.[widgetName];
          if (entry && Array.isArray(entry[0])) {
            options = { ...(entry[1] ?? {}), options: entry[0] as unknown[] };
            break;
          }
        }
      }
      // The promoted widget is shown under its display label (e.g. "Checkpoint"),
      // but the rich model picker is detected from the ComfyUI input name. Carry
      // the kind detected from the inner widget name (e.g. ckpt_name) so the
      // picker still appears on the promoted widget.
      const modelKind = modelWidgetKind(widgetName);
      const extraMeta: Record<string, unknown> = {};
      if (linkedSource) extraMeta.__linkedSource = linkedSource.route;
      if (modelKind) extraMeta.__modelKind = modelKind;
      inputWidgets.push({
        name,
        type: 'COMBO',
        value,
        options: Object.keys(extraMeta).length
          ? { ...(Array.isArray(options) ? { options } : options), ...extraMeta }
          : options,
        widgetIndex,
        connected: false,
        inputIndex,
      });
    } else {
      let options: Record<string, unknown> | undefined = undefined;
      if (sg && nodeTypes) {
        for (const innerNode of sg.nodes ?? []) {
          const typeDef = nodeTypes[innerNode.type];
          if (!typeDef) continue;
          const entry =
            typeDef.input?.required?.[widgetName] ??
            typeDef.input?.optional?.[widgetName];
          if (entry && !Array.isArray(entry[0])) {
            options = entry[1] as Record<string, unknown> | undefined;
            break;
          }
        }
      }
      widgets.push({
        name,
        type: typeName,
        options: linkedSource
          ? { ...(options ?? {}), __linkedSource: linkedSource.route }
          : options,
        value,
        widgetIndex,
        connected: false,
        inputIndex,
      });
    }
  });

  return { widgets, inputWidgets };
}

/** Resolve non-COMBO promoted widget definitions for a subgraph placeholder node. */
export function resolveSubgraphPlaceholderWidgetDefs(
  placeholderNode: WorkflowNode,
  canonical: Workflow,
  nodeTypes: NodeTypes | null
): ReturnType<typeof getWidgetDefinitions> {
  return resolveAllSubgraphPlaceholderWidgetDefs(placeholderNode, canonical, nodeTypes).widgets;
}

/** Resolve COMBO promoted widget definitions for a subgraph placeholder node. */
export function resolveSubgraphPlaceholderInputWidgetDefs(
  placeholderNode: WorkflowNode,
  canonical: Workflow,
  nodeTypes: NodeTypes | null
): ReturnType<typeof getInputWidgetDefinitions> {
  return resolveAllSubgraphPlaceholderWidgetDefs(placeholderNode, canonical, nodeTypes).inputWidgets;
}

/**
 * Routing metadata embedded in options for proxy widget definitions.
 * Used by NodeCard to route updates to the correct inner subgraph node.
 */
export interface ProxyWidgetRoute {
  subgraphId: string;
  innerNodeId: number;
  innerWidgetIndex: number;
}

const SEED_CONTROL_MODES = ['fixed', 'randomize', 'increment', 'decrement'];

/**
 * Resolve all widget definitions (both COMBO and non-COMBO) for a subgraph
 * placeholder node using the `proxyWidgets` mechanism in a single pass.
 *
 * `properties.proxyWidgets` is an array of [innerNodeId, widgetName] pairs referencing
 * inner subgraph nodes' widgets. Values are stored in those inner nodes' widgets_values.
 * The sentinel "-1" means the widget is handled by the input.widget slot-promotion mechanism.
 *
 * Returns widgetIndex values offset by PROXY_INDEX_OFFSET to avoid collisions.
 * Options include a `__proxy` key with ProxyWidgetRoute routing metadata.
 */
export function resolveAllSubgraphProxyWidgetDefs(
  placeholderNode: WorkflowNode,
  canonical: Workflow,
  nodeTypes: NodeTypes | null
): { widgets: ReturnType<typeof getWidgetDefinitions>; inputWidgets: ReturnType<typeof getInputWidgetDefinitions> } {
  const proxyWidgets = (placeholderNode.properties as Record<string, unknown>)?.proxyWidgets;
  if (!Array.isArray(proxyWidgets) || proxyWidgets.length === 0) return { widgets: [], inputWidgets: [] };

  const sg = canonical.definitions?.subgraphs?.find((s) => s.id === placeholderNode.type);
  if (!sg) return { widgets: [], inputWidgets: [] };

  const widgets: ReturnType<typeof getWidgetDefinitions> = [];
  const inputWidgets: ReturnType<typeof getInputWidgetDefinitions> = [];

  (proxyWidgets as [string, string][]).forEach(([innerNodeIdStr, widgetName], proxyIndex) => {
    if (innerNodeIdStr === '-1') return; // Handled by input.widget mechanism
    const innerNodeId = Number(innerNodeIdStr);
    const innerNode = (sg.nodes ?? []).find((n) => n.id === innerNodeId);
    if (!innerNode) return;

    const nodeTitle = (innerNode as { title?: string }).title;
    const displayName = nodeTitle ? `${nodeTitle}: ${widgetName}` : widgetName;
    const proxy: ProxyWidgetRoute = {
      subgraphId: placeholderNode.type,
      innerNodeId,
      innerWidgetIndex: -1, // set below per branch
    };

    // Try non-COMBO first
    const innerWidgetDef = getWidgetDefinitions(nodeTypes, innerNode).find((def) => def.name === widgetName);
    if (innerWidgetDef) {
      proxy.innerWidgetIndex = innerWidgetDef.widgetIndex;
      widgets.push({
        ...innerWidgetDef,
        name: displayName,
        widgetIndex: PROXY_INDEX_OFFSET + proxyIndex,
        options: {
          ...(innerWidgetDef.options as Record<string, unknown> ?? {}),
          __proxy: proxy,
        },
        inputIndex: -1,
      });
      return;
    }

    // Try COMBO
    const innerInputWidgetDef = getInputWidgetDefinitions(nodeTypes, innerNode).find((def) => def.name === widgetName);
    if (innerInputWidgetDef) {
      proxy.innerWidgetIndex = innerInputWidgetDef.widgetIndex;
      // Proxy widgets are shown under "Node: widget" labels, so carry the model
      // picker kind detected from the real inner widget name (e.g. lora_name).
      const modelKind = modelWidgetKind(widgetName);
      inputWidgets.push({
        ...innerInputWidgetDef,
        name: displayName,
        widgetIndex: PROXY_INDEX_OFFSET + proxyIndex,
        options: {
          ...(innerInputWidgetDef.options as Record<string, unknown> ?? {}),
          __proxy: proxy,
          ...(modelKind ? { __modelKind: modelKind } : {}),
        },
        inputIndex: -1,
      });
      return;
    }

    // Some seed helper nodes (for example EasySeed) expose seed only as an INT
    // output and store control_after_generate in widgets_values[seedIndex + 1],
    // so object_info has no COMBO input definition for the control. If the
    // workflow explicitly proxies that control, synthesize the missing combo so
    // placeholder cards read/write the actual inner node value.
    if (widgetName === 'control_after_generate') {
      const seedWidgetDef = getWidgetDefinitions(nodeTypes, innerNode).find(
        (def) => def.name === 'seed' || def.name === 'noise_seed',
      );
      if (!seedWidgetDef) return;

      const controlWidgetIndex = seedWidgetDef.widgetIndex + 1;
      const widgetValues = Array.isArray(innerNode.widgets_values)
        ? innerNode.widgets_values
        : [];
      const controlValue = widgetValues[controlWidgetIndex];
      if (typeof controlValue !== 'string') return;

      proxy.innerWidgetIndex = controlWidgetIndex;
      inputWidgets.push({
        name: displayName,
        type: 'COMBO',
        value: controlValue,
        widgetIndex: PROXY_INDEX_OFFSET + proxyIndex,
        connected: false,
        inputIndex: -1,
        options: {
          options: SEED_CONTROL_MODES.includes(controlValue)
            ? SEED_CONTROL_MODES
            : [...SEED_CONTROL_MODES, controlValue],
          __proxy: proxy,
        },
      });
    }
  });

  return { widgets, inputWidgets };
}

/** Resolve non-COMBO proxy widget definitions for a subgraph placeholder node. */
export function resolveSubgraphProxyWidgetDefs(
  placeholderNode: WorkflowNode,
  canonical: Workflow,
  nodeTypes: NodeTypes | null
): ReturnType<typeof getWidgetDefinitions> {
  return resolveAllSubgraphProxyWidgetDefs(placeholderNode, canonical, nodeTypes).widgets;
}

/** Resolve COMBO proxy widget definitions for a subgraph placeholder node. */
export function resolveSubgraphProxyInputWidgetDefs(
  placeholderNode: WorkflowNode,
  canonical: Workflow,
  nodeTypes: NodeTypes | null
): ReturnType<typeof getInputWidgetDefinitions> {
  return resolveAllSubgraphProxyWidgetDefs(placeholderNode, canonical, nodeTypes).inputWidgets;
}
