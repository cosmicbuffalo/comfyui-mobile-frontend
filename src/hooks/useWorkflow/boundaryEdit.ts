import type {
  Workflow,
  WorkflowNode,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from "@/api/types";
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
  resolveCurrentScope,
  resolveNodeByHierarchicalKey,
  updateNodeInScope,
  type ScopeContext,
} from "@/utils/canonicalWorkflowOps";
import { rebuildDefinitionLinkIds } from "@/utils/workflowValidator";
import { reindexBoundaryLinks } from "@/utils/pruneOrphanedBoundarySlots";
import { runUndoTransaction } from "@/utils/undoTransaction";
import { normalizeSubgraphPlaceholders } from "@/utils/normalizeSubgraphPlaceholders";
import {
  boundaryWidgetNames,
  reconcileInstanceWidgetValues,
} from "@/utils/instanceWidgetValues";
import {
  getInputWidgetDefinitions,
  getSubgraphBoundaryWidgetIndexForSlot,
  getSubgraphBoundaryWidgetSlots,
  getWidgetDefinitions,
} from "@/utils/widgetDefinitions";
import { getNodePropertyWidgetIndexMap } from "@/utils/workflowInputs";
import { newBoundarySlotId } from "@/utils/subgraphBoundaryNames";
import {
  findPromotedWidgetSlot,
  readInstancePromotedValue,
  resolvePromotedInstance,
  reorderInstancePromotedValues,
  setInnerWidgetValue,
  type PromotedWidgetForm,
} from "@/utils/promotedWidgetForm";
import {
  MOBILE_SLOT_LABELS_PROPERTY,
  getInstanceSlotLabels,
  slotLabelKey,
} from "@/utils/boundarySlotLabels";
import type { WorkflowGet, WorkflowSet, WorkflowState } from "./state";

// Boundary (subgraph input/output slot) link editing. A subgraph's own input
// slots feed inner node inputs through links originating at sentinel node -10;
// inner node outputs feed the subgraph's output slots through links targeting
// sentinel node -20. The sentinels are not nodes, so the regular
// connectNodes/disconnectInput actions can never express these links — these
// actions are the only writers. Each one keeps the definition's derived
// inputs[i].linkIds / outputs[j].linkIds caches in sync via
// rebuildDefinitionLinkIds, so save-time repair is a no-op.
//
// All actions operate on the CURRENT scope (the subgraph the user is inside)
// and no-op at root. Each commits in a single set(), i.e. one undo step.

interface SubgraphScope extends ScopeContext {
  subgraphId: string;
  links: WorkflowSubgraphLink[];
}

function currentSubgraphScope(workflow: Workflow, scopeStack: WorkflowState["scopeStack"]): SubgraphScope | null {
  const scope = resolveCurrentScope(scopeStack, workflow);
  if (scope.subgraphId == null) return null;
  return scope as SubgraphScope;
}

function parentDefinitionId(scopeStack: WorkflowState["scopeStack"]): string | null {
  const frame = scopeStack[scopeStack.length - 2];
  return frame?.type === 'subgraph' ? frame.id : null;
}

/**
 * The scope a node lives in, wherever that is — root, or some definition.
 * A placeholder can be edited from its own card without the scope stack being
 * anywhere near it, so its home has to be found rather than assumed.
 */
function scopeContainingNode(workflow: Workflow, nodeId: number): ScopeContext | null {
  if ((workflow.nodes ?? []).some((node) => node.id === nodeId)) {
    return resolveCurrentScope([{ type: "root" }], workflow);
  }
  for (const definition of workflow.definitions?.subgraphs ?? []) {
    if ((definition.nodes ?? []).some((node) => node.id === nodeId)) {
      return resolveCurrentScope(
        [{ type: "root" }, { type: "subgraph", id: definition.id, placeholderNodeId: -1 }],
        workflow,
      );
    }
  }
  return null;
}

/**
 * The scope for a named definition, or the one on screen when no id is given.
 *
 * Boundary edits are reachable from two places now: from inside the subgraph,
 * where the current scope IS the definition, and from a placeholder outside it,
 * where the definition has to be named. The placeholder route synthesizes a
 * stack rather than duplicating the scope machinery — nothing in a definition
 * patch depends on which instance the stack names.
 */
function targetSubgraphScope(
  workflow: Workflow,
  scopeStack: WorkflowState["scopeStack"],
  subgraphId?: string,
): SubgraphScope | null {
  if (!subgraphId) return currentSubgraphScope(workflow, scopeStack);
  const exists = (workflow.definitions?.subgraphs ?? []).some((sg) => sg.id === subgraphId);
  if (!exists) return null;
  return currentSubgraphScope(workflow, [
    { type: "root" },
    { type: "subgraph", id: subgraphId, placeholderNodeId: -1 },
  ]);
}

/** Rebuild the linkIds caches of one definition inside the canonical workflow. */
function withRebuiltLinkIds(workflow: Workflow, subgraphId: string): Workflow {
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  return {
    ...workflow,
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: subgraphs.map((sg) => (sg.id === subgraphId ? rebuildDefinitionLinkIds(sg) : sg)),
    },
  };
}

/** Apply a patch to one definition inside the canonical workflow. */
function patchDefinitionSlots(
  workflow: Workflow,
  subgraphId: string,
  patch: (def: WorkflowSubgraphDefinition) => WorkflowSubgraphDefinition,
): Workflow | null {
  const subgraphs = workflow.definitions?.subgraphs ?? [];
  if (!subgraphs.some((sg) => sg.id === subgraphId)) return null;
  return {
    ...workflow,
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: subgraphs.map((sg) => (sg.id === subgraphId ? patch(sg) : sg)),
    },
  };
}

/** Null the given input slots and drop the given link ids from all output slots. */
function pruneLinksFromNodes(
  nodes: WorkflowNode[],
  removedLinkIds: Set<number>,
): WorkflowNode[] {
  if (removedLinkIds.size === 0) return nodes;
  return nodes.map((n) => {
    const inputsTouched = n.inputs.some((i) => i.link != null && removedLinkIds.has(i.link));
    const outputsTouched = n.outputs.some((o) => o.links?.some((id) => removedLinkIds.has(id)));
    if (!inputsTouched && !outputsTouched) return n;
    return {
      ...n,
      inputs: inputsTouched
        ? n.inputs.map((i) => (i.link != null && removedLinkIds.has(i.link) ? { ...i, link: null } : i))
        : n.inputs,
      outputs: outputsTouched
        ? n.outputs.map((o) => {
            if (!o.links?.some((id) => removedLinkIds.has(id))) return o;
            const filtered = o.links.filter((id) => !removedLinkIds.has(id));
            return { ...o, links: filtered.length > 0 ? filtered : null };
          })
        : n.outputs,
    };
  });
}


/**
 * A boundary port name unique within its list. ComfyUI suffixes a clash with
 * `_1`, `_2`, … — two VAELoaders both promoting `vae_name` give `vae_name` and
 * `vae_name_1` — so mirror that rather than inventing a second convention.
 */
function uniqueBoundaryName(taken: Iterable<string>, base: string): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let suffix = 1; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** Fresh id for a boundary slot entry, in the uuid-ish shape ComfyUI writes. */


/**
 * Give every placeholder instance a value slot for a newly promoted widget.
 *
 * The order is the boundary's: a widget-backed boundary input owns one entry in
 * `widgets_values`, at its position among the widget-backed inputs. That used to
 * be written out as a `proxyWidgets` list so our new entry and any legacy direct
 * entries could not disagree — but carrying two orders is what made every value
 * positional against the wrong list. `migrateProxyWidgets` now retires that list
 * on load, so there is one order and the value simply goes at its index.
 */
function appendPromotedWidgetToInstances(
  workflow: Workflow,
  subgraphId: string,
  boundaryName: string,
  value: unknown,
): Workflow {
  const definition = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  if (!definition) return workflow;
  const widgetIndex = getSubgraphBoundaryWidgetSlots(definition)
    .findIndex(({ boundarySlot }) => (definition.inputs ?? [])[boundarySlot]?.name === boundaryName);
  if (widgetIndex < 0) return workflow;

  const patchInstance = (node: WorkflowNode): WorkflowNode => {
    if (node.type !== subgraphId) return node;
    const values = Array.isArray(node.widgets_values) ? [...node.widgets_values] : [];
    // A short array is normal — trailing widgets that hold no value are not
    // serialized — so pad up to the slot this widget owns before placing it.
    while (values.length < widgetIndex) values.push(null);
    values.splice(widgetIndex, 0, value);
    return { ...node, widgets_values: values };
  };

  return {
    ...workflow,
    nodes: (workflow.nodes ?? []).map(patchInstance),
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: (workflow.definitions?.subgraphs ?? []).map((sg) => ({
        ...sg,
        nodes: (sg.nodes ?? []).map(patchInstance),
      })),
    },
  };
}

export function createBoundaryEditActions(set: WorkflowSet, get: WorkflowGet) {

const connectBoundaryInput: WorkflowState["connectBoundaryInput"] = (slotIndex, targets) => {
  const { workflow, scopeStack } = get();
  if (!workflow) return;
  const scope = currentSubgraphScope(workflow, scopeStack);
  if (!scope) return;
  // The order an instance's values were written against, needed to read them
  // back by name once the boundary has changed under them.
  const previousBoundaryNames = boundaryWidgetNames(
    (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId),
  );
  const def = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId);
  const boundarySlot = def?.inputs?.[slotIndex];
  if (!boundarySlot) return;

  // Resolve the requested target set first; bail entirely on a stale key so a
  // half-applied fan-out never commits.
  const resolvedTargets: Array<{ node: WorkflowNode; inputSlot: number }> = [];
  for (const target of targets) {
    const node = resolveNodeByHierarchicalKey(scope.nodes, target.nodeKey);
    if (!node || !node.inputs[target.inputSlot]) return;
    resolvedTargets.push({ node, inputSlot: target.inputSlot });
  }

  const removedLinkIds = new Set<number>();
  // This boundary slot's current fan-out is replaced wholesale.
  for (const link of scope.links) {
    if (link.origin_id === SUBGRAPH_INPUT_NODE_ID && link.origin_slot === slotIndex) {
      removedLinkIds.add(link.id);
    }
  }
  // A regular link already feeding a chosen target input is displaced.
  for (const { node, inputSlot } of resolvedTargets) {
    const existing = node.inputs[inputSlot]?.link;
    if (existing != null) removedLinkIds.add(existing);
  }

  let nextLinkId = scope.linkIdBase;
  const newLinkIdByTarget = new Map<string, number>();
  const newLinks: WorkflowSubgraphLink[] = [];
  for (const { node, inputSlot } of resolvedTargets) {
    nextLinkId += 1;
    newLinkIdByTarget.set(`${node.id}:${inputSlot}`, nextLinkId);
    newLinks.push({
      id: nextLinkId,
      origin_id: SUBGRAPH_INPUT_NODE_ID,
      origin_slot: slotIndex,
      target_id: node.id,
      target_slot: inputSlot,
      type: boundarySlot.type ?? node.inputs[inputSlot]?.type ?? "*",
    });
  }

  const keptLinks = scope.links.filter((l) => !removedLinkIds.has(l.id));
  const prunedNodes = pruneLinksFromNodes(scope.nodes, removedLinkIds);
  const nextNodes = prunedNodes.map((n) => {
    let inputs = n.inputs;
    for (let i = 0; i < inputs.length; i += 1) {
      const newId = newLinkIdByTarget.get(`${n.id}:${i}`);
      if (newId != null && inputs[i].link !== newId) {
        if (inputs === n.inputs) inputs = [...inputs];
        inputs[i] = { ...inputs[i], link: newId };
      }
    }
    return inputs === n.inputs ? n : { ...n, inputs };
  });

  const patched = scope.applyPatch(workflow, {
    nodes: nextNodes,
    links: [...keptLinks, ...newLinks],
  });
  // Re-pointing a boundary at a widget input (or away from one) changes whether
  // the slot is widget-backed, and so whether the instances owe it a value.
  set({
    workflow: reconcileInstanceWidgetValues(
      // Normalize before reconciling: whether the slot is widget-backed just
      // changed, and buildBoundaryInputs is what moves the `widget` marker
      // (and the boundary label) onto every placeholder's slot list.
      normalizeSubgraphPlaceholders(withRebuiltLinkIds(patched, scope.subgraphId)),
      scope.subgraphId,
      get().nodeTypes,
      previousBoundaryNames,
    ),
  });
};

const connectBoundaryOutput: WorkflowState["connectBoundaryOutput"] = (slotIndex, source) => {
  const { workflow, scopeStack } = get();
  if (!workflow) return;
  const scope = currentSubgraphScope(workflow, scopeStack);
  if (!scope) return;
  // The order an instance's values were written against, needed to read them
  // back by name once the boundary has changed under them.
  const previousBoundaryNames = boundaryWidgetNames(
    (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId),
  );
  const def = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId);
  const boundarySlot = def?.outputs?.[slotIndex];
  if (!boundarySlot) return;

  let sourceNode: WorkflowNode | null = null;
  if (source) {
    sourceNode = resolveNodeByHierarchicalKey(scope.nodes, source.nodeKey);
    if (!sourceNode || !sourceNode.outputs[source.outputSlot]) return;
  }

  // A subgraph output slot has a single feeder — replace it.
  const removedLinkIds = new Set<number>();
  for (const link of scope.links) {
    if (link.target_id === SUBGRAPH_OUTPUT_NODE_ID && link.target_slot === slotIndex) {
      removedLinkIds.add(link.id);
    }
  }

  const keptLinks = scope.links.filter((l) => !removedLinkIds.has(l.id));
  let nextNodes = pruneLinksFromNodes(scope.nodes, removedLinkIds);
  const newLinks: WorkflowSubgraphLink[] = [];

  if (source && sourceNode) {
    const newLinkId = scope.linkIdBase + 1;
    newLinks.push({
      id: newLinkId,
      origin_id: sourceNode.id,
      origin_slot: source.outputSlot,
      target_id: SUBGRAPH_OUTPUT_NODE_ID,
      target_slot: slotIndex,
      type: boundarySlot.type ?? sourceNode.outputs[source.outputSlot]?.type ?? "*",
    });
    const sourceNodeId = sourceNode.id;
    nextNodes = nextNodes.map((n) => {
      if (n.id !== sourceNodeId) return n;
      const outputs = [...n.outputs];
      const existing = outputs[source.outputSlot]?.links ?? [];
      outputs[source.outputSlot] = { ...outputs[source.outputSlot], links: [...existing, newLinkId] };
      return { ...n, outputs };
    });
  }

  const patched = scope.applyPatch(workflow, {
    nodes: nextNodes,
    links: [...keptLinks, ...newLinks],
  });
  // Re-pointing a boundary at a widget input (or away from one) changes whether
  // the slot is widget-backed, and so whether the instances owe it a value.
  set({
    workflow: reconcileInstanceWidgetValues(
      // Normalize before reconciling: whether the slot is widget-backed just
      // changed, and buildBoundaryInputs is what moves the `widget` marker
      // (and the boundary label) onto every placeholder's slot list.
      normalizeSubgraphPlaceholders(withRebuiltLinkIds(patched, scope.subgraphId)),
      scope.subgraphId,
      get().nodeTypes,
      previousBoundaryNames,
    ),
  });
};

const disconnectBoundaryLink: WorkflowState["disconnectBoundaryLink"] = (
  direction,
  slotIndex,
  innerNodeId,
  innerSlot,
) => {
  const { workflow, scopeStack } = get();
  if (!workflow) return;
  const scope = currentSubgraphScope(workflow, scopeStack);
  if (!scope) return;
  // The order an instance's values were written against, needed to read them
  // back by name once the boundary has changed under them.
  const previousBoundaryNames = boundaryWidgetNames(
    (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId),
  );

  const link = scope.links.find((l) =>
    direction === "input"
      ? l.origin_id === SUBGRAPH_INPUT_NODE_ID &&
        l.origin_slot === slotIndex &&
        l.target_id === innerNodeId &&
        l.target_slot === innerSlot
      : l.target_id === SUBGRAPH_OUTPUT_NODE_ID &&
        l.target_slot === slotIndex &&
        l.origin_id === innerNodeId &&
        l.origin_slot === innerSlot,
  );
  if (!link) return;

  const removedLinkIds = new Set([link.id]);
  const patched = scope.applyPatch(workflow, {
    nodes: pruneLinksFromNodes(scope.nodes, removedLinkIds),
    links: scope.links.filter((l) => l.id !== link.id),
  });
  // Re-pointing a boundary at a widget input (or away from one) changes whether
  // the slot is widget-backed, and so whether the instances owe it a value.
  set({
    workflow: reconcileInstanceWidgetValues(
      // Normalize before reconciling: whether the slot is widget-backed just
      // changed, and buildBoundaryInputs is what moves the `widget` marker
      // (and the boundary label) onto every placeholder's slot list.
      normalizeSubgraphPlaceholders(withRebuiltLinkIds(patched, scope.subgraphId)),
      scope.subgraphId,
      get().nodeTypes,
      previousBoundaryNames,
    ),
  });
};


// Promote an inner node input into a new subgraph input slot. The slot is
// appended, so it takes the last widgets_values index on every instance and no
// existing index shifts. An input already fed from inside is displaced: a
// boundary slot and a local link cannot both drive it.
const addBoundaryInput: WorkflowState["addBoundaryInput"] = (target) => {
  const { workflow, scopeStack } = get();
  if (!workflow) return;
  const scope = currentSubgraphScope(workflow, scopeStack);
  if (!scope) return;
  // The order an instance's values were written against, needed to read them
  // back by name once the boundary has changed under them.
  const previousBoundaryNames = boundaryWidgetNames(
    (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId),
  );
  const def = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId);
  if (!def) return;

  const node = resolveNodeByHierarchicalKey(scope.nodes, target.nodeKey);
  const slot = node?.inputs?.[target.inputSlot];
  if (!node || !slot) return;

  const existingInputs = def.inputs ?? [];
  // Already promoted through this exact slot — nothing to add.
  const alreadyPromoted = scope.links.some(
    (link) =>
      link.origin_id === SUBGRAPH_INPUT_NODE_ID &&
      link.target_id === node.id &&
      link.target_slot === target.inputSlot,
  );
  if (alreadyPromoted) return;

  const boundaryName = uniqueBoundaryName(
    existingInputs.map((entry) => entry.name ?? ""),
    slot.label || slot.localized_name || slot.name || "input",
  );
  const slotIndex = existingInputs.length;
  const newLinkId = scope.linkIdBase + 1;
  const displaced = slot.link != null ? new Set([slot.link]) : new Set<number>();

  const nextNodes = pruneLinksFromNodes(scope.nodes, displaced).map((n) => {
    if (n.id !== node.id) return n;
    const inputs = [...n.inputs];
    inputs[target.inputSlot] = { ...inputs[target.inputSlot], link: newLinkId };
    return { ...n, inputs };
  });

  const patched = scope.applyPatch(workflow, {
    nodes: nextNodes,
    links: [
      ...scope.links.filter((link) => !displaced.has(link.id)),
      {
        id: newLinkId,
        origin_id: SUBGRAPH_INPUT_NODE_ID,
        origin_slot: slotIndex,
        target_id: node.id,
        target_slot: target.inputSlot,
        type: slot.type ?? "*",
      },
    ],
  });

  const withSlot = patchDefinitionSlots(patched, scope.subgraphId, (sg) => ({
    ...sg,
    inputs: [
      ...(sg.inputs ?? []),
      {
        id: newBoundarySlotId((sg.inputs ?? []).map((entry) => entry.id ?? "")),
        name: boundaryName,
        type: String(slot.type ?? "*"),
        linkIds: [newLinkId],
      },
    ],
  }));
  if (!withSlot) return;

  // Rebuild every instance's slot list from the definition, the way load does,
  // so each placeholder gains the new port.
  set({
    workflow: reconcileInstanceWidgetValues(
      normalizeSubgraphPlaceholders(withRebuiltLinkIds(withSlot, scope.subgraphId)),
      scope.subgraphId,
      get().nodeTypes,
      previousBoundaryNames,
    ),
  });
};

// Promote a widget directly from its node card. Unlike addBoundaryInput, this
// accepts a widget identity rather than an already-materialized input slot.
const promoteWidget: WorkflowState["promoteWidget"] = (target, options) => {
  // Which form the promotion takes is decided here and expressed as the
  // presence of `widget` on the inner slot; everything downstream — the
  // widgets_values index, whether the placeholder draws a control or a socket —
  // is derived from it.
  const form: PromotedWidgetForm = options?.form ?? "widget";
  const { workflow, scopeStack } = get();
  if (!workflow) return false;
  const scope = currentSubgraphScope(workflow, scopeStack);
  if (!scope) return false;
  // The order an instance's values were written against, needed to read them
  // back by name once the boundary has changed under them.
  const previousBoundaryNames = boundaryWidgetNames(
    (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId),
  );
  const definition = (workflow.definitions?.subgraphs ?? []).find(
    (candidate) => candidate.id === scope.subgraphId,
  );
  if (!definition) return false;

  const node = resolveNodeByHierarchicalKey(scope.nodes, target.nodeKey);
  const inputName = target.inputName.trim();
  if (!node || !inputName) return false;

  let inputSlot = node.inputs.findIndex(
    (input) => input.name === inputName || input.widget?.name === inputName,
  );
  const existingInput = inputSlot >= 0 ? node.inputs[inputSlot] : null;
  // A local connection or an existing boundary connection means this widget
  // is no longer available to promote.
  if (existingInput?.link != null) return false;

  const inputType = String(existingInput?.type ?? target.inputType ?? "*");
  if (inputSlot < 0) inputSlot = node.inputs.length;
  const boundaryName = uniqueBoundaryName(
    (definition.inputs ?? []).map((entry) => entry.name ?? ""),
    inputName,
  );
  const boundarySlot = (definition.inputs ?? []).length;
  const newLinkId = scope.linkIdBase + 1;

  const nextNodes = scope.nodes.map((candidate) => {
    if (candidate.id !== node.id) return candidate;
    const inputs = [...candidate.inputs];
    const materialized: WorkflowNode["inputs"][number] = {
      ...(existingInput ?? {}),
      name: existingInput?.name ?? inputName,
      type: inputType,
      link: newLinkId,
    };
    if (form === "widget") materialized.widget = { name: inputName };
    else delete materialized.widget;
    if (existingInput) inputs[inputSlot] = materialized;
    else inputs.push(materialized);
    return { ...candidate, inputs };
  });

  const patchedScope = scope.applyPatch(workflow, {
    nodes: nextNodes,
    links: [
      ...scope.links,
      {
        id: newLinkId,
        origin_id: SUBGRAPH_INPUT_NODE_ID,
        origin_slot: boundarySlot,
        target_id: node.id,
        target_slot: inputSlot,
        type: inputType,
      },
    ],
  });
  const withSlot = patchDefinitionSlots(patchedScope, scope.subgraphId, (subgraph) => ({
    ...subgraph,
    inputs: [
      ...(subgraph.inputs ?? []),
      {
        id: newBoundarySlotId((subgraph.inputs ?? []).map((entry) => entry.id ?? "")),
        name: boundaryName,
        type: inputType,
        linkIds: [newLinkId],
      },
    ],
  }));
  if (!withSlot) return false;

  // Only a widget-form promotion owns a value on the placeholder. The socket
  // form leaves the value where it already lives, on the inner node. The
  // reconcile below gives the new entry its slot; this seeds it with the value
  // the widget was showing rather than the inner node's stored one, which can
  // differ when the promotion came from a card that had unsaved edits.
  const withInstanceValues = form === "widget"
    ? appendPromotedWidgetToInstances(
        withSlot,
        scope.subgraphId,
        boundaryName,
        target.value,
      )
    : withSlot;
  set({
    workflow: reconcileInstanceWidgetValues(
      normalizeSubgraphPlaceholders(withRebuiltLinkIds(withInstanceValues, scope.subgraphId)),
      scope.subgraphId,
      get().nodeTypes,
      // A widget-form promotion has already placed its value at the index the
      // NEW boundary gives it, so the array is in the new order and must be read
      // that way. Only the socket form leaves the array as it was written, in
      // the order the boundary had before this edit.
      form === "widget" ? undefined : previousBoundaryNames,
    ),
  });
  return true;
};

/**
 * Move one boundary input to another position in the definition's list.
 *
 * The order is the definition's, so this moves the slot for every instance of
 * the type: the placeholder's sockets and its promoted widgets both follow it.
 *
 * Only the definition and the links inside it are rewritten here. Reconciling
 * each placeholder's own slots — and the OUTER links that address them by index
 * — is `normalizeSubgraphPlaceholders`'s job, which matches old slots to new by
 * name and is the one place that logic should live. Remapping them here as well
 * would move every outer link twice.
 */
const moveBoundarySlot: WorkflowState["moveBoundarySlot"] = (
  direction,
  fromIndex,
  toIndex,
  options,
) => {
  const { workflow, scopeStack } = get();
  if (!workflow) return false;
  const scope = targetSubgraphScope(workflow, scopeStack, options?.subgraphId);
  if (!scope) return false;
  // The order an instance's values were written against, needed to read them
  // back by name once the boundary has changed under them.
  const previousBoundaryNames = boundaryWidgetNames(
    (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId),
  );
  const definition = (workflow.definitions?.subgraphs ?? []).find(
    (candidate) => candidate.id === scope.subgraphId,
  );
  if (!definition) return false;

  const slots = (direction === "input" ? definition.inputs : definition.outputs) ?? [];
  if (
    fromIndex === toIndex
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= slots.length
    || toIndex >= slots.length
  ) {
    return false;
  }

  const reordered = [...slots];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  // old slot index → new slot index, for the links inside the definition.
  const oldToNew = new Map<number, number>();
  reordered.forEach((slot, newIndex) => {
    const oldIndex = slots.indexOf(slot);
    if (oldIndex >= 0) oldToNew.set(oldIndex, newIndex);
  });

  const sentinel = direction === "input" ? SUBGRAPH_INPUT_NODE_ID : SUBGRAPH_OUTPUT_NODE_ID;
  const nextLinks = scope.links.map((link) => {
    if (direction === "input") {
      if (link.origin_id !== sentinel) return link;
      const next = oldToNew.get(link.origin_slot);
      return next === undefined || next === link.origin_slot
        ? link
        : { ...link, origin_slot: next };
    }
    if (link.target_id !== sentinel) return link;
    const next = oldToNew.get(link.target_slot);
    return next === undefined || next === link.target_slot
      ? link
      : { ...link, target_slot: next };
  });

  const widgetNamesFor = (
    entries: typeof slots,
    definitionForWidgets: WorkflowSubgraphDefinition,
  ) =>
    entries.flatMap((slot, index) =>
      !slot.name
        || getSubgraphBoundaryWidgetIndexForSlot(definitionForWidgets, index) === null
        ? []
        : [slot.name],
    );

  const patched = scope.applyPatch(workflow, { links: nextLinks as WorkflowSubgraphLink[] });
  const withOrder = patchDefinitionSlots(patched, scope.subgraphId, (sg) =>
    direction === "input" ? { ...sg, inputs: reordered } : { ...sg, outputs: reordered },
  );
  if (!withOrder) return false;

  let next = withRebuiltLinkIds(withOrder, scope.subgraphId);
  let movedValuesAlready = false;
  if (direction === "input") {
    const nextDefinition = (next.definitions?.subgraphs ?? []).find(
      (candidate) => candidate.id === scope.subgraphId,
    );
    if (nextDefinition) {
      next = reorderInstancePromotedValues(next, scope.subgraphId, {
        oldWidgetNames: widgetNamesFor(slots, definition),
        newWidgetNames: widgetNamesFor(reordered, nextDefinition),
        newBoundaryNames: reordered.flatMap((slot) => (slot.name ? [slot.name] : [])),
      });
      movedValuesAlready = true;
    }
  }

  set({
    workflow: reconcileInstanceWidgetValues(
      normalizeSubgraphPlaceholders(next),
      scope.subgraphId,
      get().nodeTypes,
      // NOT previousBoundaryNames. Every other boundary edit hands the
      // reconcile the order the instance's values were written against, so it
      // can carry them across by name. A reorder is the one edit that has
      // ALREADY moved them: reorderInstancePromotedValues just put them in the
      // new order. Naming the old order here made the reconcile move them a
      // second time — every widget ended up holding a neighbour's value, and
      // once the double shift walked a value off the end it was dropped as a
      // trailing empty, leaving a widget blank. Omitting it lets the reconcile
      // default to the boundary's current order, which is where they now are.
      movedValuesAlready ? undefined : previousBoundaryNames,
    ),
  });
  return true;
};

/**
 * Resolve the inner node, its promoted boundary slot, and the widget index the
 * node's own widgets_values uses for that widget — the three things both
 * `setPromotedWidgetForm` and `demoteWidget` need before they touch anything.
 */
function resolvePromotedTarget(
  workflow: Workflow,
  scope: SubgraphScope,
  nodeTypes: WorkflowState["nodeTypes"],
  target: { nodeKey: string; inputName: string },
) {
  const definition = (workflow.definitions?.subgraphs ?? []).find(
    (candidate) => candidate.id === scope.subgraphId,
  );
  const node = resolveNodeByHierarchicalKey(scope.nodes, target.nodeKey);
  const widgetName = target.inputName.trim();
  if (!definition || !node || !widgetName) return null;

  const slot = findPromotedWidgetSlot(definition, node.id, widgetName);
  if (!slot) return null;

  // Same resolution order expansion uses, so the value lands in the slot the
  // executed graph would read it from — and so a missing node definition falls
  // back to the node's own widget-id map rather than losing the value.
  const byName = (widget: { name: string; inputName?: string }) =>
    (widget.inputName ?? widget.name) === widgetName;
  const innerWidgetIndex =
    getNodePropertyWidgetIndexMap(node)?.[widgetName]
    ?? (nodeTypes
      ? (getWidgetDefinitions(nodeTypes, node).find(byName)
        ?? getInputWidgetDefinitions(nodeTypes, node).find(byName))?.widgetIndex
      : undefined)
    ?? null;

  return { definition, node, widgetName, slot, innerWidgetIndex };
}

/**
 * Switch a promoted widget between its two forms without unpromoting it: the
 * boundary input and anything wired to it from outside stay exactly as they
 * are, and only where the value lives changes.
 *
 * Going to `input`, the value the placeholder was holding is written back onto
 * the inner node so nothing silently reverts to whatever the shared definition
 * last held. Going to `widget`, the inner node's current value seeds the new
 * per-instance slot on every instance, so they all start where the type did.
 */
const setPromotedWidgetForm: WorkflowState["setPromotedWidgetForm"] = (target, form) => {
  const { workflow, scopeStack, nodeTypes } = get();
  if (!workflow) return false;
  const scope = currentSubgraphScope(workflow, scopeStack);
  if (!scope) return false;
  // The order an instance's values were written against, needed to read them
  // back by name once the boundary has changed under them.
  const previousBoundaryNames = boundaryWidgetNames(
    (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId),
  );
  const resolved = resolvePromotedTarget(workflow, scope, nodeTypes, target);
  if (!resolved) return false;
  const { definition, node, widgetName, slot, innerWidgetIndex } = resolved;
  if (slot.form === form) return false;

  const currentFrame = scopeStack[scopeStack.length - 1];
  const instanceNodeId = currentFrame?.type === "subgraph" ? currentFrame.placeholderNodeId : null;

  // Read the widgets_values index while the definition still describes the old
  // form: it is derived from the inner slot this call is about to rewrite.
  const previousWidgetIndex = getSubgraphBoundaryWidgetIndexForSlot(definition, slot.boundarySlot);
  const promotedValue = previousWidgetIndex == null
    ? undefined
    : readInstancePromotedValue(workflow, scope.subgraphId, instanceNodeId, slot.boundarySlot, parentDefinitionId(scopeStack));

  const nextNodes = scope.nodes.map((candidate) => {
    if (candidate.id !== node.id) return candidate;
    const inputs = [...candidate.inputs];
    const input = { ...inputs[slot.targetSlot] };
    if (form === "widget") input.widget = { name: widgetName };
    else delete input.widget;
    inputs[slot.targetSlot] = input;
    const next = { ...candidate, inputs };
    // Carry the placeholder's value home before the slot that held it goes.
    return form === "input" && promotedValue !== undefined
      ? setInnerWidgetValue(next, widgetName, innerWidgetIndex, promotedValue)
      : next;
  });

  const patched = scope.applyPatch(workflow, { nodes: nextNodes });

  // No manual insert or splice here: whether this boundary still owns a value
  // is a property of the DEFINITION after the change — a fan-out whose other
  // target is still a widget keeps its value — and the reconcile below reads it
  // from there. Doing it by hand removed values a fan-out still owned.
  const withValues = patched;

  set({
    workflow: reconcileInstanceWidgetValues(
      normalizeSubgraphPlaceholders(withRebuiltLinkIds(withValues, scope.subgraphId)),
      scope.subgraphId,
      nodeTypes,
      previousBoundaryNames,
    ),
  });
  return true;
};

/**
 * Unpromote a whole boundary input, from outside the subgraph.
 *
 * The inside route works widget by widget, because in there a fan-out is
 * visible as several rows and demoting one of them should leave the others
 * promoted. Outside there is one row for the slot, so this releases every inner
 * widget it drives and then drops the slot.
 *
 * `instanceNodeId` is the instance whose value comes home. Every other
 * instance's value for this slot is discarded — there is one inner widget and
 * it can hold one value — which is why the caller is expected to have asked
 * about that first.
 */
function demoteBoundarySlot(
  scope: SubgraphScope,
  boundarySlot: number,
  instanceNodeId: number | null,
  parentSubgraphId?: string | null,
): boolean {
  const { workflow, nodeTypes } = get();
  if (!workflow) return false;
  const definition = (workflow.definitions?.subgraphs ?? []).find(
    (candidate) => candidate.id === scope.subgraphId,
  );
  if (!definition || !definition.inputs?.[boundarySlot]) return false;
  if (!resolvePromotedInstance(workflow, scope.subgraphId, instanceNodeId, parentSubgraphId)) return false;
  // Read the value while the definition still describes the promotion: the
  // widgets_values index is derived from the boundary this is about to drop.
  const promotedValue = getSubgraphBoundaryWidgetIndexForSlot(definition, boundarySlot) == null
    ? undefined
    : readInstancePromotedValue(workflow, scope.subgraphId, instanceNodeId, boundarySlot, parentSubgraphId);

  const interior = (definition.links ?? []).filter(
    (link) => link.origin_id === SUBGRAPH_INPUT_NODE_ID && link.origin_slot === boundarySlot,
  );
  if (interior.length === 0) return false;

  const byName = (widgetName: string) => (widget: { name: string; inputName?: string }) =>
    (widget.inputName ?? widget.name) === widgetName;
  const landed = new Map<number, { widgetName: string; targetSlot: number }[]>();
  for (const link of interior) {
    const node = (definition.nodes ?? []).find((candidate) => candidate.id === link.target_id);
    const input = node?.inputs?.[link.target_slot];
    const widgetName = input?.widget?.name ?? input?.name;
    if (!node || !widgetName) continue;
    landed.set(node.id, [
      ...(landed.get(node.id) ?? []),
      { widgetName, targetSlot: link.target_slot },
    ]);
  }
  if (landed.size === 0) return false;

  const nextNodes = scope.nodes.map((candidate) => {
    const writes = landed.get(candidate.id);
    if (!writes) return candidate;
    let next = candidate;
    for (const { widgetName, targetSlot } of writes) {
      if (promotedValue !== undefined) {
        // Same resolution order expansion uses, so the value lands where the
        // executed graph would read it from.
        const innerWidgetIndex =
          getNodePropertyWidgetIndexMap(next)?.[widgetName]
          ?? (nodeTypes
            ? (getWidgetDefinitions(nodeTypes, next).find(byName(widgetName))
              ?? getInputWidgetDefinitions(nodeTypes, next).find(byName(widgetName)))?.widgetIndex
            : undefined)
          ?? null;
        next = setInnerWidgetValue(next, widgetName, innerWidgetIndex, promotedValue);
      }
      // Restore socket-form widgets only when this node actually owns one.
      // A boundary can also fan out to link-only inputs of the same type.
      const ownsWidget = next.inputs[targetSlot]?.widget
        || getNodePropertyWidgetIndexMap(next)?.[widgetName] !== undefined
        || (nodeTypes && [...getWidgetDefinitions(nodeTypes, next), ...getInputWidgetDefinitions(nodeTypes, next)]
          .some(byName(widgetName)));
      if (ownsWidget) {
        const inputs = [...next.inputs];
        inputs[targetSlot] = { ...inputs[targetSlot], widget: { name: widgetName } };
        next = { ...next, inputs };
      }
    }
    return next;
  });

  set({ workflow: scope.applyPatch(workflow, { nodes: nextNodes }) });
  // Drops the slot, its links, the link references on the inner nodes, and the
  // widgets_values entry it owned on every instance.
  removeBoundarySlot("input", boundarySlot, { subgraphId: scope.subgraphId });

  return true;
}

/**
 * Undo a promotion outright: the boundary input and its link go, and the widget
 * returns to being an ordinary widget on the inner node, holding the value the
 * placeholder was showing.
 */
const demoteWidget: WorkflowState["demoteWidget"] = (target) => runUndoTransaction(() => {
  // Three writes — the value coming home, the slot removal, and clearing the
  // proxy entry it left behind — are one action to the user, so they record as
  // one undo step rather than three.
  const { workflow, scopeStack, nodeTypes } = get();
  if (!workflow) return false;
  const fromPlaceholder = "boundarySlot" in target;
  const scope = targetSubgraphScope(
    workflow,
    scopeStack,
    fromPlaceholder ? target.subgraphId : undefined,
  );
  if (!scope) return false;

  // From outside, the whole control goes: the card shows one row per boundary
  // slot, so unpromoting it has to release every inner widget that slot drives
  // rather than leaving the slot standing with one target fewer.
  if (fromPlaceholder) {
    return demoteBoundarySlot(scope, target.boundarySlot, target.instanceNodeId ?? null, target.parentSubgraphId);
  }

  const resolved = resolvePromotedTarget(workflow, scope, nodeTypes, target);
  if (!resolved) return false;
  const { definition, node, widgetName, slot, innerWidgetIndex } = resolved;
  const previousBoundaryNames = boundaryWidgetNames(definition);

  const currentFrame = scopeStack[scopeStack.length - 1];
  const instanceNodeId = currentFrame?.type === "subgraph" ? currentFrame.placeholderNodeId : null;
  // removeBoundarySlot below reconciles the instances; this index is only for
  // reading the value being carried home, before any of that happens.
  const widgetIndex = getSubgraphBoundaryWidgetIndexForSlot(definition, slot.boundarySlot);
  const promotedValue = widgetIndex == null
    ? undefined
    : readInstancePromotedValue(workflow, scope.subgraphId, instanceNodeId, slot.boundarySlot, parentDefinitionId(scopeStack));

  // Bring the value home first: removeBoundarySlot reads the definition it is
  // about to change, so it has to run against a workflow that still describes
  // the promotion. The value write touches only the inner node.
  if (promotedValue !== undefined || slot.form === "input") {
    const nextNodes = scope.nodes.map((candidate) => {
      if (candidate.id !== node.id) return candidate;
      const withWidget = promotedValue === undefined
        ? candidate
        : setInnerWidgetValue(candidate, widgetName, innerWidgetIndex, promotedValue);
      // A socket-form promotion left the slot without widget metadata; restore
      // it so the widget draws again once the link is gone.
      const inputs = [...withWidget.inputs];
      const input = { ...inputs[slot.targetSlot], widget: { name: widgetName } };
      inputs[slot.targetSlot] = input;
      return { ...withWidget, inputs };
    });
    set({ workflow: scope.applyPatch(workflow, { nodes: nextNodes }) });
  }

  // A boundary can feed several inner widgets at once. Demoting one of them is
  // about THIS widget, so the slot only goes when it was the last thing on it —
  // otherwise removeBoundarySlot would silently unpromote everyone else's
  // widget along with this one.
  const current = get().workflow;
  const currentDefinition = (current?.definitions?.subgraphs ?? []).find(
    (candidate) => candidate.id === scope.subgraphId,
  );
  const siblingLinks = (currentDefinition?.links ?? []).filter(
    (link) =>
      link.origin_id === SUBGRAPH_INPUT_NODE_ID
      && link.origin_slot === slot.boundarySlot
      && !(link.target_id === node.id && link.target_slot === slot.targetSlot),
  );

  if (current && currentDefinition && siblingLinks.length > 0) {
    const severed = (currentDefinition.links ?? []).find(
      (link) =>
        link.origin_id === SUBGRAPH_INPUT_NODE_ID
        && link.origin_slot === slot.boundarySlot
        && link.target_id === node.id
        && link.target_slot === slot.targetSlot,
    );
    const scopeNow = currentSubgraphScope(current, scopeStack);
    if (!scopeNow || !severed) return false;
    const patched = scopeNow.applyPatch(current, {
      nodes: scopeNow.nodes.map((candidate) =>
        candidate.id === node.id
          ? {
              ...candidate,
              inputs: candidate.inputs.map((input, index) =>
                index === slot.targetSlot ? { ...input, link: null } : input,
              ),
            }
          : candidate,
      ),
      links: scopeNow.links.filter(
        (link) => link.id !== severed.id,
      ) as WorkflowSubgraphLink[],
    });
    set({
      workflow: reconcileInstanceWidgetValues(
        normalizeSubgraphPlaceholders(withRebuiltLinkIds(patched, scope.subgraphId)),
        scope.subgraphId,
        nodeTypes,
        previousBoundaryNames,
      ),
    });
    return true;
  }

  // Drops the boundary slot, its links, the link references on the inner node,
  // and — for a widget-backed input — the widgets_values entry on every
  // instance.
  removeBoundarySlot("input", slot.boundarySlot);

  return true;
});

// Promote an inner node output into a new subgraph output slot. Unlike an
// input, the inner output keeps whatever else it already feeds — a source may
// fan out to the boundary and to inner consumers at once.
const addBoundaryOutput: WorkflowState["addBoundaryOutput"] = (source) => {
  const { workflow, scopeStack } = get();
  if (!workflow) return;
  const scope = currentSubgraphScope(workflow, scopeStack);
  if (!scope) return;
  // The order an instance's values were written against, needed to read them
  // back by name once the boundary has changed under them.
  const previousBoundaryNames = boundaryWidgetNames(
    (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId),
  );
  const def = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId);
  if (!def) return;

  const node = resolveNodeByHierarchicalKey(scope.nodes, source.nodeKey);
  const slot = node?.outputs?.[source.outputSlot];
  if (!node || !slot) return;

  const alreadyPromoted = scope.links.some(
    (link) =>
      link.target_id === SUBGRAPH_OUTPUT_NODE_ID &&
      link.origin_id === node.id &&
      link.origin_slot === source.outputSlot,
  );
  if (alreadyPromoted) return;

  const existingOutputs = def.outputs ?? [];
  const boundaryName = uniqueBoundaryName(
    existingOutputs.map((entry) => entry.name ?? ""),
    slot.label || slot.localized_name || slot.name || "output",
  );
  const slotIndex = existingOutputs.length;
  const newLinkId = scope.linkIdBase + 1;

  const nextNodes = scope.nodes.map((n) => {
    if (n.id !== node.id) return n;
    const outputs = [...n.outputs];
    const existing = outputs[source.outputSlot]?.links ?? [];
    outputs[source.outputSlot] = {
      ...outputs[source.outputSlot],
      links: [...existing, newLinkId],
    };
    return { ...n, outputs };
  });

  const patched = scope.applyPatch(workflow, {
    nodes: nextNodes,
    links: [
      ...scope.links,
      {
        id: newLinkId,
        origin_id: node.id,
        origin_slot: source.outputSlot,
        target_id: SUBGRAPH_OUTPUT_NODE_ID,
        target_slot: slotIndex,
        type: slot.type ?? "*",
      },
    ],
  });

  const withSlot = patchDefinitionSlots(patched, scope.subgraphId, (sg) => ({
    ...sg,
    outputs: [
      ...(sg.outputs ?? []),
      {
        id: newBoundarySlotId((sg.outputs ?? []).map((entry) => entry.id ?? "")),
        name: boundaryName,
        type: String(slot.type ?? "*"),
        linkIds: [newLinkId],
      },
    ],
  }));
  if (!withSlot) return;

  set({
    workflow: reconcileInstanceWidgetValues(
      normalizeSubgraphPlaceholders(withRebuiltLinkIds(withSlot, scope.subgraphId)),
      scope.subgraphId,
      get().nodeTypes,
      previousBoundaryNames,
    ),
  });
};

// Demote a boundary slot. Its links go, the slots after it shift down (so the
// remaining boundary links are re-pointed), and a widget-backed input also
// gives up the widgets_values entry it owned on every instance.
const removeBoundarySlot: WorkflowState["removeBoundarySlot"] = (
  direction,
  slotIndex,
  options,
) => {
  const { workflow, scopeStack } = get();
  if (!workflow) return;
  const scope = targetSubgraphScope(workflow, scopeStack, options?.subgraphId);
  if (!scope) return;
  // The order an instance's values were written against, needed to read them
  // back by name once the boundary has changed under them.
  const previousBoundaryNames = boundaryWidgetNames(
    (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId),
  );
  const def = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === scope.subgraphId);
  const slots = (direction === "input" ? def?.inputs : def?.outputs) ?? [];
  if (!def || !slots[slotIndex]) return;

  const removedLinkIds = new Set(
    scope.links
      .filter((link) =>
        direction === "input"
          ? link.origin_id === SUBGRAPH_INPUT_NODE_ID && link.origin_slot === slotIndex
          : link.target_id === SUBGRAPH_OUTPUT_NODE_ID && link.target_slot === slotIndex,
      )
      .map((link) => link.id),
  );

  const patched = scope.applyPatch(workflow, {
    nodes: pruneLinksFromNodes(scope.nodes, removedLinkIds),
    links: reindexBoundaryLinks(scope.links, direction, slotIndex),
  });

  const withoutSlot = patchDefinitionSlots(patched, scope.subgraphId, (sg) =>
    direction === "input"
      ? { ...sg, inputs: (sg.inputs ?? []).filter((_entry, index) => index !== slotIndex) }
      : { ...sg, outputs: (sg.outputs ?? []).filter((_entry, index) => index !== slotIndex) },
  );
  if (!withoutSlot) return;

  // The value and its proxy entry go with the slot, per instance and by name —
  // splicing by the boundary-order index took the wrong one whenever the
  // instance's proxy list held anything else.
  set({
    workflow: reconcileInstanceWidgetValues(
      normalizeSubgraphPlaceholders(withRebuiltLinkIds(withoutSlot, scope.subgraphId)),
      scope.subgraphId,
      get().nodeTypes,
      previousBoundaryNames,
    ),
  });
};


// Rename a boundary slot. The two scopes write to two different places, for a
// reason worth stating: the definition's `label` is ComfyUI's own field and is
// what every instance reads, while an instance override CANNOT live on the
// placeholder's matching slot — both stock's `configure` and our
// `normalizeSubgraphPlaceholders` rebuild those slots from the definition on
// load, so a label written there reverts on the next open. Overrides live in
// the placeholder's `properties`, keyed by slot name so adding or removing a
// slot does not shuffle them onto their neighbours.
const setBoundarySlotLabel: WorkflowState["setBoundarySlotLabel"] = (
  direction,
  slotIndex,
  label,
  scope,
  options,
) => {
  const { workflow, scopeStack } = get();
  if (!workflow) return;
  const top = scopeStack[scopeStack.length - 1];
  // Reachable from two places: from inside the subgraph, where the scope names
  // both the definition and the instance, and from a placeholder card outside
  // it, which names them explicitly. Requiring a subgraph scope made the second
  // route a silent no-op — the modal saved nothing and closed.
  const subgraphId = options?.subgraphId ?? (top?.type === "subgraph" ? top.id : null);
  if (!subgraphId) return;
  const def = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  const slot = (direction === "input" ? def?.inputs : def?.outputs)?.[slotIndex];
  if (!def || !slot) return;
  const trimmed = label.trim();

  if (scope === "definition") {
    const next = patchDefinitionSlots(workflow, def.id, (sg) => {
      const slots = (direction === "input" ? sg.inputs : sg.outputs) ?? [];
      const nextSlots = slots.map((entry, index) => {
        if (index !== slotIndex) return entry;
        if (!trimmed) {
          const rest = { ...entry };
          delete rest.label;
          return rest;
        }
        return { ...entry, label: trimmed };
      });
      return direction === "input" ? { ...sg, inputs: nextSlots } : { ...sg, outputs: nextSlots };
    });
    // Each placeholder carries a copy of the boundary's label on its slot
    // list; normalize so every instance shows the rename now rather than on
    // the next load.
    if (next) set({ workflow: normalizeSubgraphPlaceholders(next) });
    return;
  }

  // The instance is either the placeholder this scope was entered through —
  // which lives in the PARENT scope, not this one — or the one the caller
  // named, when the edit came from a card outside the subgraph.
  const slotName = slot.name;
  if (!slotName) return;
  const instanceNodeId = options?.instanceNodeId
    ?? (top?.type === "subgraph" ? top.placeholderNodeId : null);
  if (instanceNodeId == null) return;
  const parentScope = options?.instanceNodeId != null
    ? scopeContainingNode(workflow, instanceNodeId)
    : resolveCurrentScope(
        scopeStack[scopeStack.length - 2] ? scopeStack.slice(0, -1) : [{ type: "root" }],
        workflow,
      );
  const placeholder = parentScope?.nodes.find((n) => n.id === instanceNodeId);
  if (!parentScope || !placeholder || placeholder.type !== def.id) return;

  const key = slotLabelKey(direction, slotName);
  const labels = { ...getInstanceSlotLabels(placeholder) };
  if (trimmed) {
    labels[key] = trimmed;
  } else {
    delete labels[key];
  }

  const next = updateNodeInScope(workflow, parentScope, placeholder.id, (node) => {
    const properties = { ...(node.properties ?? {}) };
    if (Object.keys(labels).length === 0) {
      delete properties[MOBILE_SLOT_LABELS_PROPERTY];
    } else {
      properties[MOBILE_SLOT_LABELS_PROPERTY] = labels;
    }
    return { ...node, properties };
  });
  set({ workflow: next });
};

  return {
    connectBoundaryInput,
    connectBoundaryOutput,
    disconnectBoundaryLink,
    addBoundaryInput,
    addBoundaryOutput,
    promoteWidget,
    setPromotedWidgetForm,
    demoteWidget,
    moveBoundarySlot,
    removeBoundarySlot,
    setBoundarySlotLabel,
  };
}
