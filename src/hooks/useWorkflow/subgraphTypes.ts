import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from "@/api/types";
import {
  MOBILE_INSTANCE_NUMBER_PROPERTY,
  getMobileDefMeta,
  maxNodeIdAcrossScopes,
  resolveNodeByHierarchicalKey,
  resolveScopeForHierarchicalKey,
  updateNodeInScope,
  withMobileDefMeta,
} from "@/utils/canonicalWorkflowOps";
import {
  collectReachableSubgraphIds,
  replaceSubgraphInstance as replaceSubgraphInstancePure,
} from "@/utils/replaceSubgraphInstance";
import { dissolveSubgraph } from "@/utils/dissolveSubgraph";
import { cloneSubgraphDefinition, generateUniqueSubgraphId } from "@/utils/duplicateNode";
import {
  MOBILE_SLOT_LABELS_PROPERTY,
  collectSubgraphInstances,
  getInstanceSlotLabels,
  proxyLabelKey,
  slotLabelKey,
} from "@/utils/boundarySlotLabels";
import {
  annotateWorkflowWithHierarchicalKeys,
  collectBypassSubgraphTargetNodes,
  layoutRecordFromPointerRecord,
  reconcilePointerRegistry,
} from "@/utils/workflowHierarchy";
import { buildLayoutForWorkflow, removeNodesFromWorkflow } from "./layoutOps";
import { normalizeSubgraphPlaceholders } from "@/utils/normalizeSubgraphPlaceholders";
import { reconcileScopeStack } from "@/utils/subgraphInstanceNavigation";
import { runUndoTransaction } from "@/utils/undoTransaction";
import type { WorkflowGet, WorkflowSet, WorkflowState } from "./state";

// Subgraph-type (shared definition) editing: every definition IS a type, so
// these act on something every placeholder has. Label templates live on the
// DEFINITION so every instance shares them; the {n} token interpolates each
// placeholder's instance number at render time (subgraphInstanceLabels.ts).

function patchDefinition(
  workflow: Workflow,
  subgraphId: string,
  patch: (def: WorkflowSubgraphDefinition) => WorkflowSubgraphDefinition,
): Workflow | null {
  const defs = workflow.definitions?.subgraphs ?? [];
  if (!defs.some((sg) => sg.id === subgraphId)) return null;
  return {
    ...workflow,
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: defs.map((sg) => (sg.id === subgraphId ? patch(sg) : sg)),
    },
  };
}

export function createSubgraphTypeActions(set: WorkflowSet, get: WorkflowGet) {

const setPromotedWidgetLabel: WorkflowState["setPromotedWidgetLabel"] = (
  subgraphId,
  target,
  label,
) => {
  const { workflow } = get();
  if (!workflow) return;
  const trimmed = label.trim();

  const next = patchDefinition(workflow, subgraphId, (sg) => {
    if (target.kind === "slot") {
      // Slot-promoted and boundary-only widget labels both live on the
      // definition's boundary input entry, matched by slot name.
      const inputs = (sg.inputs ?? []).map((slot) => {
        if (slot.name !== target.slotName) return slot;
        if (!trimmed) {
          const rest = { ...slot };
          delete rest.label;
          return rest;
        }
        return { ...slot, label: trimmed };
      });
      return { ...sg, inputs };
    }
    // Proxy widgets have no label field anywhere in the format — custom labels
    // live in the definition's mobile metadata, keyed "<innerNodeId>:<widgetName>".
    const key = `${target.innerNodeId}:${target.widgetName}`;
    const proxyLabels = { ...(getMobileDefMeta(sg).proxyLabels ?? {}) };
    if (!trimmed) {
      delete proxyLabels[key];
    } else {
      proxyLabels[key] = trimmed;
    }
    return withMobileDefMeta(sg, { proxyLabels });
  });
  // Re-seat the instances: each placeholder carries a copy of the boundary's
  // label, and desktop reads that copy rather than the definition. Leaving it
  // behind means the rename shows here and nowhere else.
  if (next) set({ workflow: normalizeSubgraphPlaceholders(next) });
};

// The instance-scoped counterpart of setPromotedWidgetLabel. Where that writes
// the type's shared label, this writes ONE placeholder's own — into its
// properties, the only place a definition rebuild leaves alone.
const setInstanceWidgetLabel: WorkflowState["setInstanceWidgetLabel"] = (
  itemKey,
  target,
  label,
) => {
  const { workflow } = get();
  if (!workflow) return;
  const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
  const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
  if (!node) return;

  const key =
    target.kind === "slot"
      ? slotLabelKey(target.direction, target.slotName)
      : proxyLabelKey(target.innerNodeId, target.widgetName);
  const trimmed = label.trim();
  const labels = { ...getInstanceSlotLabels(node) };
  if (trimmed) {
    labels[key] = trimmed;
  } else {
    delete labels[key];
  }
  if (JSON.stringify(labels) === JSON.stringify(getInstanceSlotLabels(node))) return;

  set({
    workflow: updateNodeInScope(workflow, scope, node.id, (n) => {
      const properties = { ...(n.properties ?? {}) };
      if (Object.keys(labels).length === 0) {
        delete properties[MOBILE_SLOT_LABELS_PROPERTY];
      } else {
        properties[MOBILE_SLOT_LABELS_PROPERTY] = labels;
      }
      return { ...n, properties };
    }),
  });
};

// "Replace Subgraph": swap a placeholder for an instance of another type.
// Returns the dropped-connection summary for the UI, or null if nothing was
// replaced. Structure changes (node slots, possibly GC'd definitions), so the
// layout is rebuilt and keys re-annotated in the same single set().
const replaceSubgraphInstance: WorkflowState["replaceSubgraphInstance"] = (
  itemKey,
  newDefId,
) => {
  const { workflow, hiddenItems, itemKeyByPointer, pointerByHierarchicalKey } = get();
  if (!workflow) return null;

  const result = replaceSubgraphInstancePure(workflow, itemKey, newDefId);
  if (!result) return null;

  // Rebuild placeholder slot lists from the definitions the way load does, so
  // the swapped instance's widget markers and slot labels match its new type.
  const normalized = normalizeSubgraphPlaceholders(result.workflow);
  const nextLayout = buildLayoutForWorkflow(
    normalized,
    layoutRecordFromPointerRecord(hiddenItems, pointerByHierarchicalKey),
  );
  const reconciled = reconcilePointerRegistry(
    nextLayout,
    itemKeyByPointer,
    pointerByHierarchicalKey,
  );
  const annotated = annotateWorkflowWithHierarchicalKeys(
    normalized,
    reconciled.layoutToStable,
  );
  set({
    workflow: annotated,
    mobileLayout: nextLayout,
    itemKeyByPointer: reconciled.layoutToStable,
    pointerByHierarchicalKey: reconciled.stableToLayout,
  });
  return result.dropped;
};

// "Fork Subgraph": deep-copy the definition into a new type and repoint the
// chosen instances at it. The instances left behind keep the original, so the
// two sets can now diverge — which is the whole point of forking rather than
// editing in place.
//
// Nested definitions are NOT copied: both types go on referencing the same
// ones, exactly as duplicating a placeholder does. Only the forked type's own
// body is private to it.
const forkSubgraphType: WorkflowState["forkSubgraphType"] = (
  subgraphId,
  instanceNodeIds,
  name,
) => {
  const { workflow, hiddenItems, itemKeyByPointer, pointerByHierarchicalKey } = get();
  if (!workflow) return null;
  const defs = workflow.definitions?.subgraphs ?? [];
  const source = defs.find((sg) => sg.id === subgraphId);
  if (!source) return null;

  const moving = new Set(
    collectSubgraphInstances(workflow, subgraphId)
      .filter(({ node }) => instanceNodeIds.includes(node.id))
      .map(({ node }) => node.id),
  );
  if (moving.size === 0) return null;

  const newId = generateUniqueSubgraphId(defs);
  const { def: forked, nodeIdMap } = cloneSubgraphDefinition(
    source,
    newId,
    maxNodeIdAcrossScopes(workflow) + 1,
  );
  const trimmed = name.trim();

  // A direct proxyWidgets entry names an inner node by id, and the clone just
  // re-minted every inner id — without following the map, the forked
  // instance's promoted inner widgets resolve to nothing and silently
  // disappear from the card while their values stay orphaned in the file.
  const remapProxyWidgets = (properties: WorkflowNode["properties"]) => {
    const raw = (properties as Record<string, unknown> | undefined)?.proxyWidgets;
    if (!Array.isArray(raw)) return {};
    return {
      proxyWidgets: raw.map((entry) => {
        if (!Array.isArray(entry) || entry.length < 2) return entry;
        const mapped = nodeIdMap.get(Number(entry[0]));
        return mapped != null ? [String(mapped), ...entry.slice(1)] : entry;
      }),
    };
  };

  let next: Workflow | null = null;
  runUndoTransaction(() => {
    // The fork is a shared type from birth: it was forked FROM one, and the
    // instances moving onto it may be several.
    let counter = 1;
    const repoint = (node: WorkflowNode): WorkflowNode =>
      node.type === subgraphId && moving.has(node.id)
        ? {
            ...node,
            type: newId,
            properties: {
              ...(node.properties ?? {}),
              ...remapProxyWidgets(node.properties),
              [MOBILE_INSTANCE_NUMBER_PROPERTY]: counter++,
            },
          }
        : node;

    let patched: Workflow = {
      ...workflow,
      nodes: (workflow.nodes ?? []).map(repoint),
      definitions: {
        ...(workflow.definitions ?? {}),
        subgraphs: [
          ...defs.map((sg) => ({ ...sg, nodes: (sg.nodes ?? []).map(repoint) })),
          withMobileDefMeta(
            { ...forked, ...(trimmed ? { name: trimmed } : {}) },
            { nextInstanceNumber: moving.size + 1 },
          ),
        ],
      },
    };

    const nextLayout = buildLayoutForWorkflow(
      patched,
      layoutRecordFromPointerRecord(hiddenItems, pointerByHierarchicalKey),
    );
    const reconciled = reconcilePointerRegistry(
      nextLayout,
      itemKeyByPointer,
      pointerByHierarchicalKey,
    );
    patched = annotateWorkflowWithHierarchicalKeys(patched, reconciled.layoutToStable);
    next = patched;
    set({
      workflow: patched,
      mobileLayout: nextLayout,
      itemKeyByPointer: reconciled.layoutToStable,
      pointerByHierarchicalKey: reconciled.stableToLayout,
    });
  });

  return next ? newId : null;
};

// Rename a subgraph type. The name lives on the definition, so every instance
// re-titles at once; `{n}` in the name renders each instance's own number.
const renameSubgraphType: WorkflowState["renameSubgraphType"] = (subgraphId, name) => {
  const { workflow } = get();
  if (!workflow) return;
  const trimmed = name.trim();
  // A blank or unchanged name is a genuine no-op: writing a fresh workflow
  // object would dirty the tab and churn subscribers for nothing.
  if (!trimmed) return;
  const current = (workflow.definitions?.subgraphs ?? []).find((sg) => sg.id === subgraphId);
  if (!current || current.name === trimmed) return;
  const next = patchDefinition(workflow, subgraphId, (sg) => ({ ...sg, name: trimmed }));
  if (next) set({ workflow: next });
};

/** Drop definitions nothing references any more (the type plus any nested
 *  definitions only it used). Promoted types are NOT spared here — unlike
 *  Replace, deleting a type is an explicit request to remove it. */
function garbageCollectDefinitions(workflow: Workflow, removedId: string): Workflow {
  const defs = workflow.definitions?.subgraphs ?? [];
  const byId = new Map(defs.map((d) => [d.id, d]));
  // Candidates: the removed type and its nested closure only.
  const candidates = new Set<string>();
  const queue = [removedId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (candidates.has(id)) continue;
    candidates.add(id);
    for (const inner of byId.get(id)?.nodes ?? []) {
      if (byId.has(inner.type)) queue.push(inner.type);
    }
  }
  const reachable = collectReachableSubgraphIds(workflow);
  const survivors = defs.filter((d) => !candidates.has(d.id) || reachable.has(d.id));
  if (survivors.length === defs.length) return workflow;
  return {
    ...workflow,
    definitions: { ...(workflow.definitions ?? {}), subgraphs: survivors },
  };
}

// Delete a subgraph type. With no instances it simply drops the definition.
// With instances, `mode` decides their fate: 'dissolve' promotes each
// instance's inner nodes into its parent scope (wiring bridged across the
// boundary, promoted widget values baked in); 'delete' removes the instances
// outright. Either way the definition — and any nested definition only it
// referenced — is then collected.
const deleteSubgraphType: WorkflowState["deleteSubgraphType"] = (subgraphId, mode) => {
  const { workflow, hiddenItems, itemKeyByPointer, pointerByHierarchicalKey, nodeTypes } = get();
  if (!workflow) return;
  const defs = workflow.definitions?.subgraphs ?? [];
  if (!defs.some((sg) => sg.id === subgraphId)) return;

  runUndoTransaction(() => {
    let next: Workflow = workflow;

    // Instances of a type are not all at root: a shared type can be
    // instantiated inside another subgraph, and both modes used to walk root
    // alone — so a type whose only instances were nested reported as "in use"
    // and then neither dissolved nor deleted any of them.
    const instanceScopes = () =>
      new Set(
        collectSubgraphInstances(next, subgraphId).map(
          ({ parentSubgraphId }) => parentSubgraphId,
        ),
      );

    if (collectSubgraphInstances(next, subgraphId).length > 0) {
      if (mode === "dissolve") {
        // dissolveSubgraph handles every placeholder of the definition within
        // ONE parent scope, so it runs once per scope holding an instance.
        for (const parentSubgraphId of instanceScopes()) {
          const dissolved = dissolveSubgraph(next, subgraphId, parentSubgraphId, nodeTypes);
          if (dissolved) next = dissolved.workflow;
        }
      } else {
        const targets = collectBypassSubgraphTargetNodes(next, subgraphId);
        const placeholders = collectSubgraphInstances(next, subgraphId).map(
          ({ node, parentSubgraphId }) => ({ nodeId: node.id, subgraphId: parentSubgraphId }),
        );
        next = removeNodesFromWorkflow(next, [...targets, ...placeholders]);
      }
    }
    next = garbageCollectDefinitions(next, subgraphId);
    if (next === workflow) return;

    const nextLayout = buildLayoutForWorkflow(
      next,
      layoutRecordFromPointerRecord(hiddenItems, pointerByHierarchicalKey),
    );
    const reconciled = reconcilePointerRegistry(
      nextLayout,
      itemKeyByPointer,
      pointerByHierarchicalKey,
    );
    set({
      workflow: annotateWorkflowWithHierarchicalKeys(next, reconciled.layoutToStable),
      mobileLayout: nextLayout,
      itemKeyByPointer: reconciled.layoutToStable,
      pointerByHierarchicalKey: reconciled.stableToLayout,
      // The type list is reachable from inside a subgraph, so this can delete
      // the scope the user is standing in. Without this they are left looking
      // at an empty list under a breadcrumb for a subgraph that is gone.
      scopeStack: reconcileScopeStack(get().scopeStack, next),
    });
  });
};

  return {
    setPromotedWidgetLabel,
    setInstanceWidgetLabel,
    forkSubgraphType,
    replaceSubgraphInstance,
    renameSubgraphType,
    deleteSubgraphType,
  };
}
