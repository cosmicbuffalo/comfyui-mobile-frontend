import type {
  Workflow,
  WorkflowInput,
  WorkflowLink,
  WorkflowNode,
  WorkflowOutput,
  WorkflowSubgraphLink,
} from '@/api/types';
import {
  MOBILE_INSTANCE_NUMBER_PROPERTY,
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
  getLinkType,
  getMobileDefMeta,
  makeScopeLink,
  resolveNodeByHierarchicalKey,
  resolveScopeForHierarchicalKey,
  withMobileDefMeta,
} from '@/utils/canonicalWorkflowOps';
import { areTypesCompatible } from '@/utils/connectionUtils';
import { MOBILE_SLOT_LABELS_PROPERTY } from '@/utils/boundarySlotLabels';
import {
  getPlaceholderValueIndexForBoundarySlot,
  getSubgraphBoundaryWidgetIndexForSlot,
  getSubgraphBoundaryWidgetSlots,
} from '@/utils/widgetDefinitions';

type ScopeLink = WorkflowLink | WorkflowSubgraphLink;

export interface ReplaceDrop {
  direction: 'input' | 'output';
  slotName: string;
  slotType: string;
  peerNodeTitle: string;
}

export interface ReplaceSubgraphResult {
  workflow: Workflow;
  nodeId: number;
  dropped: ReplaceDrop[];
}

interface SlotDescriptor {
  name: string;
  type: string;
}

/**
 * Map old slot indices onto new slot indices: pass 1 exact name match with a
 * compatible type, pass 2 first unclaimed slot of a compatible type in index
 * order. (Deliberately name-then-TYPE, not expansion's name-then-position —
 * positional correspondence across two different definitions is meaningless.)
 */
function buildReplacementSlotMap(
  oldSlots: SlotDescriptor[],
  newSlots: SlotDescriptor[],
): Map<number, number> {
  const map = new Map<number, number>();
  const claimed = new Set<number>();

  oldSlots.forEach((oldSlot, oldIndex) => {
    const byName = newSlots.findIndex(
      (candidate, i) =>
        !claimed.has(i) &&
        candidate.name === oldSlot.name &&
        areTypesCompatible(candidate.type, oldSlot.type),
    );
    if (byName >= 0) {
      map.set(oldIndex, byName);
      claimed.add(byName);
    }
  });
  oldSlots.forEach((oldSlot, oldIndex) => {
    if (map.has(oldIndex)) return;
    const byType = newSlots.findIndex(
      (candidate, i) => !claimed.has(i) && areTypesCompatible(candidate.type, oldSlot.type),
    );
    if (byType >= 0) {
      map.set(oldIndex, byType);
      claimed.add(byType);
    }
  });
  return map;
}

function slotName(slot: { label?: string; name?: string } | undefined, index: number): string {
  return slot?.name || slot?.label || `#${index}`;
}

function peerTitle(nodes: WorkflowNode[], nodeId: number): string {
  const peer = nodes.find((n) => n.id === nodeId);
  return peer?.title || peer?.type || `node ${nodeId}`;
}

/** Definition ids reachable from any placeholder, walking nested definitions. */
export function collectReachableSubgraphIds(workflow: Workflow): Set<string> {
  const defs = workflow.definitions?.subgraphs ?? [];
  const byId = new Map(defs.map((d) => [d.id, d]));
  const reachable = new Set<string>();
  const queue = (workflow.nodes ?? []).map((n) => n.type).filter((t) => byId.has(t));
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const inner of byId.get(id)?.nodes ?? []) {
      if (byId.has(inner.type)) queue.push(inner.type);
    }
  }
  return reachable;
}

/**
 * Replace one subgraph placeholder with an instance of another type. The node
 * keeps its id — layout position, bookmarks, and group membership survive —
 * while its slots are rebuilt from the target type and existing connections
 * are re-wired onto matching slots (name-then-type). Connections with no match
 * are dropped and reported. Nothing is deleted: the type swapped away from
 * survives with zero instances, the same as any other type.
 */
export function replaceSubgraphInstance(
  workflow: Workflow,
  itemKey: string,
  newDefId: string,
): ReplaceSubgraphResult | null {
  const defs = workflow.definitions?.subgraphs ?? [];
  const newDef = defs.find((d) => d.id === newDefId);
  if (!newDef) return null;

  const scope = resolveScopeForHierarchicalKey(workflow, itemKey);
  const node = resolveNodeByHierarchicalKey(scope.nodes, itemKey);
  if (!node) return null;
  const oldDef = defs.find((d) => d.id === node.type);
  if (!oldDef || oldDef.id === newDefId) return null;

  // Shape the new placeholder after an existing instance of the target type
  // when one survives anywhere (its inputs/outputs/properties/widgets_values
  // are the serialized truth for that type); otherwise derive from the
  // definition's boundary slots.
  const allNodes = [
    ...(workflow.nodes ?? []),
    ...defs.flatMap((d) => d.nodes ?? []),
  ];
  const templateInstance = allNodes.find((n) => n.type === newDefId && n.id !== node.id);

  const newInputs: WorkflowInput[] = templateInstance
    ? (templateInstance.inputs ?? []).map((inp) => ({ ...structuredClone(inp), link: null }))
    : (newDef.inputs ?? []).map((slot, slotIndex) => ({
        name: slot.name ?? '',
        type: slot.type ?? '*',
        link: null,
        // Widget-backedness is decided by the definition's own wiring (a
        // DYNAMICCOMBO boundary input is a widget, a STRING feeding a
        // forceInput socket is not) — never by the declared type name.
        ...(getSubgraphBoundaryWidgetIndexForSlot(newDef, slotIndex) !== null
          ? { widget: { name: slot.name ?? '' } }
          : {}),
      }));
  const newOutputs: WorkflowOutput[] = templateInstance
    ? (templateInstance.outputs ?? []).map((out) => ({ ...structuredClone(out), links: null }))
    : (newDef.outputs ?? []).map((slot) => ({
        name: slot.name ?? '',
        type: slot.type ?? '*',
        links: null,
      }));

  // Widget value carry-over, by slot name + type. Both sides are read through
  // the canonical accessors: which boundary inputs are widget-backed comes
  // from each definition's own wiring, and a placeholder that carries a
  // proxyWidgets list does not hold its values in boundary order — indexing
  // positionally would carry a neighbour's value under the wrong name.
  const oldValuesByName = new Map<string, { type: string; value: unknown }>();
  const oldValues = Array.isArray(node.widgets_values)
    ? (node.widgets_values as unknown[])
    : [];
  for (const { boundarySlot } of getSubgraphBoundaryWidgetSlots(oldDef)) {
    const slot = (oldDef.inputs ?? [])[boundarySlot];
    if (!slot?.name) continue;
    const valueIndex = getPlaceholderValueIndexForBoundarySlot(node, oldDef, boundarySlot);
    if (valueIndex === null) continue;
    oldValuesByName.set(slot.name, {
      type: String(slot.type ?? '*'),
      value: oldValues[valueIndex],
    });
  }

  const templateValues = Array.isArray(templateInstance?.widgets_values)
    ? (templateInstance.widgets_values as unknown[])
    : [];
  const readTemplateValue = (boundarySlot: number): unknown => {
    const valueIndex = getPlaceholderValueIndexForBoundarySlot(
      templateInstance,
      newDef,
      boundarySlot,
    );
    return valueIndex === null ? undefined : templateValues[valueIndex];
  };
  const carriedValueForSlot = (boundarySlot: number): unknown => {
    const slot = (newDef.inputs ?? [])[boundarySlot];
    const carried = slot?.name ? oldValuesByName.get(slot.name) : undefined;
    if (
      carried &&
      carried.value !== undefined &&
      areTypesCompatible(carried.type, String(slot?.type ?? '*'))
    ) {
      return carried.value;
    }
    return readTemplateValue(boundarySlot) ?? null;
  };

  // The replacement inherits the template instance's proxyWidgets list (below),
  // so its values must be written in THAT list's order; without a template (or
  // a list) the boundary-widget order is the serialized truth.
  const templateProxyWidgets = (() => {
    const raw = (templateInstance?.properties as Record<string, unknown> | undefined)
      ?.proxyWidgets;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw
      .filter((entry): entry is [unknown, unknown] => Array.isArray(entry) && entry.length >= 2)
      .map((entry): [string, string] => [String(entry[0]), String(entry[1])]);
  })();
  const boundarySlotByName = new Map<string, number>();
  (newDef.inputs ?? []).forEach((slot, index) => {
    if (slot.name) boundarySlotByName.set(slot.name, index);
  });
  const newWidgetsValues = templateProxyWidgets
    ? templateProxyWidgets.map((entry, index) => {
        if (entry[0] === '-1') {
          const boundarySlot = boundarySlotByName.get(entry[1]);
          if (boundarySlot !== undefined) return carriedValueForSlot(boundarySlot);
        }
        // Direct inner-widget entry (or an unmatched boundary name): seed
        // from the template's own value at the same list position.
        return templateValues[index] ?? null;
      })
    : getSubgraphBoundaryWidgetSlots(newDef).map(({ boundarySlot }) =>
        carriedValueForSlot(boundarySlot),
      );

  // Slot matching for connections.
  const inputMap = buildReplacementSlotMap(
    (node.inputs ?? []).map((inp) => ({ name: inp.name ?? '', type: String(inp.type ?? '*') })),
    newInputs.map((inp) => ({ name: inp.name ?? '', type: String(inp.type ?? '*') })),
  );
  const outputMap = buildReplacementSlotMap(
    (node.outputs ?? []).map((out) => ({ name: out.name ?? '', type: String(out.type ?? '*') })),
    newOutputs.map((out) => ({ name: out.name ?? '', type: String(out.type ?? '*') })),
  );

  const dropped: ReplaceDrop[] = [];
  const removedLinkIds = new Set<number>();
  const retargetedLinks = new Map<number, { slot: number }>();
  const reslottedOutLinks = new Map<number, { slot: number }>();

  (node.inputs ?? []).forEach((inp, oldIndex) => {
    if (inp.link == null) return;
    const newIndex = inputMap.get(oldIndex);
    if (newIndex != null) {
      retargetedLinks.set(inp.link, { slot: newIndex });
      newInputs[newIndex] = { ...newInputs[newIndex], link: inp.link };
    } else {
      removedLinkIds.add(inp.link);
      const link = scope.links.find((l) => getLinkId(l) === inp.link);
      dropped.push({
        direction: 'input',
        slotName: slotName(inp, oldIndex),
        slotType: String(inp.type ?? '*'),
        peerNodeTitle: link ? peerTitle(scope.nodes, getLinkOriginId(link)) : '',
      });
    }
  });
  (node.outputs ?? []).forEach((out, oldIndex) => {
    const linkIds = out.links ?? [];
    if (linkIds.length === 0) return;
    const newIndex = outputMap.get(oldIndex);
    if (newIndex != null) {
      for (const linkId of linkIds) reslottedOutLinks.set(linkId, { slot: newIndex });
      newOutputs[newIndex] = {
        ...newOutputs[newIndex],
        links: [...(newOutputs[newIndex].links ?? []), ...linkIds],
      };
    } else {
      for (const linkId of linkIds) {
        removedLinkIds.add(linkId);
        const link = scope.links.find((l) => getLinkId(l) === linkId);
        dropped.push({
          direction: 'output',
          slotName: slotName(out, oldIndex),
          slotType: String(out.type ?? '*'),
          peerNodeTitle: link ? peerTitle(scope.nodes, getLinkTargetId(link)) : '',
        });
      }
    }
  });

  // Rebuild the scope's link table.
  const nextLinks: ScopeLink[] = [];
  for (const link of scope.links) {
    const id = getLinkId(link);
    if (removedLinkIds.has(id)) continue;
    const retarget = retargetedLinks.get(id);
    const reslot = reslottedOutLinks.get(id);
    if (retarget || reslot) {
      nextLinks.push(
        makeScopeLink(
          id,
          getLinkOriginId(link),
          reslot ? reslot.slot : getLinkOriginSlot(link),
          getLinkTargetId(link),
          retarget ? retarget.slot : getLinkTargetSlot(link),
          getLinkType(link),
          scope.subgraphId,
        ),
      );
    } else {
      nextLinks.push(link);
    }
  }

  // Instance number from the target type's counter.
  const newMeta = getMobileDefMeta(newDef);
  const instanceNumber = newMeta.nextInstanceNumber ?? 2;

  // The replacement node: same id/position/size, slots and values from the
  // target type. properties come from the template instance (its proxyWidgets
  // etc. are valid for the new definition); the old node's properties refer to
  // the old definition and are dropped. The old title is dropped too — it
  // described the old subgraph.
  //
  // The template's per-instance slot labels are NOT inherited: they are that
  // instance's private naming, not part of the type, and adopting them would
  // give a brand-new instance someone else's overrides.
  const templateProperties = structuredClone(templateInstance?.properties ?? {});
  delete templateProperties[MOBILE_SLOT_LABELS_PROPERTY];
  const replacement: WorkflowNode = {
    ...node,
    type: newDefId,
    title: undefined,
    inputs: newInputs,
    outputs: newOutputs,
    widgets_values: newWidgetsValues,
    properties: {
      ...templateProperties,
      [MOBILE_INSTANCE_NUMBER_PROPERTY]: instanceNumber,
    },
  };

  const nextNodes = scope.nodes.map((n) => {
    if (n.id === node.id) return replacement;
    // Prune removed link ids from surviving peers.
    const inputsTouched = (n.inputs ?? []).some(
      (i) => i.link != null && removedLinkIds.has(i.link),
    );
    const outputsTouched = (n.outputs ?? []).some((o) =>
      o.links?.some((id) => removedLinkIds.has(id)),
    );
    if (!inputsTouched && !outputsTouched) return n;
    return {
      ...n,
      inputs: inputsTouched
        ? n.inputs.map((i) =>
            i.link != null && removedLinkIds.has(i.link) ? { ...i, link: null } : i,
          )
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

  let nextWorkflow = scope.applyPatch(workflow, {
    nodes: nextNodes,
    links: nextLinks as WorkflowLink[] | WorkflowSubgraphLink[],
  });

  // Bump the target type's instance counter.
  nextWorkflow = {
    ...nextWorkflow,
    definitions: {
      ...(nextWorkflow.definitions ?? {}),
      subgraphs: (nextWorkflow.definitions?.subgraphs ?? []).map((d) =>
        d.id === newDefId ? withMobileDefMeta(d, { nextInstanceNumber: instanceNumber + 1 }) : d,
      ),
    },
  };

  // Nothing is collected here. Every definition is a reusable type, and a type
  // is valid with zero live instances — swapping away the last instance of one
  // is not a reason to destroy it, any more than emptying a folder deletes it.
  // Deleting a type is its own action, in the subgraph types list.

  return { workflow: nextWorkflow, nodeId: node.id, dropped };
}
