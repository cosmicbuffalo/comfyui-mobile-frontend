import type { Workflow, WorkflowNode, NodeTypes } from '@/api/types';
import { ueSlotKey, type UeLinkMap } from '@/utils/useEverywhere';
import { extractLoraList, findLoraListIndex, isLoraList, isPowerLoraLoaderNodeType } from '@/utils/loraManager';
import { extractTriggerWordList, extractTriggerWordListLoose, isTriggerWordList, extractTriggerWordMessage, findTriggerWordListIndex, findTriggerWordMessageIndex, isTriggerWordToggleNodeType } from '@/utils/triggerWordToggle';
import { getComboOptions, isComboType, isMultiSelectCombo, normalizeComboValue, normalizeWidgetValue } from './comboValues';
import { getActiveNodeInputDefinitions } from './dynamicComboRebuild';
import { finalizeInputValue } from './textReplacements';
import { getPrimitiveInlineValue, getWidgetValue, isRecord } from './widgetSlots';

export function resolveSource(
  workflow: Workflow,
  linkId: number,
  visitedLinkIds: Set<number> = new Set(),
  promptKeyMap?: Map<number, string>
): { nodeId: number; slotIndex: number } | null {
  if (visitedLinkIds.has(linkId)) return null;
  visitedLinkIds.add(linkId);

  const link = workflow.links.find((l) => l[0] === linkId);
  if (!link) return null;

  const sourceNodeId = link[1];
  const sourceSlotIndex = link[2];
  const sourceNode = workflow.nodes.find((n) => n.id === sourceNodeId);

  if (!sourceNode) return null;

  if (sourceNode.type === 'GetNode') {
    const getterName = getKJSetGetNodeName(sourceNode);
    if (!getterName) return null;

    const setterNode = findKJSetterNode(workflow, sourceNode, getterName, promptKeyMap);
    const setterInputLink = setterNode?.inputs?.[0]?.link;
    if (setterInputLink == null) return null;

    return resolveSource(workflow, setterInputLink, visitedLinkIds, promptKeyMap);
  }

  if (sourceNode.type === 'SetNode') {
    const setterInputLink = sourceNode.inputs?.[0]?.link;
    if (setterInputLink == null) return null;

    return resolveSource(workflow, setterInputLink, visitedLinkIds, promptKeyMap);
  }

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
      return resolveSource(workflow, matchingInput.link, visitedLinkIds, promptKeyMap);
    }
    return null;
  }

  return { nodeId: sourceNodeId, slotIndex: sourceSlotIndex };
}

function getKJSetGetNodeName(node: WorkflowNode): string | null {
  const values = node.widgets_values;
  if (Array.isArray(values)) {
    const value = values[0];
    return typeof value === 'string' && value ? value : null;
  }
  if (isRecord(values)) {
    const value = values[0] ?? values.value ?? values.name;
    return typeof value === 'string' && value ? value : null;
  }
  return null;
}

function getPromptScope(promptKey: string | undefined): string | null {
  if (!promptKey) return null;
  const scopeEnd = promptKey.lastIndexOf(':');
  return scopeEnd === -1 ? '' : promptKey.slice(0, scopeEnd);
}

function findKJSetterNode(
  workflow: Workflow,
  getterNode: WorkflowNode,
  getterName: string,
  promptKeyMap?: Map<number, string>
): WorkflowNode | undefined {
  const candidates = workflow.nodes.filter(
    (node) => node.type === 'SetNode' && getKJSetGetNodeName(node) === getterName
  );

  const getterScope = getPromptScope(promptKeyMap?.get(getterNode.id));
  if (getterScope === null) return candidates[0];

  return candidates.find(
    (node) => getPromptScope(promptKeyMap?.get(node.id)) === getterScope
  );
}

export function buildWorkflowPromptInputs(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  node: WorkflowNode,
  classType: string,
  allowedNodeIds: Set<number>,
  widgetIndexMap: Record<string, number> | null,
  seedOverrides?: Record<number, number>,
  promptKeyMap?: Map<number, string>,
  ueLinks?: UeLinkMap
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};

  for (const [slotIndex, input] of node.inputs.entries()) {
    // An input with no link may still be fed by a Use Everywhere broadcast. UE
    // is resolved rather than drawn, so the source has to be looked up instead
    // of followed — see `useEverywhere.ts`.
    if (input.link == null) {
      const broadcast = ueLinks?.get(ueSlotKey(node.id, slotIndex));
      if (!broadcast) continue;
      if (!allowedNodeIds.has(broadcast.originId)) continue;
      const nodeKey = promptKeyMap?.get(broadcast.originId) ?? String(broadcast.originId);
      inputs[input.name] = [nodeKey, broadcast.originSlot];
      continue;
    }
    const resolved = resolveSource(workflow, input.link, new Set(), promptKeyMap);
    if (!resolved) continue;
    if (allowedNodeIds.has(resolved.nodeId)) {
      const nodeKey = promptKeyMap?.get(resolved.nodeId) ?? String(resolved.nodeId);
      inputs[input.name] = [nodeKey, resolved.slotIndex];
      continue;
    }
    const sourceNode = workflow.nodes.find((n) => n.id === resolved.nodeId);
    if (!sourceNode) continue;
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

  const typeDef = nodeTypes[classType];
  if (!typeDef?.input) {
    return inputs;
  }

  const widgetValuesArray = Array.isArray(node.widgets_values) ? node.widgets_values : null;

  const activeInputDefinitions = getActiveNodeInputDefinitions(typeDef, node, widgetIndexMap);
  for (const definition of activeInputDefinitions) {
    const { name, qualifiedName, inputDef, widgetIndex, connected, value } = definition;
    try {
      const [typeOrOptions, inputOptions] = inputDef;
      if (widgetIndex === null || connected || qualifiedName in inputs) continue;

      // Apply the seed override for either conventional seed name. Dynamic seed
      // children submit under their qualified key just like every other child.
      if (
        (name === 'seed' || name === 'noise_seed') &&
        seedOverrides?.[node.id] !== undefined
      ) {
        inputs[qualifiedName] = seedOverrides[node.id];
        continue;
      }

      let promptValue = value;
      if (
        promptValue === undefined &&
        Object.prototype.hasOwnProperty.call(inputOptions ?? {}, 'default')
      ) {
        promptValue = inputOptions?.default;
      }
      if (promptValue === undefined) continue;

      if (isComboType(typeOrOptions)) {
        promptValue = normalizeComboValue(
          promptValue,
          getComboOptions(typeOrOptions, inputOptions),
          isMultiSelectCombo(inputOptions),
        );
      } else {
        promptValue = normalizeWidgetValue(promptValue, typeOrOptions);
      }
      inputs[qualifiedName] = finalizeInputValue(workflow, qualifiedName, promptValue);
    } catch (e) {
      console.error(`Error processing input '${qualifiedName}' for node ${node.id} (${node.type}):`, e);
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
  if (isPowerLoraLoaderNodeType(classType) || isPowerLoraLoaderNodeType(node.type)) {
    if (widgetValuesArray) {
      widgetValuesArray.forEach((val, idx) => {
        if (typeof val === 'object' && val !== null && 'lora' in val) {
          // Check if this index was already added under any name
          const alreadyAdded = Object.values(widgetIndexMap || {}).some(index => index === idx) ||
            (widgetIndexMap === null && activeInputDefinitions.some(
              (definition) => definition.widgetIndex === idx,
            ));
          
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

  const hasSeedInput = Object.keys(inputs).some(
    (name) => name === 'seed' || name === 'noise_seed' ||
      name.endsWith('.seed') || name.endsWith('.noise_seed'),
  );
  if (seedOverrides?.[node.id] !== undefined && !hasSeedInput) {
    inputs.seed = seedOverrides[node.id];
  }

  appendLoraManagerInputs(node, inputs, widgetValuesArray, widgetIndexMap);
  appendTriggerWordToggleInputs(node, inputs, widgetValuesArray, widgetIndexMap);

  return inputs;
}

/**
 * Lora Manager's list widgets are DOM widgets, and ComfyUI serializes those into
 * the prompt as `{ __value__: <value> }`. Sending the bare array instead is not
 * just a cosmetic divergence from the desktop frontend: in ComfyUI's prompt
 * format a two-element array IS a `[node_id, slot]` link, so a node holding
 * exactly two loras hands every consumer something that looks like a wired
 * input. Impact Pack's on-prompt hook walks each input for links and evaluates
 * `vv[0] in <set>` on it, which raises `unhashable type: 'dict'` and takes down
 * that hook's whole try block -- so ImpactWildcardProcessor silently stops
 * populating its wildcards whenever a two-lora Lora Loader shares the workflow
 * (issue #87). Every Lora Manager node reads both shapes (`get_loras_list`,
 * `_get_toggle_data`), so the wrapped one is safe and unambiguous.
 *
 * Only wrapped when the value is genuinely one of these lists -- an unrelated
 * node with a `loras` input that really is a link must be left alone.
 */

const asDomWidgetValue = (value: unknown): Record<string, unknown> => ({ __value__: value });

function appendLoraManagerInputs(
  node: WorkflowNode,
  inputs: Record<string, unknown>,
  widgetValuesArray: unknown[] | null,
  widgetIndexMap: Record<string, number> | null
) {
  if ('loras' in inputs) {
    if (isLoraList(inputs.loras)) inputs.loras = asDomWidgetValue(inputs.loras);
    return;
  }

  const mappedIndex = widgetIndexMap?.loras;
  const listIndex = mappedIndex !== undefined ? mappedIndex : findLoraListIndex(node);
  if (listIndex === null) return;

  const rawValue = widgetValuesArray?.[listIndex];
  const loraList = extractLoraList(rawValue);
  if (loraList) {
    inputs.loras = asDomWidgetValue(loraList);
  }
}

function appendTriggerWordToggleInputs(
  node: WorkflowNode,
  inputs: Record<string, unknown>,
  widgetValuesArray: unknown[] | null,
  widgetIndexMap: Record<string, number> | null
) {
  if (!isTriggerWordToggleNodeType(node.type)) return;

  // `trigger_words` is an input SLOT on this node, not a widget: Lora Manager
  // adds it with `addInput(...)`, and the node's five widget values are
  // group_mode / default_active / allow_strength_adjustment / the toggle DOM
  // widget / orinalMessage. object_info still declares it, so our positional
  // fallback -- which cannot see the undeclared DOM widget -- shifts up by one
  // and hands `trigger_words` the toggle list. Lora Manager ignores a non-string
  // override, so the value never did anything, but it put a two-element array of
  // objects on the wire, which is the shape that breaks Impact Pack's prompt hook
  // (see the note on `asDomWidgetValue`). Dropping it is what the desktop
  // frontend sends for an unlinked optional; a genuine link is a
  // [promptKey, slot] pair and fails the list check below, so it survives.
  if (isTriggerWordList(inputs.trigger_words, false)) {
    delete inputs.trigger_words;
  }

  const mappedListIndex = widgetIndexMap?.toggle_trigger_words;
  const listIndex = mappedListIndex !== undefined
    ? mappedListIndex
    : findTriggerWordListIndex(node);
  if (listIndex === null) return;

  if ('toggle_trigger_words' in inputs) {
    // Same DOM-widget wrapping as `loras` above, for the same reason.
    if (Array.isArray(inputs.toggle_trigger_words)) {
      inputs.toggle_trigger_words = asDomWidgetValue(inputs.toggle_trigger_words);
    }
  } else {
    const rawValue = widgetValuesArray?.[listIndex];
    const triggerList = extractTriggerWordList(rawValue) ?? extractTriggerWordListLoose(rawValue);
    if (triggerList) {
      inputs.toggle_trigger_words = asDomWidgetValue(triggerList);
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
