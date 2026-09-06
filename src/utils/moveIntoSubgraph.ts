import type {
  Workflow,
  WorkflowGroup,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from '@/api/types';
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
  getLinkType,
  makeScopeLink,
  maxNodeIdAcrossScopes,
} from '@/utils/canonicalWorkflowOps';
import { newBoundarySlotId, uniqueBoundaryName } from '@/utils/subgraphBoundaryNames';
import { normalizeSubgraphPlaceholders } from '@/utils/normalizeSubgraphPlaceholders';

type ScopeLink = WorkflowLink | WorkflowSubgraphLink;

export interface MoveIntoSubgraphResult {
  workflow: Workflow;
  /** Boundary slots that stopped being needed, by the definition's own count. */
  removedInputs: number;
  removedOutputs: number;
  /** Slots the moved nodes' remaining outside links required. */
  addedInputs: number;
  addedOutputs: number;
  /** The ids the moved nodes took inside the definition, in move order. */
  movedInnerNodeIds: number[];
}

/**
 * Move nodes from a scope into a subgraph placed in that scope.
 *
 * The rule is the same one that decides a new subgraph's boundary — links that
 * cross the edge are slots, links inside are ordinary links — applied to the
 * membership after the move. What makes moving IN different from wrapping is
 * that it can *remove* slots as well as add them: a node that was feeding the
 * placeholder from outside now feeds the inner node directly, and the slot that
 * carried the value across has nothing left to carry.
 *
 * With a shared type the removal is decided from THIS placeholder's wiring, so
 * the other instances lose that connection. That is a real consequence and the
 * caller is expected to have offered to fork first; it is not silently repaired
 * here, because the alternative — keeping a slot alive for other instances
 * while this one feeds it internally — would mean the same input driven from
 * two places.
 */
export function moveNodesIntoSubgraph(
  workflow: Workflow,
  scopeSubgraphId: string | null,
  placeholderNodeId: number,
  nodeIds: number[],
  groupIds: number[] = [],
): MoveIntoSubgraphResult | null {
  const defs = workflow.definitions?.subgraphs ?? [];
  const scopeDef = scopeSubgraphId ? defs.find((sg) => sg.id === scopeSubgraphId) : null;
  if (scopeSubgraphId && !scopeDef) return null;

  const scopeNodes: WorkflowNode[] = scopeSubgraphId ? (scopeDef!.nodes ?? []) : (workflow.nodes ?? []);
  const scopeLinks: ScopeLink[] = scopeSubgraphId ? (scopeDef!.links ?? []) : (workflow.links ?? []);
  const scopeGroups: WorkflowGroup[] = scopeSubgraphId ? (scopeDef!.groups ?? []) : (workflow.groups ?? []);

  const placeholder = scopeNodes.find((node) => node.id === placeholderNodeId);
  const target = placeholder ? defs.find((sg) => sg.id === placeholder.type) : null;
  if (!placeholder || !target) return null;

  const movingIds = new Set(nodeIds.filter((id) => id !== placeholderNodeId));
  const moving = scopeNodes.filter((node) => movingIds.has(node.id));
  const movingGroupIds = new Set(groupIds);
  const movingGroups = scopeGroups.filter((group) => movingGroupIds.has(group.id));
  if (moving.length === 0 && movingGroups.length === 0) return null;

  // Group ids only need to be unique inside one graph scope. Re-id the boxes
  // as they enter the definition; geometric containment preserves nested group
  // relationships and membership without a separate parent-id rewrite.
  let nextInnerGroupId = Math.max(0, ...(target.groups ?? []).map((group) => group.id)) + 1;
  const innerGroups = movingGroups.map((group) => ({
    ...structuredClone(group),
    id: nextInnerGroupId++,
    itemKey: undefined,
  }));

  // Fresh ids inside the definition: the moved nodes' ids are unique in the
  // parent scope, which says nothing about the definition they are joining.
  let nextInnerNodeId = maxNodeIdAcrossScopes(workflow) + 1;
  const innerIdByOuter = new Map<number, number>();
  for (const node of moving) innerIdByOuter.set(node.id, nextInnerNodeId++);

  const innerLinks: WorkflowSubgraphLink[] = (target.links ?? []).map((link) => ({ ...link }));
  let nextInnerLinkId = Math.max(0, ...innerLinks.map((link) => link.id)) + 1;

  /** Inner endpoints a boundary input slot feeds. */
  const inputTargets = new Map<number, Array<{ nodeId: number; slot: number; type: string }>>();
  /** The inner endpoint a boundary output slot is fed by. */
  const outputSources = new Map<number, { nodeId: number; slot: number; type: string }>();
  for (const link of innerLinks) {
    if (link.origin_id === SUBGRAPH_INPUT_NODE_ID) {
      const list = inputTargets.get(link.origin_slot) ?? [];
      list.push({ nodeId: link.target_id, slot: link.target_slot, type: link.type });
      inputTargets.set(link.origin_slot, list);
    } else if (link.target_id === SUBGRAPH_OUTPUT_NODE_ID) {
      outputSources.set(link.target_slot, {
        nodeId: link.origin_id,
        slot: link.origin_slot,
        type: link.type,
      });
    }
  }

  const droppedInputSlots = new Set<number>();
  const droppedOutputSlots = new Set<number>();
  const consumedParentLinks = new Set<number>();
  const addedInner: WorkflowSubgraphLink[] = [];

  for (const link of scopeLinks) {
    const originId = getLinkOriginId(link);
    const targetId = getLinkTargetId(link);
    const originMoving = movingIds.has(originId);
    const targetMoving = movingIds.has(targetId);

    if (originMoving && targetMoving) {
      // Travels in unchanged, on the definition's own id space.
      consumedParentLinks.add(getLinkId(link));
      addedInner.push({
        id: nextInnerLinkId++,
        origin_id: innerIdByOuter.get(originId)!,
        origin_slot: getLinkOriginSlot(link),
        target_id: innerIdByOuter.get(targetId)!,
        target_slot: getLinkTargetSlot(link),
        type: getLinkType(link),
      });
      continue;
    }

    // A moved node feeding the placeholder: the slot it fed through is now
    // redundant, and the inner nodes it reached are wired to it directly.
    if (originMoving && targetId === placeholderNodeId) {
      const slotIndex = getLinkTargetSlot(link);
      consumedParentLinks.add(getLinkId(link));
      droppedInputSlots.add(slotIndex);
      for (const inner of inputTargets.get(slotIndex) ?? []) {
        addedInner.push({
          id: nextInnerLinkId++,
          origin_id: innerIdByOuter.get(originId)!,
          origin_slot: getLinkOriginSlot(link),
          target_id: inner.nodeId,
          target_slot: inner.slot,
          type: inner.type,
        });
      }
      continue;
    }

    // A moved node fed BY the placeholder: same in reverse.
    if (targetMoving && originId === placeholderNodeId) {
      const slotIndex = getLinkOriginSlot(link);
      consumedParentLinks.add(getLinkId(link));
      const source = outputSources.get(slotIndex);
      if (source) {
        addedInner.push({
          id: nextInnerLinkId++,
          origin_id: source.nodeId,
          origin_slot: source.slot,
          target_id: innerIdByOuter.get(targetId)!,
          target_slot: getLinkTargetSlot(link),
          type: source.type,
        });
      }
      continue;
    }
  }

  // An output slot survives only while something outside still consumes it.
  (placeholder.outputs ?? []).forEach((output, slotIndex) => {
    const remaining = (output.links ?? []).filter((id) => !consumedParentLinks.has(id));
    if ((output.links ?? []).length > 0 && remaining.length === 0) {
      droppedOutputSlots.add(slotIndex);
    }
  });

  const keptInputs = (target.inputs ?? []).filter((_slot, index) => !droppedInputSlots.has(index));
  const keptOutputs = (target.outputs ?? []).filter((_slot, index) => !droppedOutputSlots.has(index));
  const inputSlotRemap = remapSurvivors((target.inputs ?? []).length, droppedInputSlots);
  const outputSlotRemap = remapSurvivors((target.outputs ?? []).length, droppedOutputSlots);

  // Links the moved nodes still have to nodes left outside become new slots,
  // deduped the same way creating a subgraph dedupes them.
  const newInputs: NonNullable<WorkflowSubgraphDefinition['inputs']> = [];
  const newOutputs: NonNullable<WorkflowSubgraphDefinition['outputs']> = [];
  const rewiredParent: ScopeLink[] = [];
  const inputSlotBySource = new Map<string, number>();
  const outputSlotByInner = new Map<string, number>();
  // Seeded with the slots that survive, so an added slot never collides with
  // one already on the boundary either.
  const takenInputNames = new Set(keptInputs.map((slot) => slot.name ?? ''));
  const takenOutputNames = new Set(keptOutputs.map((slot) => slot.name ?? ''));

  for (const link of scopeLinks) {
    const id = getLinkId(link);
    if (consumedParentLinks.has(id)) continue;
    const originId = getLinkOriginId(link);
    const targetId = getLinkTargetId(link);
    const originMoving = movingIds.has(originId);
    const targetMoving = movingIds.has(targetId);

    if (!originMoving && !targetMoving) {
      // Untouched, except that surviving boundary slots may have shifted.
      const reslotted = reslotPlaceholderLink(link, placeholderNodeId, inputSlotRemap, outputSlotRemap, scopeSubgraphId);
      // null means the slot it fed is gone. Keeping the link would leave it
      // pointing at whatever index shifted into place — a connection silently
      // moved to a different input rather than removed.
      if (reslotted) rewiredParent.push(reslotted);
      continue;
    }

    if (targetMoving) {
      const key = `${originId}:${getLinkOriginSlot(link)}`;
      let slotIndex = inputSlotBySource.get(key);
      if (slotIndex === undefined) {
        slotIndex = keptInputs.length + newInputs.length;
        inputSlotBySource.set(key, slotIndex);
        const inner = moving.find((node) => node.id === targetId);
        newInputs.push({
          id: newBoundarySlotId(),
          name: uniqueBoundaryName(
            takenInputNames,
            inner?.inputs?.[getLinkTargetSlot(link)]?.name || getLinkType(link).toLowerCase(),
          ),
          type: getLinkType(link),
          linkIds: [],
        });
        rewiredParent.push(
          makeScopeLink(id, originId, getLinkOriginSlot(link), placeholderNodeId, slotIndex, getLinkType(link), scopeSubgraphId),
        );
      }
      addedInner.push({
        id: nextInnerLinkId++,
        origin_id: SUBGRAPH_INPUT_NODE_ID,
        origin_slot: slotIndex,
        target_id: innerIdByOuter.get(targetId)!,
        target_slot: getLinkTargetSlot(link),
        type: getLinkType(link),
      });
      continue;
    }

    // originMoving: the moved node feeds something still outside.
    const key = `${originId}:${getLinkOriginSlot(link)}`;
    let slotIndex = outputSlotByInner.get(key);
    if (slotIndex === undefined) {
      slotIndex = keptOutputs.length + newOutputs.length;
      outputSlotByInner.set(key, slotIndex);
      const inner = moving.find((node) => node.id === originId);
      newOutputs.push({
        id: newBoundarySlotId(),
        name: uniqueBoundaryName(
          takenOutputNames,
          inner?.outputs?.[getLinkOriginSlot(link)]?.name || getLinkType(link).toLowerCase(),
        ),
        type: getLinkType(link),
        linkIds: [],
      });
      addedInner.push({
        id: nextInnerLinkId++,
        origin_id: innerIdByOuter.get(originId)!,
        origin_slot: getLinkOriginSlot(link),
        target_id: SUBGRAPH_OUTPUT_NODE_ID,
        target_slot: slotIndex,
        type: getLinkType(link),
      });
    }
    rewiredParent.push(
      makeScopeLink(id, placeholderNodeId, slotIndex, targetId, getLinkTargetSlot(link), getLinkType(link), scopeSubgraphId),
    );
  }

  // Surviving boundary links move onto their slots' new indices, and the ones
  // whose slot went are dropped.
  // Only the links that were already inside get remapped: their slot indices
  // are the boundary's OLD ones, and a slot that went away takes its link with
  // it. The links added above are written against the new boundary already —
  // running them through the same remap dropped every one whose index no
  // longer named an old slot, which is what left a moved node's inputs wired
  // to a boundary link that did not exist.
  const survivingInner = [
    ...innerLinks.flatMap((link) => {
      if (link.origin_id === SUBGRAPH_INPUT_NODE_ID) {
        const next = inputSlotRemap.get(link.origin_slot);
        if (next === undefined) return [];
        return [{ ...link, origin_slot: next }];
      }
      if (link.target_id === SUBGRAPH_OUTPUT_NODE_ID) {
        const next = outputSlotRemap.get(link.target_slot);
        if (next === undefined) return [];
        return [{ ...link, target_slot: next }];
      }
      return [link];
    }),
    ...addedInner,
  ];

  const definition: WorkflowSubgraphDefinition = {
    ...target,
    inputs: [...keptInputs, ...newInputs],
    outputs: [...keptOutputs, ...newOutputs],
    // Every node, not only the ones that moved: a node already inside can have
    // its feed replaced too — the slot a moved node used to reach it through is
    // gone, and it is wired to that node directly now, on a new link id.
    nodes: [
      ...(target.nodes ?? []),
      ...moving.map((node) => ({
        ...structuredClone(node),
        id: innerIdByOuter.get(node.id)!,
        itemKey: undefined,
      })),
    ].map((node) => reseatLinkCaches(node, survivingInner)),
    links: survivingInner,
    groups: [...(target.groups ?? []), ...innerGroups],
  };
  rebuildSlotLinkIds(definition);

  const editedPlaceholder = seatEditedPlaceholderOnBoundary(
    placeholder,
    definition,
    rewiredParent,
    inputSlotRemap,
    outputSlotRemap,
  );
  const survivingParentNodes = scopeNodes
    .filter((node) => !movingIds.has(node.id))
    .map((node) => (node.id === placeholderNodeId ? editedPlaceholder : node));
  const survivingParentGroups = scopeGroups.filter((group) => !movingGroupIds.has(group.id));

  let next: Workflow = scopeSubgraphId
    ? {
        ...workflow,
        definitions: {
          ...(workflow.definitions ?? {}),
          subgraphs: defs.map((sg) =>
            sg.id === definition.id
              ? definition
              : sg.id === scopeSubgraphId
                ? {
                    ...sg,
                    nodes: survivingParentNodes,
                    links: rewiredParent as WorkflowSubgraphLink[],
                    groups: survivingParentGroups,
                  }
                : sg,
          ),
        },
      }
    : {
        ...workflow,
        nodes: survivingParentNodes,
        links: rewiredParent as WorkflowLink[],
        groups: survivingParentGroups,
        definitions: {
          ...(workflow.definitions ?? {}),
          subgraphs: defs.map((sg) => (sg.id === definition.id ? definition : sg)),
        },
      };

  // The edited instance already carries the NEW slot order, so normalization
  // treats its freshly rewired links as new-boundary indices. Other instances
  // still carry the OLD slot order and are remapped exactly once. Rewriting all
  // parent links first and then normalizing used to double-remap shared
  // instances, while a remove+add at the same index made the edited instance's
  // new input look like a link to the removed old slot and dropped it.
  next = normalizeSubgraphPlaceholders(next);

  // Instance widgets_values are NOT touched here: a placeholder carrying a
  // proxyWidgets list does not index its values by boundary-widget position,
  // so positional splicing deletes a neighbour's value. The store caller ends
  // the edit in reconcileInstanceWidgetValues, which carries values by name
  // and drops what the boundary no longer has.
  return {
    workflow: next,
    removedInputs: droppedInputSlots.size,
    removedOutputs: droppedOutputSlots.size,
    addedInputs: newInputs.length,
    addedOutputs: newOutputs.length,
    movedInnerNodeIds: moving.map((node) => innerIdByOuter.get(node.id)!),
  };
}

/**
 * Put the destination placeholder on its definition's new boundary before the
 * workflow-wide normalization pass.
 *
 * Surviving slots keep their instance-local metadata, while new slots start
 * from the boundary schema. Link caches are rebuilt from the already-rewired
 * parent link table. This lets normalization distinguish links written against
 * the new boundary from links on every other instance, which are still written
 * against the old one.
 */
function seatEditedPlaceholderOnBoundary(
  placeholder: WorkflowNode,
  definition: WorkflowSubgraphDefinition,
  parentLinks: ScopeLink[],
  inputSlotRemap: Map<number, number>,
  outputSlotRemap: Map<number, number>,
): WorkflowNode {
  const oldInputByNew = reverseSlotRemap(inputSlotRemap);
  const oldOutputByNew = reverseSlotRemap(outputSlotRemap);
  const inputs = (definition.inputs ?? []).map((boundary, slotIndex) => {
    const oldSlot = oldInputByNew.get(slotIndex);
    const carried = oldSlot === undefined ? undefined : placeholder.inputs?.[oldSlot];
    const link = parentLinks.find((candidate) => (
      getLinkTargetId(candidate) === placeholder.id
      && getLinkTargetSlot(candidate) === slotIndex
    ));
    return {
      ...(carried ?? {}),
      name: boundary.name ?? carried?.name ?? `input_${slotIndex}`,
      type: String(boundary.type ?? carried?.type ?? '*'),
      link: link ? getLinkId(link) : null,
    };
  });
  const outputs = (definition.outputs ?? []).map((boundary, slotIndex) => {
    const oldSlot = oldOutputByNew.get(slotIndex);
    const carried = oldSlot === undefined ? undefined : placeholder.outputs?.[oldSlot];
    const links = parentLinks
      .filter((candidate) => (
        getLinkOriginId(candidate) === placeholder.id
        && getLinkOriginSlot(candidate) === slotIndex
      ))
      .map(getLinkId);
    return {
      ...(carried ?? {}),
      name: boundary.name ?? carried?.name ?? `output_${slotIndex}`,
      type: String(boundary.type ?? carried?.type ?? '*'),
      links: links.length > 0 ? links : null,
    };
  });
  return { ...placeholder, inputs, outputs };
}

function reverseSlotRemap(remap: Map<number, number>): Map<number, number> {
  return new Map([...remap].map(([oldSlot, newSlot]) => [newSlot, oldSlot]));
}

/** old slot index → new index, or absent when the slot was removed. */
function remapSurvivors(total: number, dropped: Set<number>): Map<number, number> {
  const map = new Map<number, number>();
  let next = 0;
  for (let index = 0; index < total; index += 1) {
    if (dropped.has(index)) continue;
    map.set(index, next++);
  }
  return map;
}

/**
 * Move a parent link onto the placeholder's shifted slot indices.
 *
 * Returns null when the slot it used is gone: the connection is lost, which is
 * the honest outcome of removing the slot that carried it. Leaving the link on
 * its old index instead pointed it at whatever slot shifted into that place —
 * a seed arriving on `structural_repulsion_boost` rather than disappearing.
 */
function reslotPlaceholderLink(
  link: ScopeLink,
  placeholderNodeId: number,
  inputSlotRemap: Map<number, number>,
  outputSlotRemap: Map<number, number>,
  scopeSubgraphId: string | null,
): ScopeLink | null {
  const originId = getLinkOriginId(link);
  const targetId = getLinkTargetId(link);
  if (targetId === placeholderNodeId) {
    const next = inputSlotRemap.get(getLinkTargetSlot(link));
    if (next === undefined) return null;
    if (next === getLinkTargetSlot(link)) return link;
    return makeScopeLink(getLinkId(link), originId, getLinkOriginSlot(link), targetId, next, getLinkType(link), scopeSubgraphId);
  }
  if (originId === placeholderNodeId) {
    const next = outputSlotRemap.get(getLinkOriginSlot(link));
    if (next === undefined) return null;
    if (next === getLinkOriginSlot(link)) return link;
    return makeScopeLink(getLinkId(link), originId, next, targetId, getLinkTargetSlot(link), getLinkType(link), scopeSubgraphId);
  }
  return link;
}

/** Point each boundary slot's derived cache at the links it actually has. */
function rebuildSlotLinkIds(definition: WorkflowSubgraphDefinition): void {
  definition.inputs = (definition.inputs ?? []).map((slot, index) => ({
    ...slot,
    linkIds: definition.links
      .filter((link) => link.origin_id === SUBGRAPH_INPUT_NODE_ID && link.origin_slot === index)
      .map((link) => link.id),
  }));
  definition.outputs = (definition.outputs ?? []).map((slot, index) => ({
    ...slot,
    linkIds: definition.links
      .filter((link) => link.target_id === SUBGRAPH_OUTPUT_NODE_ID && link.target_slot === index)
      .map((link) => link.id),
  }));
}

/**
 * Point a moved node's slot caches at the links it has on this side.
 *
 * `inputs[i].link` and `outputs[j].links` cache link ids, and this move re-mints
 * them: a node travelling in arrives still citing the ids it had in the graph
 * above, and a node already inside can have its feed replaced by a new link
 * when the boundary slot it was fed through goes away. Either way the slot
 * reads as connected to a link that does not exist — a wired-looking input
 * with nothing behind it.
 */
function reseatLinkCaches(node: WorkflowNode, links: WorkflowSubgraphLink[]): WorkflowNode {
  return {
    ...node,
    inputs: (node.inputs ?? []).map((input, index) => ({
      ...input,
      link: links.find((l) => l.target_id === node.id && l.target_slot === index)?.id ?? null,
    })),
    outputs: (node.outputs ?? []).map((output, index) => ({
      ...output,
      links: (() => {
        const found = links
          .filter((l) => l.origin_id === node.id && l.origin_slot === index)
          .map((l) => l.id);
        // An unconnected output keeps whichever empty shape it arrived with.
        return found.length > 0 ? found : Array.isArray(output.links) ? [] : null;
      })(),
    })),
  };
}
