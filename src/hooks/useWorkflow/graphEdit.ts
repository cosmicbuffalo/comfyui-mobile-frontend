import type {Workflow, WorkflowGroup, WorkflowInput, WorkflowLink, WorkflowNode, WorkflowSubgraphLink} from "@/api/types";
import {runUndoTransaction} from "@/utils/undoTransaction";
import {useConnectionSectionFoldsStore} from "@/hooks/useConnectionSectionFolds";
import {useParameterSectionFoldsStore} from "@/hooks/useParameterSectionFolds";
import {useWorkflowClipboardStore, type WorkflowClipboardPayload} from "@/hooks/useWorkflowClipboard";
import {applyClipboardPaste, buildGroupClipboardPayload, buildNodeClipboardPayload, buildMultiNodeClipboardPayload, placePastedNodesIntoGroup} from "@/utils/workflowClipboard";
import {isComboType, buildDefaultConnectionInputs, buildDefaultWidgetValues} from "@/utils/workflowInputs";
import {collectAllWorkflowGroups} from "@/utils/workflowNodes";
import {nodeTypeStripsSeedControl} from "@/utils/seedUtils";
import {areTypesCompatible} from "@/utils/connectionUtils";
import {type ItemRef, type MobileLayout, type ContainerId, makeLocationPointer, findItemInLayout, removeNodeFromLayout, addNodeToLayout, placeLayoutItemAfter, placeLayoutItemBefore} from "@/utils/mobileLayout";
import {clampPositionToGroup, getBottomPlacement, getBottomPlacementForScope, getPositionNearNode} from "@/utils/nodePositioning";
import {resolveCurrentScope, resolveScopeForHierarchicalKey, resolveNodeByHierarchicalKey, getLinkId, getLinkOriginId, getLinkOriginSlot, getLinkTargetId, getLinkTargetSlot, getLinkType, makeScopeLink, maxNodeIdAcrossScopes} from "@/utils/canonicalWorkflowOps";
import {collapseSetGetNodes as collapseSetGetNodesPure} from "@/utils/collapseSetGetNodes";
import {duplicateWorkflowNode} from "@/utils/duplicateNode";
import {type HierarchicalKey, annotateWorkflowWithHierarchicalKeys, buildScopeStackForSubgraphTrail, collectBypassGroupTargetNodes, collectNodeHierarchicalKeys, collectNodeStateKeys, layoutRecordFromPointerRecord, reconcilePointerRegistry, resolveContainerIdentityFromHierarchicalKey, resolveNodeIdentityFromHierarchicalKey} from "@/utils/workflowHierarchy";
import {themeColors} from "@/theme/colors";
import {buildLayoutForWorkflow} from "./layoutOps";
import type {WorkflowGet, WorkflowSet, WorkflowState} from "./state";

let editContainerLabelRequestId = 0;

export function createGraphEditActions(set: WorkflowSet, get: WorkflowGet) {

const deleteNode: WorkflowState["deleteNode"] = (
  itemKey,
  reconnect,
) => {
  const {
    workflow,
    hiddenItems,
    connectionHighlightModes,
    mobileLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  } = get();
  if (!workflow) return;

  const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
  const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
  if (!node) return;
  const nodeId = node.id;
  const subgraphId = scope.subgraphId;

  const currentLinks = scope.links;

  const linksToRemove = new Set<number>();
  const incomingLinks = currentLinks.filter((link) => {
    const isIncoming = getLinkTargetId(link) === nodeId;
    if (isIncoming) linksToRemove.add(getLinkId(link));
    return isIncoming;
  });
  const outgoingLinks = currentLinks.filter((link) => {
    const isOutgoing = getLinkOriginId(link) === nodeId;
    if (isOutgoing) linksToRemove.add(getLinkId(link));
    return isOutgoing;
  });

  let nextLastLinkId = scope.linkIdBase;
  const bridgeInputLinks = new Map<string, number>();
  const bridgeOutputLinks = new Map<string, number[]>();
  const bridgeLinks: (import('@/api/types').WorkflowLink | import('@/api/types').WorkflowSubgraphLink)[] = [];

  if (reconnect) {
    for (const outLink of outgoingLinks) {
      const outTargetNodeId = getLinkTargetId(outLink);
      const outTargetSlot = getLinkTargetSlot(outLink);
      const outType = getLinkType(outLink);
      const sourceLink = incomingLinks.find((inLink) =>
        areTypesCompatible(getLinkType(inLink), outType),
      );
      if (!sourceLink) continue;

      const inSourceNodeId = getLinkOriginId(sourceLink);
      const inSourceSlot = getLinkOriginSlot(sourceLink);
      nextLastLinkId += 1;
      const bridgeLink = makeScopeLink(
        nextLastLinkId,
        inSourceNodeId,
        inSourceSlot,
        outTargetNodeId,
        outTargetSlot,
        outType,
        subgraphId,
      );
      bridgeLinks.push(bridgeLink);

      const targetKey = `${outTargetNodeId}:${outTargetSlot}`;
      bridgeInputLinks.set(targetKey, nextLastLinkId);

      const sourceKey = `${inSourceNodeId}:${inSourceSlot}`;
      const existing = bridgeOutputLinks.get(sourceKey) ?? [];
      existing.push(nextLastLinkId);
      bridgeOutputLinks.set(sourceKey, existing);
    }
  }

  const newLinks = [
    ...currentLinks.filter((link) => !linksToRemove.has(getLinkId(link))),
    ...bridgeLinks,
  ];

  const newNodes = scope.nodes
    .filter((n) => n.id !== nodeId)
    .map((n) => {
      const nextInputs = n.inputs.map((input, index) => {
        const key = `${n.id}:${index}`;
        const bridgeInputLinkId = bridgeInputLinks.get(key);
        if (bridgeInputLinkId != null) {
          return { ...input, link: bridgeInputLinkId };
        }
        if (input.link != null && linksToRemove.has(input.link)) {
          return { ...input, link: null };
        }
        return input;
      });

      const nextOutputs = n.outputs.map((output, index) => {
        const existingLinks = output.links ?? [];
        const retainedLinks = existingLinks.filter(
          (linkId) => !linksToRemove.has(linkId),
        );
        const sourceKey = `${n.id}:${index}`;
        const appendedLinks = bridgeOutputLinks.get(sourceKey) ?? [];
        const mergedLinks = [...retainedLinks, ...appendedLinks];
        return {
          ...output,
          links: mergedLinks.length > 0 ? mergedLinks : null,
        };
      });

      return { ...n, inputs: nextInputs, outputs: nextOutputs };
    });

  // Clean up UI state
  const nextHiddenNodes = { ...hiddenItems };
  const nodeHierarchicalKeys = collectNodeHierarchicalKeys(
    workflow,
    itemKeyByPointer,
    nodeId,
    subgraphId,
  );
  for (const itemKey of nodeHierarchicalKeys) {
    delete nextHiddenNodes[itemKey];
  }
  for (const legacyPointer of collectNodeStateKeys(
    workflow,
    nodeId,
    subgraphId,
  )) {
    delete nextHiddenNodes[legacyPointer];
  }

  const nextHighlightModes = { ...connectionHighlightModes };
  for (const itemKey of nodeHierarchicalKeys) {
    delete nextHighlightModes[itemKey];
  }

  // Clean up mobile layout
  const nextMobileLayout = removeNodeFromLayout(
    mobileLayout,
    nodeId,
    subgraphId,
  );
  const reconciled = reconcilePointerRegistry(
    nextMobileLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  );
  const patchedWorkflow = scope.applyPatch(workflow, {
    nodes: newNodes,
    links: scope.subgraphId == null
      ? (newLinks as WorkflowLink[])
      : (newLinks as WorkflowSubgraphLink[]),
    last_link_id: nextLastLinkId,
  });
  const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
    patchedWorkflow,
    reconciled.layoutToStable,
  );

  set({
    workflow: nextWorkflowWithHierarchicalKeys,
    hiddenItems: nextHiddenNodes,
    connectionHighlightModes: nextHighlightModes,
    mobileLayout: nextMobileLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
  });
};

const collapseSetGetNodes: WorkflowState["collapseSetGetNodes"] = () => {
  const {
    workflow,
    mobileLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
    hiddenItems,
    connectionHighlightModes,
  } = get();
  if (!workflow) return;

  const { workflow: collapsed, removed } = collapseSetGetNodesPure(workflow);
  if (removed.length === 0) return;

  // Prune each removed relay from the layout and any per-node UI state,
  // mirroring deleteNode's cleanup so nothing dangles to a gone node.
  let nextMobileLayout = mobileLayout;
  const nextHiddenNodes = { ...hiddenItems };
  const nextHighlightModes = { ...connectionHighlightModes };
  for (const { nodeId, subgraphId } of removed) {
    for (const itemKey of collectNodeHierarchicalKeys(
      workflow,
      itemKeyByPointer,
      nodeId,
      subgraphId,
    )) {
      delete nextHiddenNodes[itemKey];
      delete nextHighlightModes[itemKey];
    }
    nextMobileLayout = removeNodeFromLayout(nextMobileLayout, nodeId, subgraphId);
  }

  const reconciled = reconcilePointerRegistry(
    nextMobileLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  );
  const annotated = annotateWorkflowWithHierarchicalKeys(
    collapsed,
    reconciled.layoutToStable,
  );

  set({
    workflow: annotated,
    hiddenItems: nextHiddenNodes,
    connectionHighlightModes: nextHighlightModes,
    mobileLayout: nextMobileLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
  });
};

const connectNodes: WorkflowState["connectNodes"] = (
  srcHierarchicalKey,
  srcSlot,
  tgtHierarchicalKey,
  tgtSlot,
  type,
) => {
  const { workflow } = get();
  if (!workflow) return;
  // Both endpoints must live in the source key's scope.
  const scope = resolveScopeForHierarchicalKey(workflow, srcHierarchicalKey);

  const srcNode = resolveNodeByHierarchicalKey(scope.nodes, srcHierarchicalKey);
  const tgtNode = resolveNodeByHierarchicalKey(scope.nodes, tgtHierarchicalKey);
  if (!srcNode || !tgtNode) return;
  const srcNodeId = srcNode.id;
  const tgtNodeId = tgtNode.id;

  let newLinks = [...scope.links];
  let nextLastLinkId = scope.linkIdBase;

  // If target input already has a link, remove it first
  const existingLinkId = tgtNode.inputs[tgtSlot]?.link;
  if (existingLinkId != null) {
    newLinks = newLinks.filter((l) => getLinkId(l) !== existingLinkId);
  }

  nextLastLinkId++;
  const newLinkId = nextLastLinkId;
  const newLink = makeScopeLink(newLinkId, srcNodeId, srcSlot, tgtNodeId, tgtSlot, type, scope.subgraphId);
  newLinks.push(newLink);

  const newNodes = scope.nodes.map((n) => {
    if (n.id === tgtNodeId) {
      const newInputs = [...n.inputs];
      newInputs[tgtSlot] = { ...newInputs[tgtSlot], link: newLinkId };
      return { ...n, inputs: newInputs };
    }
    if (n.id === srcNodeId) {
      const newOutputs = [...n.outputs];
      const existingLinks = newOutputs[srcSlot]?.links ?? [];
      const cleanedLinks = existingLinks.filter(
        (id) => id !== existingLinkId,
      );
      const withNewLink = [...cleanedLinks, newLinkId];
      newOutputs[srcSlot] = {
        ...newOutputs[srcSlot],
        links: withNewLink,
      };
      return { ...n, outputs: newOutputs };
    }
    if (existingLinkId != null && n.id !== srcNodeId) {
      const hadLink = n.outputs.some((o) =>
        o.links?.includes(existingLinkId),
      );
      if (hadLink) {
        const newOutputs = n.outputs.map((o) => {
          if (o.links?.includes(existingLinkId)) {
            const filtered = o.links.filter(
              (id) => id !== existingLinkId,
            );
            return {
              ...o,
              links: filtered.length > 0 ? filtered : null,
            };
          }
          return o;
        });
        return { ...n, outputs: newOutputs };
      }
    }
    return n;
  });

  const nextWorkflow = scope.applyPatch(workflow, {
    nodes: newNodes,
    links: scope.subgraphId == null
      ? (newLinks as WorkflowLink[])
      : (newLinks as WorkflowSubgraphLink[]),
    last_link_id: nextLastLinkId,
  });
  set({
    workflow: nextWorkflow,
  });
};

const disconnectInput: WorkflowState["disconnectInput"] = (
  itemKey,
  inputIndex,
) => {
  const { workflow } = get();
  if (!workflow) return;
  const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
  const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
  if (!node) return;
  const nodeId = node.id;

  const linkId = node.inputs[inputIndex]?.link;
  if (linkId == null) return;

  const newLinks = scope.links.filter((l) => getLinkId(l) !== linkId);
  const newNodes = scope.nodes.map((n) => {
    if (n.id === nodeId) {
      const newInputs = [...n.inputs];
      newInputs[inputIndex] = { ...newInputs[inputIndex], link: null };
      return { ...n, inputs: newInputs };
    }
    // Clean up source node's output links
    const hadLink = n.outputs.some((o) => o.links?.includes(linkId));
    if (hadLink) {
      const newOutputs = n.outputs.map((o) => {
        if (o.links?.includes(linkId)) {
          const filtered = o.links.filter((id) => id !== linkId);
          return { ...o, links: filtered.length > 0 ? filtered : null };
        }
        return o;
      });
      return { ...n, outputs: newOutputs };
    }
    return n;
  });

  const nextWorkflow = scope.applyPatch(workflow, {
    nodes: newNodes,
    links: scope.subgraphId == null
      ? (newLinks as WorkflowLink[])
      : (newLinks as WorkflowSubgraphLink[]),
  });
  set({
    workflow: nextWorkflow,
  });
};

const addNode: WorkflowState["addNode"] = (nodeType, options) => {
  const { workflow, nodeTypes, mobileLayout } = get();
  if (!workflow || !nodeTypes) return null;

  const typeDef = nodeTypes[nodeType];
  if (!typeDef) return null;

  const newId = maxNodeIdAcrossScopes(workflow) + 1;

  // Build inputs from type definition
  const inputs: WorkflowInput[] = [];
  // Include connection inputs from the active default DynamicCombo branch
  // as well as top-level sockets. Explicit socketless/forceInput flags are
  // handled by the shared schema classifier.
  inputs.push(
    ...buildDefaultConnectionInputs(typeDef).map((input) => ({
      ...input,
      link: null,
    })),
  );

  // Build outputs from type definition
  const outputs = (typeDef.output ?? []).map((type, i) => ({
    name: typeDef.output_name?.[i] ?? type,
    type,
    links: null as number[] | null,
    slot_index: i,
  }));

  // Build default widget values in slot order, including the sub-inputs a
  // DynamicCombo's default option contributes and any schema-declared
  // control_after_generate slot that follows an INT seed.
  const widgetsValues = buildDefaultWidgetValues(typeDef, {
    emitSeedControl: !nodeTypeStripsSeedControl(nodeType),
  });

  // Resolve the canonical scope where this node belongs.
  // If inSubgraphId is specified explicitly, use that subgraph's node list;
  // otherwise use the root node list.
  const targetSgId = options?.inSubgraphId ?? null;
  const targetSg = targetSgId
    ? (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === targetSgId)
    : null;
  if (targetSgId && !targetSg) return null; // Unknown subgraph ID
  const scopedNodes: WorkflowNode[] = targetSg ? (targetSg.nodes ?? []) : workflow.nodes;

  // Build a scoped workflow view for position helpers that search workflow.nodes.
  const positionWorkflow = targetSg
    ? { ...workflow, nodes: scopedNodes }
    : workflow;

  // Position near target node or at the bottom of the appropriate scope
  let pos: [number, number] = [0, 0];
  if (options?.nearNodeHierarchicalKey) {
    const nearIdentity = resolveNodeIdentityFromHierarchicalKey(
      positionWorkflow,
      options.nearNodeHierarchicalKey,
      get().pointerByHierarchicalKey,
    );
    if (nearIdentity) {
      pos = getPositionNearNode(positionWorkflow, nearIdentity.nodeId) ?? pos;
    }
  } else if (scopedNodes.length > 0) {
    const maxBottom = Math.max(
      ...scopedNodes.map((n) => n.pos[1] + (n.size?.[1] ?? 100)),
    );
    const minX = Math.min(...scopedNodes.map((n) => n.pos[0]));
    pos = [minX, maxBottom + 80];
  } else {
    pos = getBottomPlacementForScope(workflow, {
      subgraphId: targetSgId,
    });
  }

  if (options?.inGroupId != null) {
    const groups = collectAllWorkflowGroups(workflow);
    const group = groups.find((g) => g.id === options.inGroupId);
    if (group) {
      pos = clampPositionToGroup(pos, group, [200, 100]);
    }
  }

  const newNode: WorkflowNode = {
    id: newId,
    type: nodeType,
    pos,
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs,
    outputs,
    properties: {},
    widgets_values: widgetsValues,
  };

  // Insert the new node into the correct canonical scope.
  let nextWorkflow: Workflow;
  if (targetSg && targetSgId) {
    const updatedSg = { ...targetSg, nodes: [...scopedNodes, newNode] };
    nextWorkflow = {
      ...workflow,
      last_node_id: newId,
      definitions: {
        ...(workflow.definitions ?? {}),
        subgraphs: (workflow.definitions?.subgraphs ?? []).map((sg) =>
          sg.id === targetSgId ? updatedSg : sg,
        ),
      },
    };
  } else {
    nextWorkflow = {
      ...workflow,
      nodes: [...workflow.nodes, newNode],
      last_node_id: newId,
    };
  }

  const nextMobileLayout = addNodeToLayout(mobileLayout, newId, {
    groupId: options?.inGroupId ?? undefined,
    subgraphId: options?.inSubgraphId ?? undefined,
  });
  const { itemKeyByPointer, pointerByHierarchicalKey } = get();
  const reconciled = reconcilePointerRegistry(
    nextMobileLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  );
  const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
    nextWorkflow,
    reconciled.layoutToStable,
  );

  set({
    workflow: nextWorkflowWithHierarchicalKeys,
    mobileLayout: nextMobileLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
  });

  // A freshly added node starts with both sections unfolded.
  const createdPointer = makeLocationPointer({
    type: "node",
    nodeId: newId,
    subgraphId: options?.inSubgraphId ?? null,
  });
  const createdKey = reconciled.layoutToStable[createdPointer];
  if (createdKey) {
    useConnectionSectionFoldsStore.getState().expand(createdKey);
    useParameterSectionFoldsStore.getState().expand(createdKey);
  }

  return newId;
};

const duplicateNode: WorkflowState["duplicateNode"] = (itemKey) => {
  const { workflow, hiddenItems, itemKeyByPointer, pointerByHierarchicalKey } = get();
  if (!workflow) return null;

  const result = duplicateWorkflowNode(workflow, itemKey);
  if (!result) return null;

  // Rebuild the layout from the new workflow so a duplicated subgraph
  // placeholder is laid out as a subgraph item (not a plain node), then
  // move the copy to sit directly below the original in the list.
  const rebuiltLayout = buildLayoutForWorkflow(
    result.workflow,
    layoutRecordFromPointerRecord(hiddenItems, pointerByHierarchicalKey),
  );
  const nextLayout = placeLayoutItemAfter(
    rebuiltLayout,
    result.newNodeId,
    result.originalNodeId,
  );
  const reconciled = reconcilePointerRegistry(
    nextLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  );
  const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
    result.workflow,
    reconciled.layoutToStable,
  );

  set({
    workflow: nextWorkflowWithHierarchicalKeys,
    mobileLayout: nextLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
  });

  return result.newNodeId;
};

const pasteClipboard: WorkflowState["pasteClipboard"] = (belowNodeKey) => {
  const { workflow, scopeStack, hiddenItems, itemKeyByPointer, pointerByHierarchicalKey } = get();
  if (!workflow) return null;
  const payload = useWorkflowClipboardStore.getState().payload;
  if (!payload) return null;
  const currentFrame = scopeStack[scopeStack.length - 1];
  const targetSubgraphId = currentFrame?.type === "subgraph" ? currentFrame.id : null;

  const result = applyClipboardPaste(workflow, payload, targetSubgraphId);
  if (!result) return null;

  let nextLayout = buildLayoutForWorkflow(
    result.workflow,
    layoutRecordFromPointerRecord(hiddenItems, pointerByHierarchicalKey),
  );
  // Place the pasted nodes directly below the anchor (in order) when
  // pasting "below" a specific node.
  if (belowNodeKey) {
    const anchor = resolveNodeIdentityFromHierarchicalKey(
      result.workflow,
      belowNodeKey,
      pointerByHierarchicalKey,
    );
    if (anchor) {
      let anchorId = anchor.nodeId;
      for (const newId of result.newNodeIds) {
        nextLayout = placeLayoutItemAfter(nextLayout, newId, anchorId);
        anchorId = newId;
      }
    }
  }

  const reconciled = reconcilePointerRegistry(
    nextLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  );
  set({
    workflow: annotateWorkflowWithHierarchicalKeys(result.workflow, reconciled.layoutToStable),
    mobileLayout: nextLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
  });
  return result.newNodeIds;
};

const copyContainer: WorkflowState["copyContainer"] = (itemKey) => {
  const { workflow, pointerByHierarchicalKey } = get();
  if (!workflow) return;
  const identity = resolveContainerIdentityFromHierarchicalKey(
    workflow,
    itemKey,
    pointerByHierarchicalKey,
  );
  if (!identity) return;

  let payload: WorkflowClipboardPayload | null = null;
  if (identity.type === "group") {
    const groups =
      identity.subgraphId == null
        ? workflow.groups ?? []
        : workflow.definitions?.subgraphs?.find((sg) => sg.id === identity.subgraphId)?.groups ?? [];
    const group = groups.find((g) => g.id === identity.groupId);
    if (!group) return;
    // Direct members in the group's own scope (placeholder nodes ride along;
    // their definitions are gathered by buildGroupClipboardPayload).
    const memberNodeIds = collectBypassGroupTargetNodes(
      workflow,
      identity.groupId,
      identity.subgraphId,
    )
      .filter((t) => t.subgraphId === identity.subgraphId)
      .map((t) => t.nodeId);
    payload = buildGroupClipboardPayload(workflow, group, identity.subgraphId, memberNodeIds);
  } else {
    // Copy the subgraph by copying its placeholder node (+ its definition).
    const placeholder = (workflow.nodes ?? []).find((n) => n.type === identity.subgraphId);
    if (placeholder?.itemKey) {
      payload = buildNodeClipboardPayload(workflow, placeholder.itemKey);
    }
  }
  if (payload) useWorkflowClipboardStore.getState().setPayload(payload);
};

const pasteIntoContainer: WorkflowState["pasteIntoContainer"] = (itemKey) => {
  const { workflow, hiddenItems, itemKeyByPointer, pointerByHierarchicalKey } = get();
  if (!workflow) return null;
  const payload = useWorkflowClipboardStore.getState().payload;
  if (!payload) return null;
  const identity = resolveContainerIdentityFromHierarchicalKey(
    workflow,
    itemKey,
    pointerByHierarchicalKey,
  );
  if (!identity) return null;

  // Subgraph container → paste into its inner scope (identity.subgraphId is
  // the subgraph's own id). Group container → paste into the group's own
  // scope, then pull the nodes into the group below.
  const result = applyClipboardPaste(workflow, payload, identity.subgraphId);
  if (!result) return null;
  let nextWorkflow = result.workflow;
  if (identity.type === "group") {
    nextWorkflow = placePastedNodesIntoGroup(
      nextWorkflow,
      identity.groupId,
      identity.subgraphId,
      result.newNodeIds,
    );
    // A payload carrying its own group had that box recreated by
    // applyClipboardPaste, but every pasted node just moved into the TARGET
    // group — so the recreated box is left behind empty. "Paste here" means
    // "into this group", not "make me a second group", so drop it.
    if (result.newGroupId != null) {
      const orphanGroupId = result.newGroupId;
      const dropOrphan = (groups: WorkflowGroup[] | undefined) =>
        (groups ?? []).filter((group) => group.id !== orphanGroupId);
      nextWorkflow = identity.subgraphId
        ? {
            ...nextWorkflow,
            definitions: {
              ...(nextWorkflow.definitions ?? {}),
              subgraphs: (nextWorkflow.definitions?.subgraphs ?? []).map((subgraph) =>
                subgraph.id === identity.subgraphId
                  ? { ...subgraph, groups: dropOrphan(subgraph.groups) }
                  : subgraph,
              ),
            },
          }
        : { ...nextWorkflow, groups: dropOrphan(nextWorkflow.groups) };
    }
  }

  const nextLayout = buildLayoutForWorkflow(
    nextWorkflow,
    layoutRecordFromPointerRecord(hiddenItems, pointerByHierarchicalKey),
  );
  const reconciled = reconcilePointerRegistry(
    nextLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  );
  set({
    workflow: annotateWorkflowWithHierarchicalKeys(nextWorkflow, reconciled.layoutToStable),
    mobileLayout: nextLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
  });
  return result.newNodeIds;
};

const addGroupNearNode: WorkflowState["addGroupNearNode"] = (
  nearNodeHierarchicalKey,
  scopeSubgraphId,
) => {
  const { workflow, mobileLayout, itemKeyByPointer, pointerByHierarchicalKey } =
    get();
  if (!workflow) return null;

  const nearIdentity = nearNodeHierarchicalKey
    ? resolveNodeIdentityFromHierarchicalKey(
        workflow,
        nearNodeHierarchicalKey,
        pointerByHierarchicalKey,
      )
    : null;
  // Scope by the near node when given, else the explicit scope (the
  // bottom-of-list add button passes the current subgraph), else root.
  const targetSubgraphId = nearIdentity?.subgraphId ?? scopeSubgraphId ?? null;
  const subgraphDefs = workflow.definitions?.subgraphs ?? [];
  const targetSubgraph = targetSubgraphId
    ? subgraphDefs.find((subgraph) => subgraph.id === targetSubgraphId)
    : null;
  const groupsInScope = targetSubgraphId
    ? (targetSubgraph?.groups ?? [])
    : (workflow.groups ?? []);
  const maxGroupId = groupsInScope.reduce(
    (maxId, group) => Math.max(maxId, group.id),
    0,
  );
  const newGroupId = maxGroupId + 1;
  const newGroupHierarchicalKey = makeLocationPointer({
    type: "group",
    groupId: newGroupId,
    subgraphId: targetSubgraphId,
  });

  const nearNode = nearIdentity
    ? (() => {
        if (nearIdentity.subgraphId == null) {
          return workflow.nodes.find((n) => n.id === nearIdentity.nodeId) ?? null;
        }
        const sg = subgraphDefs.find((s) => s.id === nearIdentity.subgraphId);
        return (sg?.nodes ?? []).find((n) => n.id === nearIdentity.nodeId) ?? null;
      })()
    : null;
  const basePos = nearNode
    ? [nearNode.pos[0] - 20, nearNode.pos[1] - 24]
    : (() => {
        if (targetSubgraphId != null && targetSubgraph) {
          return getBottomPlacementForScope(workflow, {
            subgraphId: targetSubgraph.id,
          });
        }
        return getBottomPlacement(workflow);
      })();

  const newGroup: WorkflowGroup = {
    id: newGroupId,
    itemKey: newGroupHierarchicalKey,
    title: "",
    bounding: [Math.round(basePos[0]), Math.round(basePos[1]), 320, 160],
    color: themeColors.brand.blue400,
    font_size: 24,
    flags: {},
  };

  let nextWorkflow: Workflow;
  if (targetSubgraphId) {
    const nextSubgraphs = subgraphDefs.map((subgraph) =>
      subgraph.id === targetSubgraphId
        ? { ...subgraph, groups: [...(subgraph.groups ?? []), newGroup] }
        : subgraph,
    );
    nextWorkflow = {
      ...workflow,
      definitions: {
        ...(workflow.definitions ?? {}),
        subgraphs: nextSubgraphs,
      },
    };
  } else {
    nextWorkflow = {
      ...workflow,
      groups: [...(workflow.groups ?? []), newGroup],
    };
  }

  const getContainerItems = (
    layout: MobileLayout,
    containerId: ContainerId,
  ): ItemRef[] => {
    if (containerId.scope === "root") return layout.root;
    if (containerId.scope === "group") {
      return layout.groups[containerId.groupKey] ?? [];
    }
    return layout.subgraphs[containerId.subgraphId] ?? [];
  };
  const setContainerItems = (
    layout: MobileLayout,
    containerId: ContainerId,
    items: ItemRef[],
  ): MobileLayout => {
    if (containerId.scope === "root") return { ...layout, root: items };
    if (containerId.scope === "group") {
      return {
        ...layout,
        groups: { ...layout.groups, [containerId.groupKey]: items },
      };
    }
    return {
      ...layout,
      subgraphs: { ...layout.subgraphs, [containerId.subgraphId]: items },
    };
  };

  let nextMobileLayout: MobileLayout = {
    ...mobileLayout,
    root: [...mobileLayout.root],
    groups: { ...mobileLayout.groups, [newGroupHierarchicalKey]: [] },
    groupParents: { ...(mobileLayout.groupParents ?? {}) },
    subgraphs: { ...mobileLayout.subgraphs },
    hiddenBlocks: { ...mobileLayout.hiddenBlocks },
  };

  const newGroupRef: ItemRef = {
    type: "group",
    id: newGroupId,
    subgraphId: targetSubgraphId,
    itemKey: newGroupHierarchicalKey,
  };

  let targetContainer: ContainerId = targetSubgraphId
    ? { scope: "subgraph", subgraphId: targetSubgraphId }
    : { scope: "root" };
  let insertionIndex: number | null = null;
  if (nearNode) {
    const nearNodeLocation = findItemInLayout(nextMobileLayout, {
      type: "node",
      id: nearNode.id,
    });
    if (nearNodeLocation) {
      targetContainer = nearNodeLocation.containerId;
      insertionIndex = nearNodeLocation.index + 1;
    }
  }

  const targetItems = [...getContainerItems(nextMobileLayout, targetContainer)];
  const clampedIndex =
    insertionIndex == null
      ? targetItems.length
      : Math.max(0, Math.min(insertionIndex, targetItems.length));
  targetItems.splice(clampedIndex, 0, newGroupRef);
  nextMobileLayout = setContainerItems(
    nextMobileLayout,
    targetContainer,
    targetItems,
  );

  if (targetContainer.scope === "root") {
    nextMobileLayout.groupParents![newGroupHierarchicalKey] = { scope: "root" };
  } else if (targetContainer.scope === "subgraph") {
    nextMobileLayout.groupParents![newGroupHierarchicalKey] = {
      scope: "subgraph",
      subgraphId: targetContainer.subgraphId,
    };
  } else {
    nextMobileLayout.groupParents![newGroupHierarchicalKey] = {
      scope: "group",
      groupKey: targetContainer.groupKey,
    };
  }

  const reconciled = reconcilePointerRegistry(
    nextMobileLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  );
  const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
    nextWorkflow,
    reconciled.layoutToStable,
  );

  set({
    workflow: nextWorkflowWithHierarchicalKeys,
    mobileLayout: nextMobileLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
    editContainerLabelRequest: {
      id: ++editContainerLabelRequestId,
      itemKey: newGroupHierarchicalKey,
      initialValue: "",
    },
  });

  return newGroupHierarchicalKey;
};

// Resolve the current scope's subgraph id from the scope stack (null at root).

const currentScopeSubgraphId = (): string | null => {
  const frame = get().scopeStack[get().scopeStack.length - 1];
  return frame?.type === "subgraph" ? frame.id : null;
};

const copySelectedItems: WorkflowState["copySelectedItems"] = (itemKeys) => {
  const { workflow } = get();
  if (!workflow) return;
  const subgraphId = currentScopeSubgraphId();
  // Gather the selected nodes (and subgraph placeholders, which resolve as
  // nodes) in the current scope. Group keys don't contribute nodes here —
  // selecting a group already auto-selects its member nodes.
  const nodeIds: number[] = [];
  for (const key of itemKeys) {
    const identity = resolveNodeIdentityFromHierarchicalKey(workflow, key);
    if (identity && identity.subgraphId === subgraphId) {
      nodeIds.push(identity.nodeId);
    }
  }
  const payload = buildMultiNodeClipboardPayload(workflow, subgraphId, nodeIds);
  if (payload) useWorkflowClipboardStore.getState().setPayload(payload);
};

const deleteSelectedItems: WorkflowState["deleteSelectedItems"] = (itemKeys) => {
  const { workflow } = get();
  if (!workflow) return;
  // Partition up front (resolution is against the current workflow; item
  // keys stay valid across the per-item deletes below since they're stable).
  const groupKeys: HierarchicalKey[] = [];
  const nodeKeys: HierarchicalKey[] = [];
  for (const key of itemKeys) {
    if (resolveNodeIdentityFromHierarchicalKey(workflow, key)) {
      nodeKeys.push(key);
      continue;
    }
    const container = resolveContainerIdentityFromHierarchicalKey(workflow, key);
    if (container?.type === "group") groupKeys.push(key);
    // A selected subgraph is its placeholder node (handled by nodeKeys);
    // subgraph containers aren't selectable on their own here.
  }
  // Remove group boxes first (deleteNodes:false keeps their nodes), then
  // delete the selected nodes. Reuse the single-item actions so all the
  // link/layout cleanup they already do applies. reconnect:false — a bulk
  // delete removes nodes outright rather than bridging links.
  //
  // Wrapped so the whole burst is ONE undo step: each per-item action
  // commits its own set(), and the undo subscription snapshots each one.
  // Undoing a 12-node delete would otherwise take 12 presses, and with
  // MAX_STEPS at 10 the first items could never be restored at all.
  runUndoTransaction(() => {
    for (const key of groupKeys) get().deleteContainer(key, { deleteNodes: false });
    for (const key of nodeKeys) get().deleteNode(key, false);
  });
};

const createGroupFromItems: WorkflowState["createGroupFromItems"] = (itemKeys) => {
  const { workflow, hiddenItems, itemKeyByPointer, pointerByHierarchicalKey } = get();
  if (!workflow) return;
  const subgraphId = currentScopeSubgraphId();
  const subgraphDefs = workflow.definitions?.subgraphs ?? [];
  const scopeNodes =
    subgraphId == null
      ? workflow.nodes
      : subgraphDefs.find((sg) => sg.id === subgraphId)?.nodes ?? [];

  // Selected nodes in this scope (subgraph placeholders included).
  const idSet = new Set<number>();
  for (const key of itemKeys) {
    const identity = resolveNodeIdentityFromHierarchicalKey(workflow, key);
    if (identity && identity.subgraphId === subgraphId) idSet.add(identity.nodeId);
  }
  const memberIds = scopeNodes.filter((n) => idSet.has(n.id)).map((n) => n.id);
  if (memberIds.length === 0) return;

  // Create the group in a FRESH empty area at the bottom of the scope, then
  // RELOCATE exactly the selected nodes into it. Drawing the group's box
  // around the nodes in place would let the geometric membership pass
  // (computeNodeGroupsFor) also claim any UNSELECTED node whose center sits
  // inside that rect. Moving only the selected nodes into a clean area makes
  // membership exact — nothing else can be captured.
  const groupsInScope =
    subgraphId == null
      ? workflow.groups ?? []
      : subgraphDefs.find((sg) => sg.id === subgraphId)?.groups ?? [];
  const newGroupId = groupsInScope.reduce((m, g) => Math.max(m, g.id), 0) + 1;
  const newGroupHierarchicalKey = makeLocationPointer({
    type: "group",
    groupId: newGroupId,
    subgraphId,
  });
  const basePos = getBottomPlacementForScope(workflow, { subgraphId });
  const newGroup: WorkflowGroup = {
    id: newGroupId,
    itemKey: newGroupHierarchicalKey,
    title: "",
    bounding: [Math.round(basePos[0]), Math.round(basePos[1]), 320, 160],
    color: themeColors.brand.blue400,
    font_size: 24,
    flags: {},
  };

  const workflowWithGroup: Workflow =
    subgraphId == null
      ? { ...workflow, groups: [...(workflow.groups ?? []), newGroup] }
      : {
          ...workflow,
          definitions: {
            ...(workflow.definitions ?? {}),
            subgraphs: subgraphDefs.map((sg) =>
              sg.id === subgraphId
                ? { ...sg, groups: [...(sg.groups ?? []), newGroup] }
                : sg,
            ),
          },
        };

  // Reposition the selected nodes into the new (empty) group and grow its
  // box to fit exactly them.
  const nextWorkflow = placePastedNodesIntoGroup(
    workflowWithGroup,
    newGroupId,
    subgraphId,
    memberIds,
  );

  // Rebuild the layout; with the group sitting in a clean area containing
  // only the relocated nodes, geometry assigns exactly them as members.
  const rebuiltLayout = buildLayoutForWorkflow(
    nextWorkflow,
    layoutRecordFromPointerRecord(hiddenItems, pointerByHierarchicalKey),
  );
  const reconciled = reconcilePointerRegistry(
    rebuiltLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  );
  const nextWorkflowWithHierarchicalKeys = annotateWorkflowWithHierarchicalKeys(
    nextWorkflow,
    reconciled.layoutToStable,
  );

  set({
    workflow: nextWorkflowWithHierarchicalKeys,
    mobileLayout: rebuiltLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
    editContainerLabelRequest: {
      id: ++editContainerLabelRequestId,
      itemKey: newGroupHierarchicalKey,
      initialValue: "",
    },
  });
};

const addNodeAndConnect: WorkflowState["addNodeAndConnect"] = (
  nodeType,
  targetHierarchicalKey,
  targetInputIndex,
) => {
  const { workflow, nodeTypes, pointerByHierarchicalKey } = get();
  if (!workflow || !nodeTypes) return null;
  const targetIdentity = resolveNodeIdentityFromHierarchicalKey(
    workflow,
    targetHierarchicalKey,
    pointerByHierarchicalKey,
  );
  if (!targetIdentity) return null;
  const targetNodeId = targetIdentity.nodeId;

  // Resolve the target in its own scope — the key may point inside a subgraph.
  const targetScopeNodes =
    targetIdentity.subgraphId == null
      ? workflow.nodes
      : (workflow.definitions?.subgraphs?.find(
          (sg) => sg.id === targetIdentity.subgraphId,
        )?.nodes ?? []);
  const targetNode = targetScopeNodes.find((n) => n.id === targetNodeId);
  if (!targetNode) return null;

  const targetInput = targetNode.inputs[targetInputIndex];
  if (!targetInput) return null;

  const typeDef = nodeTypes[nodeType];
  if (!typeDef) return null;

  // Find compatible output slot
  const inputType = targetInput.type.toUpperCase();
  const outputIndex = (typeDef.output ?? []).findIndex((outType) =>
    areTypesCompatible(String(outType), inputType),
  );
  if (outputIndex < 0) return null;

  const newId = get().addNode(nodeType, {
    nearNodeHierarchicalKey: targetHierarchicalKey,
    inSubgraphId: targetIdentity.subgraphId ?? undefined,
  });
  if (newId === null) return null;
  const newPointer = makeLocationPointer({
    type: "node",
    nodeId: newId,
    subgraphId: targetIdentity.subgraphId,
  });
  const newHierarchicalKey = get().itemKeyByPointer[newPointer];
  if (!newHierarchicalKey) return null;

  get().connectNodes(
    newHierarchicalKey,
    outputIndex,
    targetHierarchicalKey,
    targetInputIndex,
    targetInput.type,
  );
  return newId;
};

// Map a widget value type to the ComfyUI core primitive node that outputs
// it. Only these scalar types can be popped out.

const PRIMITIVE_NODE_TYPE_BY_VALUE_TYPE: Record<string, string> = {
  STRING: "PrimitiveString",
  INT: "PrimitiveInt",
  FLOAT: "PrimitiveFloat",
  BOOLEAN: "PrimitiveBoolean",
};

const ensureWidgetInputSlot: WorkflowState["ensureWidgetInputSlot"] = (
  targetHierarchicalKey,
  inputName,
  inputType,
) => {
  const { workflow, pointerByHierarchicalKey } = get();
  if (!workflow) return null;
  const identity = resolveNodeIdentityFromHierarchicalKey(
    workflow,
    targetHierarchicalKey,
    pointerByHierarchicalKey,
  );
  if (!identity) return null;
  const scopeNodes =
    identity.subgraphId == null
      ? workflow.nodes
      : (workflow.definitions?.subgraphs?.find((sg) => sg.id === identity.subgraphId)?.nodes ?? []);
  const node = scopeNodes.find((n) => n.id === identity.nodeId);
  if (!node) return null;
  const existing = node.inputs.findIndex((inp) => inp.name === inputName);
  if (existing >= 0) return existing;

  const newInput: WorkflowInput = {
    name: inputName,
    type: inputType,
    widget: { name: inputName },
    link: null,
  };
  const addInput = (n: WorkflowNode): WorkflowNode =>
    n.id === identity.nodeId ? { ...n, inputs: [...n.inputs, newInput] } : n;
  const nextWorkflow =
    identity.subgraphId == null
      ? { ...workflow, nodes: workflow.nodes.map(addInput) }
      : {
          ...workflow,
          definitions: {
            ...(workflow.definitions ?? {}),
            subgraphs: (workflow.definitions?.subgraphs ?? []).map((sg) =>
              sg.id === identity.subgraphId
                ? { ...sg, nodes: (sg.nodes ?? []).map(addInput) }
                : sg,
            ),
          },
        };
  const newIndex = node.inputs.length;
  set({ workflow: nextWorkflow });
  return newIndex;
};

// Wrapped in an undo transaction: slot materialization, addNode, title,
// value seed, and connect each commit their own set(), and recording them
// as separate undo steps let Undo restore half-materialized states (a
// dangling primitive that saving then persisted).

const popWidgetToPrimitive: WorkflowState["popWidgetToPrimitive"] = (
  targetHierarchicalKey,
  inputName,
  widgetValue,
  options,
) => runUndoTransaction(() => {
  const { workflow, nodeTypes, pointerByHierarchicalKey } = get();
  if (!workflow || !nodeTypes) return null;
  const targetIdentity = resolveNodeIdentityFromHierarchicalKey(
    workflow,
    targetHierarchicalKey,
    pointerByHierarchicalKey,
  );
  if (!targetIdentity) return null;
  const targetScopeNodes =
    targetIdentity.subgraphId == null
      ? workflow.nodes
      : (workflow.definitions?.subgraphs?.find(
          (sg) => sg.id === targetIdentity.subgraphId,
        )?.nodes ?? []);
  const targetNode = targetScopeNodes.find((n) => n.id === targetIdentity.nodeId);
  if (!targetNode) return null;

  // The widget's input slot may not be materialized in node.inputs (an
  // un-converted widget-input — common in older workflows). Resolve the
  // type from the existing slot, else the node type definition.
  let slotIndex = targetNode.inputs.findIndex((inp) => inp.name === inputName);
  let inputType: string | null =
    slotIndex >= 0 ? String(targetNode.inputs[slotIndex].type) : null;
  if (slotIndex < 0) {
    const typeDef = nodeTypes[targetNode.type];
    const def =
      typeDef?.input?.required?.[inputName] ?? typeDef?.input?.optional?.[inputName];
    if (!def) return null;
    const [typeOrOptions] = def;
    const signature = Array.isArray(typeOrOptions)
      ? typeOrOptions.map((entry) => String(entry)).join(",")
      : String(typeOrOptions);
    if (signature.toUpperCase().includes("AUTOCOMPLETE_TEXT")) {
      // Autocomplete-Plus tags its free-text inputs with a custom type;
      // they're STRING widgets (and canPopOutWidget offers them as
      // such), so the pop-out must agree — bailing here made the
      // confirmed dialog silently do nothing.
      inputType = "STRING";
    } else if (isComboType(typeOrOptions)) {
      // Combo — no primitive equivalent. Covers the V3 string-typed forms
      // too, which would otherwise fall through as a literal "COMBO" type
      // and only bail further down when no primitive node matches.
      return null;
    } else {
      inputType = String(typeOrOptions);
    }
  }
  if (!inputType) return null;
  // Same normalization for an already-materialized slot carrying the
  // custom autocomplete type tag.
  if (inputType.toUpperCase().includes("AUTOCOMPLETE_TEXT")) inputType = "STRING";

  const primitiveType = PRIMITIVE_NODE_TYPE_BY_VALUE_TYPE[inputType.toUpperCase()];
  if (!primitiveType || !nodeTypes[primitiveType]) return null;

  // Materialize the input slot if it doesn't exist yet (convert the widget
  // to an input) so the link has somewhere to attach.
  if (slotIndex < 0) {
    const newInput: WorkflowInput = {
      name: inputName,
      type: inputType,
      widget: { name: inputName },
      link: null,
    };
    const addInput = (n: WorkflowNode): WorkflowNode =>
      n.id === targetIdentity.nodeId ? { ...n, inputs: [...n.inputs, newInput] } : n;
    const nextWorkflow =
      targetIdentity.subgraphId == null
        ? { ...workflow, nodes: workflow.nodes.map(addInput) }
        : {
            ...workflow,
            definitions: {
              ...(workflow.definitions ?? {}),
              subgraphs: (workflow.definitions?.subgraphs ?? []).map((sg) =>
                sg.id === targetIdentity.subgraphId
                  ? { ...sg, nodes: (sg.nodes ?? []).map(addInput) }
                  : sg,
              ),
            },
          };
    slotIndex = targetNode.inputs.length;
    set({ workflow: nextWorkflow });
  }

  const newId = get().addNode(primitiveType, {
    nearNodeHierarchicalKey: targetHierarchicalKey,
    inSubgraphId: targetIdentity.subgraphId ?? undefined,
  });
  if (newId === null) return null;
  const newPointer = makeLocationPointer({
    type: "node",
    nodeId: newId,
    subgraphId: targetIdentity.subgraphId,
  });
  const newHierarchicalKey = get().itemKeyByPointer[newPointer];
  if (!newHierarchicalKey) return null;

  // Seed the primitive's value (widget 0) with the popped value, then wire
  // its output (slot 0) into the input the widget was backing.
  if (options?.title?.trim()) {
    get().updateNodeTitle(newHierarchicalKey, options.title);
  }
  get().updateNodeWidget(newHierarchicalKey, 0, widgetValue, "value");
  get().connectNodes(
    newHierarchicalKey,
    0,
    targetHierarchicalKey,
    slotIndex,
    inputType,
  );

  // addNode appends to the bottom of the scope; move the new primitive
  // directly above the node it was popped out of.
  const after = get();
  if (after.workflow) {
    const movedLayout = placeLayoutItemBefore(
      after.mobileLayout,
      newId,
      targetIdentity.nodeId,
    );
    const reconciled = reconcilePointerRegistry(
      movedLayout,
      after.itemKeyByPointer,
      after.pointerByHierarchicalKey,
    );
    set({
      workflow: annotateWorkflowWithHierarchicalKeys(
        after.workflow,
        reconciled.layoutToStable,
      ),
      mobileLayout: movedLayout,
      itemKeyByPointer: reconciled.layoutToStable,
      pointerByHierarchicalKey: reconciled.stableToLayout,
    });
  }
  return newId;
});

const enterSubgraph: WorkflowState["enterSubgraph"] = (placeholderNodeId) => {
  const { scopeStack, workflow } = get();
  if (!workflow) return;
  const scope = resolveCurrentScope(scopeStack, workflow);
  const placeholderNode = scope.nodes.find((n) => n.id === placeholderNodeId);
  if (!placeholderNode) return;
  const subgraphId = placeholderNode.type;
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  if (!subgraphs.some((sg) => sg.id === subgraphId)) return;
  const top = scopeStack[scopeStack.length - 1];
  if (top?.type === "subgraph" && top.id === subgraphId) return;
  set({ scopeStack: [...scopeStack, { type: "subgraph", id: subgraphId, placeholderNodeId }] });
};

const exitSubgraph: WorkflowState["exitSubgraph"] = () => {
  const { scopeStack } = get();
  if (scopeStack.length <= 1) return;
  set({ scopeStack: scopeStack.slice(0, -1) });
};

const exitToRoot: WorkflowState["exitToRoot"] = () => {
  set({ scopeStack: [{ type: "root" }] });
};

const exitToDepth: WorkflowState["exitToDepth"] = (depth) => {
  const { scopeStack } = get();
  if (scopeStack.length <= depth) return;
  set({ scopeStack: scopeStack.slice(0, depth) });
};

const navigateToSubgraphTrail: WorkflowState["navigateToSubgraphTrail"] = (
  subgraphIds,
) => {
  const { workflow, scopeStack } = get();
  if (!workflow) return false;
  const nextScopeStack = buildScopeStackForSubgraphTrail(workflow, subgraphIds);
  if (!nextScopeStack) return false;
  const sameTrail =
    scopeStack.length === nextScopeStack.length &&
    scopeStack.every((frame, index) => {
      const nextFrame = nextScopeStack[index];
      if (frame.type !== nextFrame?.type) return false;
      if (frame.type === "root" || nextFrame.type === "root") return true;
      return frame.id === nextFrame.id;
    });
  if (sameTrail) return true;
  set({ scopeStack: nextScopeStack });
  return true;
};

  return { deleteNode, collapseSetGetNodes, connectNodes, disconnectInput, addNode, duplicateNode, pasteClipboard, copyContainer, pasteIntoContainer, addGroupNearNode, copySelectedItems, deleteSelectedItems, createGroupFromItems, addNodeAndConnect, ensureWidgetInputSlot, popWidgetToPrimitive, enterSubgraph, exitSubgraph, exitToRoot, exitToDepth, navigateToSubgraphTrail };
}
