import type {
  NodeTypes,
  Workflow,
  WorkflowNode,
  WorkflowLink,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink
} from '@/api/types';
import { getNodePropertyWidgetIndexMap } from '@/utils/workflowInputs';
import {
  getWidgetDefinitions,
  getInputWidgetDefinitions,
  getPlaceholderValueIndexForBoundarySlot,
} from '@/utils/widgetDefinitions';

type RawLink = Omit<WorkflowSubgraphLink, 'id'>;
const MOBILE_SUBGRAPH_GROUP_MAP_KEY = '__mobile_subgraph_group_map';

/** LGraphEventMode.NEVER (mute) and .BYPASS — neither reaches the prompt. */
export const MODE_MUTED = 2;
export const MODE_BYPASS = 4;

export function isInertMode(mode: number | undefined): boolean {
  return mode === MODE_MUTED || mode === MODE_BYPASS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Read a promoted input's value from the placeholder's own widgets_values.
 * Array form stores values in full widget-typed subgraph-boundary order; record
 * form stores them by widget name.
 *
 * `null` reads as "this instance holds no value here", the same as a missing
 * entry. Every write path that has to land a value at a fixed index pads the
 * gap below it (`updateNodeWidgetValues`, `applyWidgetWriteBacks`,
 * `addPromotedValueToInstances`, `reconcileInstanceWidgetValues`), because the
 * index IS the widget's identity and appending would retarget the write. Those
 * pads are placeholders, not values — a template ships `widgets_values: []` and
 * keeps the real values on its inner nodes, so editing ANY promoted widget
 * above index 0 fills every slot beneath it with null. Returning those nulls
 * pushed them into the inner nodes and overwrote real values: editing `steps`
 * on a stock Text-to-Image subgraph blanked the sampler's seed, and ComfyUI
 * rejected the branch with "Failed to convert an input value to a INT value:
 * seed, None". null is not a legal widget value anywhere (litegraph's
 * `isWidgetValue` rejects it), so nothing legitimate is lost by skipping it.
 */
export function resolvePromotedInlineValue(
  placeholder: WorkflowNode,
  input: WorkflowNode['inputs'][number],
  widgetIndex: number,
): unknown {
  const values = placeholder.widgets_values;
  if (Array.isArray(values)) {
    const value = widgetIndex >= 0 && widgetIndex < values.length
      ? values[widgetIndex]
      : undefined;
    return value === null ? undefined : value;
  }
  if (isRecord(values)) {
    const widgetName = input.widget?.name;
    if (widgetName && values[widgetName] != null) return values[widgetName];
    if (values[input.name] != null) return values[input.name];
    if (input.localized_name && values[input.localized_name] != null) {
      return values[input.localized_name];
    }
  }
  return undefined;
}

/**
 * Write a promoted value into a cloned inner node's widgets_values.
 * When the target is itself a nested subgraph placeholder, the value lands in
 * its promoted-input slot and the next expansion pass pushes it further down.
 */
export function applyPromotedValueToTarget(
  innerNode: WorkflowNode | undefined,
  targetSlot: number,
  fallbackWidgetName: string | undefined,
  value: unknown,
  subgraphMap: Map<string, WorkflowSubgraphDefinition>,
  nodeTypes: NodeTypes | null,
): void {
  if (!innerNode) return;
  const targetInput = innerNode.inputs?.[targetSlot];
  const widgetName = targetInput?.widget?.name ?? fallbackWidgetName;
  if (!widgetName) return;

  const values = innerNode.widgets_values;
  if (isRecord(values)) {
    innerNode.widgets_values = { ...values, [widgetName]: value };
    return;
  }
  if (!Array.isArray(values)) return;

  let index: number | undefined;
  if (subgraphMap.has(innerNode.type)) {
    if (!targetInput) return;
    const nestedSubgraph = subgraphMap.get(innerNode.type);
    const promoted = (innerNode.inputs ?? []).filter((inp) => inp.widget != null);
    const promotedIndex = promoted.indexOf(targetInput);
    const boundaryInputIndex = (nestedSubgraph?.inputs ?? []).findIndex(
      (input) => input.name === targetInput.name,
    );
    const boundaryWidgetIndex = getPlaceholderValueIndexForBoundarySlot(
      innerNode,
      nestedSubgraph,
      boundaryInputIndex,
    );
    index = boundaryWidgetIndex ?? (promotedIndex === -1 ? undefined : promotedIndex);
  } else {
    index =
      getNodePropertyWidgetIndexMap(innerNode)?.[widgetName] ??
      (
        getWidgetDefinitions(nodeTypes, innerNode).find((def) => def.name === widgetName) ??
        getInputWidgetDefinitions(nodeTypes, innerNode).find((def) => def.name === widgetName)
      )?.widgetIndex;
  }
  if (index === undefined || index < 0) return;
  // Grow rather than bail when the index is past the end. A nested placeholder
  // usually serializes `widgets_values: []` (its values live on the inner
  // nodes), so bailing would drop every value promoted from an outer boundary
  // before the next expansion pass could push it further down. The gap is left
  // sparse, not null-filled: the next pass reads `undefined` as "no promoted
  // value here" and leaves the inner node's own default alone.
  const next = [...values];
  if (next.length <= index) next.length = index + 1;
  next[index] = value;
  innerNode.widgets_values = next;
}

function cloneNode(node: WorkflowNode, id: number): WorkflowNode {
  return {
    ...node,
    id,
    inputs: (node.inputs ?? []).map((input) => ({ ...input, link: null })),
    outputs: (node.outputs ?? []).map((output) => ({ ...output, links: [] })),
    widgets_values: node.widgets_values ?? [],
    flags: node.flags ?? {},
    properties: { ...(node.properties ?? {}) },
    mode: node.mode ?? 0,
    order: node.order ?? 0
  };
}

function getGroupIdForNode(
  node: WorkflowNode,
  groups: Workflow['groups']
): number | null {
  if (!groups || groups.length === 0) return null;
  const sortedGroups = [...groups].sort((a, b) => a.id - b.id);
  const [nodeX, nodeY] = node.pos;
  const [nodeWidth, nodeHeight] = node.size;
  const centerX = nodeX + nodeWidth / 2;
  const centerY = nodeY + nodeHeight / 2;

  for (const group of sortedGroups) {
    const [groupX, groupY, groupWidth, groupHeight] = group.bounding;
    if (
      centerX >= groupX &&
      centerX <= groupX + groupWidth &&
      centerY >= groupY &&
      centerY <= groupY + groupHeight
    ) {
      return group.id;
    }
  }
  return null;
}

/**
 * Map a placeholder's own slot indices onto the subgraph definition's boundary
 * slot indices.
 *
 * The placeholder's serialized `inputs[]`/`outputs[]` can be a shorter, stale
 * subset of the definition's boundary list, so the two are NOT positionally
 * aligned. ComfyUI reconciles them in `SubgraphNode._rebindInputSubgraphSlots`:
 * each slot claims the first still-unclaimed boundary slot matching its
 * `name:type` signature, falling back to a name-only match. Stock then discards
 * anything unmatched — we keep a positional last resort instead, because our
 * model keeps the placeholder's own slot list rather than rebuilding it from the
 * definition, so dropping here would silently delete the user's link.
 *
 * The claim bookkeeping is the part that matters: without it two placeholder
 * slots can map onto one boundary slot and duplicate its wiring.
 */
export function buildSlotMap(
  parentEntries: Array<{ name?: string; type?: unknown }>,
  subgraphEntries: Array<{ name?: string; type?: unknown }>
): Map<number, number> {
  const slotMap = new Map<number, number>();
  const claimed = new Set<number>();

  const bySignature = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  const push = (index: Map<string, number[]>, key: string, slot: number) => {
    const existing = index.get(key);
    if (existing) existing.push(slot);
    else index.set(key, [slot]);
  };
  subgraphEntries.forEach((entry, index) => {
    if (!entry?.name) return;
    push(bySignature, `${entry.name}:${String(entry.type ?? '')}`, index);
    push(byName, entry.name, index);
  });

  const takeUnclaimed = (candidates: number[] | undefined): number | undefined =>
    candidates?.find((index) => !claimed.has(index));

  // Every exact match first, across the whole list, before anyone falls back to
  // position. Claiming greedily in one pass let a slot that no longer exists
  // take the position of one that does: delete `positive` from the middle of a
  // boundary and the old `positive` entry would claim index 1 — now
  // `clip_vision_start_image` — before the real `clip_vision_start_image` entry
  // reached its own name match, moving a live connection onto an unrelated
  // input.
  const unmatched: number[] = [];
  parentEntries.forEach((entry, index) => {
    const name = entry?.name;
    const signature = name === undefined ? undefined : `${name}:${String(entry?.type ?? '')}`;
    const matched =
      (signature === undefined ? undefined : takeUnclaimed(bySignature.get(signature))) ??
      (name === undefined ? undefined : takeUnclaimed(byName.get(name)));
    if (matched === undefined) {
      unmatched.push(index);
      return;
    }
    claimed.add(matched);
    slotMap.set(index, matched);
  });

  // Only then, position — which is what carries a RENAMED slot, where the old
  // entry names something the definition no longer has and the definition's
  // slot at that index is still going spare. A deleted slot finds its position
  // already claimed by the entry that legitimately matched it, and maps to
  // nothing, which is what drops its links rather than moving them.
  for (const index of unmatched) {
    if (index >= subgraphEntries.length || claimed.has(index)) continue;
    claimed.add(index);
    slotMap.set(index, index);
  }

  return slotMap;
}

function rebuildNodeLinks(nodes: WorkflowNode[], links: WorkflowLink[]): WorkflowNode[] {
  const nodeMap = new Map<number, WorkflowNode>();
  for (const node of nodes) {
    node.inputs = (node.inputs ?? []).map((input) => ({ ...input, link: null }));
    node.outputs = (node.outputs ?? []).map((output) => ({
      ...output,
      links: []
    }));
    nodeMap.set(node.id, node);
  }

  for (const link of links) {
    const [linkId, originId, originSlot, targetId, targetSlot] = link;
    const originNode = nodeMap.get(originId);
    const targetNode = nodeMap.get(targetId);
    const originOutput = originNode?.outputs?.[originSlot];
    const targetInput = targetNode?.inputs?.[targetSlot];

    if (originOutput) {
      if (!originOutput.links) {
        originOutput.links = [];
      }
      originOutput.links.push(linkId);
    }
    if (targetInput) {
      targetInput.link = linkId;
    }
  }

  return nodes;
}

function expandWorkflowSubgraphsOnce(
  workflow: Workflow,
  subgraphMap: Map<string, WorkflowSubgraphDefinition>,
  previousPromptKeyMap: Map<number, string>,
  nodeTypes: NodeTypes | null
): { workflow: Workflow; changed: boolean; promptKeyMap: Map<number, string> } {
  // A bypassed or muted subgraph placeholder is never expanded. ComfyUI skips it
  // in graphToPrompt before `getInnerNodes()` runs, so none of its inner nodes
  // reach the prompt; a bypassed one instead passes values through at its OWN
  // boundary, matching an output slot to an input slot on the placeholder card
  // (ExecutableNodeDTO._getBypassSlotIndex). Leaving the placeholder in place as
  // an unexpanded mode-4/mode-2 node gives exactly that: resolveSource applies
  // the same slot matching to it, and the prompt builder drops it.
  const placeholderNodes = workflow.nodes.filter(
    (node) => subgraphMap.has(node.type) && !isInertMode(node.mode),
  );
  if (placeholderNodes.length === 0) {
    return { workflow, changed: false, promptKeyMap: previousPromptKeyMap };
  }

  const placeholderIds = new Set(placeholderNodes.map((node) => node.id));
  let nextNodeId = Math.max(0, ...workflow.nodes.map((node) => node.id)) + 1;
  const newNodes: WorkflowNode[] = [];
  const promptKeyMap = new Map<number, string>();
  const groups = workflow.groups ?? [];
  const extra = (workflow.extra ?? {}) as Record<string, unknown>;
  const previousGroupMap =
    typeof extra[MOBILE_SUBGRAPH_GROUP_MAP_KEY] === 'object' &&
    extra[MOBILE_SUBGRAPH_GROUP_MAP_KEY] !== null
      ? (extra[MOBILE_SUBGRAPH_GROUP_MAP_KEY] as Record<string, unknown>)
      : {};
  const subgraphGroupMap: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(previousGroupMap)) {
    if (typeof value === 'number' || value === null) {
      subgraphGroupMap[key] = value;
    }
  }

  const placeholderData = new Map<
    number,
    {
      inputSlotMap: Map<number, number>;
      outputSlotMap: Map<number, number>;
      inputTargets: Map<number, Array<RawLink>>;
      outputSources: Map<number, Array<RawLink>>;
      internalLinks: RawLink[];
    }
  >();

  for (const node of workflow.nodes) {
    if (!placeholderIds.has(node.id)) {
      newNodes.push(cloneNode(node, node.id));
      // Carry forward existing prompt key or default to the node's own ID
      promptKeyMap.set(node.id, previousPromptKeyMap.get(node.id) ?? String(node.id));
      continue;
    }

    const subgraph = subgraphMap.get(node.type);
    if (!subgraph) {
      newNodes.push(cloneNode(node, node.id));
      promptKeyMap.set(node.id, previousPromptKeyMap.get(node.id) ?? String(node.id));
      continue;
    }
    const groupId = getGroupIdForNode(node, groups);
    subgraphGroupMap[subgraph.id] = groupId ?? null;

    const inputSlotMap = buildSlotMap(node.inputs ?? [], subgraph.inputs ?? []);
    const outputSlotMap = buildSlotMap(node.outputs ?? [], subgraph.outputs ?? []);
    const nodeIdMap = new Map<number, number>();
    const inputTargets = new Map<number, Array<RawLink>>();
    const outputSources = new Map<number, Array<RawLink>>();
    const internalLinks: RawLink[] = [];

    // The placeholder's prompt key prefix for its children
    const placeholderPromptKey = previousPromptKeyMap.get(node.id) ?? String(node.id);

    const clonedById = new Map<number, WorkflowNode>();
    for (const subNode of subgraph.nodes ?? []) {
      const mappedId = nextNodeId++;
      nodeIdMap.set(subNode.id, mappedId);
      const expandedNode = cloneNode(subNode, mappedId);
      newNodes.push(expandedNode);
      clonedById.set(mappedId, expandedNode);
      // Hierarchical key: placeholderKey:innerNodeId
      promptKeyMap.set(mappedId, `${placeholderPromptKey}:${subNode.id}`);
    }

    for (const subLink of subgraph.links ?? []) {
      const originId = subLink.origin_id;
      const targetId = subLink.target_id;

      if (originId === -10) {
        const mappedTarget = nodeIdMap.get(targetId);
        if (mappedTarget !== undefined) {
          const targets = inputTargets.get(subLink.origin_slot) ?? [];
          targets.push({
            origin_id: -10,
            origin_slot: subLink.origin_slot,
            target_id: mappedTarget,
            target_slot: subLink.target_slot,
            type: subLink.type
          });
          inputTargets.set(subLink.origin_slot, targets);
        }
        continue;
      }

      if (targetId === -20) {
        const mappedOrigin = nodeIdMap.get(originId);
        if (mappedOrigin !== undefined) {
          const sources = outputSources.get(subLink.target_slot) ?? [];
          sources.push({
            origin_id: mappedOrigin,
            origin_slot: subLink.origin_slot,
            target_id: -20,
            target_slot: subLink.target_slot,
            type: subLink.type
          });
          outputSources.set(subLink.target_slot, sources);
        }
        continue;
      }

      const mappedOrigin = nodeIdMap.get(originId);
      const mappedTarget = nodeIdMap.get(targetId);
      if (mappedOrigin !== undefined && mappedTarget !== undefined) {
        internalLinks.push({
          origin_id: mappedOrigin,
          origin_slot: subLink.origin_slot,
          target_id: mappedTarget,
          target_slot: subLink.target_slot,
          type: subLink.type
        });
      }
    }

    // The placeholder's widgets_values are authoritative for every widget-typed
    // boundary input, including inputs omitted from the placeholder's shorter
    // inputs[] list. Push the complete boundary set into this instance's cloned
    // inner nodes. A visible boundary input with a live link is the exception:
    // expansion rewires that link below, so its stale inline value must not win.
    const parentSlotByBoundarySlot = new Map<number, number>();
    for (const [parentSlot, boundarySlot] of inputSlotMap) {
      parentSlotByBoundarySlot.set(boundarySlot, parentSlot);
    }
    (subgraph.inputs ?? []).forEach((boundaryInput, boundarySlot) => {
      const widgetIndex = getPlaceholderValueIndexForBoundarySlot(node, subgraph, boundarySlot);
      if (widgetIndex === null || !boundaryInput.name) return;
      const parentSlot = parentSlotByBoundarySlot.get(boundarySlot);
      const parentInput = parentSlot === undefined ? undefined : node.inputs?.[parentSlot];
      if (parentInput?.link != null) return;
      const valueInput = parentInput ?? {
        name: boundaryInput.name,
        type: String(boundaryInput.type ?? ''),
        link: null,
        label: boundaryInput.label,
        localized_name: boundaryInput.localized_name,
      };
      const value = resolvePromotedInlineValue(node, valueInput, widgetIndex);
      if (value === undefined) return;
      for (const target of inputTargets.get(boundarySlot) ?? []) {
        applyPromotedValueToTarget(
          clonedById.get(target.target_id),
          target.target_slot,
          parentInput?.widget?.name ?? boundaryInput.name,
          value,
          subgraphMap,
          nodeTypes,
        );
      }
    });

    placeholderData.set(node.id, {
      inputSlotMap,
      outputSlotMap,
      inputTargets,
      outputSources,
      internalLinks
    });
  }

  const rawLinks: RawLink[] = [];
  const baseLinks = workflow.links ?? [];

  for (const link of baseLinks) {
    const [, originId, originSlot, targetId, targetSlot, type] = link;
    const originIsPlaceholder = placeholderIds.has(originId);
    const targetIsPlaceholder = placeholderIds.has(targetId);

    if (!originIsPlaceholder && !targetIsPlaceholder) {
      rawLinks.push({
        origin_id: originId,
        origin_slot: originSlot,
        target_id: targetId,
        target_slot: targetSlot,
        type
      });
      continue;
    }

    if (originIsPlaceholder && targetIsPlaceholder) {
      const originData = placeholderData.get(originId);
      const targetData = placeholderData.get(targetId);
      const mappedOriginSlot = originData?.outputSlotMap.get(originSlot);
      const mappedTargetSlot = targetData?.inputSlotMap.get(targetSlot);
      if (mappedOriginSlot === undefined || mappedTargetSlot === undefined) continue;
      const sources = originData?.outputSources.get(mappedOriginSlot) ?? [];
      const targets = targetData?.inputTargets.get(mappedTargetSlot) ?? [];
      for (const source of sources) {
        for (const target of targets) {
          rawLinks.push({
            origin_id: source.origin_id,
            origin_slot: source.origin_slot,
            target_id: target.target_id,
            target_slot: target.target_slot,
            type: source.type
          });
        }
      }
      continue;
    }

    if (originIsPlaceholder) {
      const originData = placeholderData.get(originId);
      const mappedSlot = originData?.outputSlotMap.get(originSlot);
      if (mappedSlot === undefined) continue;
      const sources = originData?.outputSources.get(mappedSlot) ?? [];
      for (const source of sources) {
        rawLinks.push({
          origin_id: source.origin_id,
          origin_slot: source.origin_slot,
          target_id: targetId,
          target_slot: targetSlot,
          type: source.type
        });
      }
      continue;
    }

    if (targetIsPlaceholder) {
      const targetData = placeholderData.get(targetId);
      const mappedSlot = targetData?.inputSlotMap.get(targetSlot);
      if (mappedSlot === undefined) continue;
      const targets = targetData?.inputTargets.get(mappedSlot) ?? [];
      for (const target of targets) {
        rawLinks.push({
          origin_id: originId,
          origin_slot: originSlot,
          target_id: target.target_id,
          target_slot: target.target_slot,
          type: target.type
        });
      }
    }
  }

  for (const data of placeholderData.values()) {
    rawLinks.push(...data.internalLinks);
  }

  const links: WorkflowLink[] = rawLinks.map((link, index) => [
    index + 1,
    link.origin_id,
    link.origin_slot,
    link.target_id,
    link.target_slot,
    link.type
  ]);

  rebuildNodeLinks(newNodes, links);

  return {
    workflow: {
      ...workflow,
      extra: {
        ...extra,
        [MOBILE_SUBGRAPH_GROUP_MAP_KEY]: subgraphGroupMap
      },
      nodes: newNodes,
      links,
      last_node_id: Math.max(0, ...newNodes.map((node) => node.id)),
      last_link_id: links.length
    },
    changed: true,
    promptKeyMap
  };
}

export interface ExpandedWorkflowResult {
  workflow: Workflow;
  /** Maps each expanded node's numeric ID to its hierarchical prompt key (e.g. "50:7" for inner node 7 inside placeholder 50). */
  promptKeyMap: Map<number, string>;
}

export function expandWorkflowSubgraphs(
  workflow: Workflow,
  nodeTypes: NodeTypes | null = null
): ExpandedWorkflowResult {
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  if (subgraphs.length === 0) return { workflow, promptKeyMap: new Map() };

  const subgraphMap = new Map<string, WorkflowSubgraphDefinition>();
  for (const subgraph of subgraphs) {
    if (subgraph?.id) {
      subgraphMap.set(subgraph.id, subgraph);
    }
  }

  let current = workflow;
  let currentPromptKeyMap = new Map<number, string>();
  for (let i = 0; i < subgraphs.length + 4; i += 1) {
    const { workflow: next, changed, promptKeyMap } = expandWorkflowSubgraphsOnce(current, subgraphMap, currentPromptKeyMap, nodeTypes);
    if (!changed) break;
    current = next;
    currentPromptKeyMap = promptKeyMap;
  }

  return { workflow: current, promptKeyMap: currentPromptKeyMap };
}
