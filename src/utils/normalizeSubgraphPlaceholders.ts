import type {
  Workflow,
  WorkflowInput,
  WorkflowLink,
  WorkflowNode,
  WorkflowOutput,
  WorkflowSubgraphDefinition,
  WorkflowSubgraphLink,
} from '@/api/types';
import { buildSlotMap } from '@/utils/expandWorkflowSubgraphs';
import { getSubgraphBoundaryWidgetIndexForSlot } from '@/utils/widgetDefinitions';
import { migrateProxyWidgets } from '@/utils/migrateProxyWidgets';

/**
 * Rebuild every subgraph placeholder's `inputs[]`/`outputs[]` from its
 * definition's boundary lists, the way ComfyUI does on load.
 *
 * `SubgraphNode.configure` never trusts the serialized slot arrays: it clears
 * them, repopulates from `subgraph.inputNode.slots` / `outputNode.slots`, and
 * only then merges the serialized entries back in for their links
 * (`_rebindInputSubgraphSlots`). The serialized arrays are therefore free to be
 * a stale, shorter subset of the real boundary — and in shipped templates they
 * routinely are. The Krea-2 template's placeholder lists 10 inputs for 14
 * boundary slots, starting at boundary slot 1.
 *
 * Doing the same here retires that mismatch at the front door instead of making
 * every downstream consumer compensate for it: after this pass a placeholder's
 * slot indices ARE boundary indices, promoted-widget order IS
 * `widgets_values` order, and the boundary-only widget mechanism has nothing
 * left to cover.
 *
 * Runs at load, before the dirty-check baseline is snapshotted, so a normalized
 * workflow does not read as modified.
 */
export function normalizeSubgraphPlaceholders(input: Workflow): Workflow {
  // `properties.proxyWidgets` is the legacy widget list, and stock retires it on
  // load by turning each entry into a real boundary input. Doing the same here,
  // before anything reads the boundary, leaves ONE order for promoted widgets
  // instead of two that have to be kept in agreement. Idempotent: a workflow
  // with no proxy list comes straight back out, so this is free on every later
  // call.
  const workflow = migrateProxyWidgets(input).workflow;
  const definitions = workflow.definitions?.subgraphs;
  if (!definitions?.length) return workflow;

  const byId = new Map<string, WorkflowSubgraphDefinition>(
    definitions.map((definition) => [definition.id, definition]),
  );

  // Innermost first, and the map is updated as we go. Whether a boundary input
  // backs a widget is read from the inner node it feeds — and when that node is
  // itself a placeholder, the answer only becomes true once IT has been
  // normalized. Doing the root first read those definitions half-built and left
  // the outermost placeholder missing markers its own boundary had earned; the
  // widgets then fell through to the boundary-only mechanism and rendered as
  // blank, editable fields beside the connections that actually feed them.
  let subgraphsChanged = false;
  const normalized = new Map<string, WorkflowSubgraphDefinition>();
  for (const definition of orderInnermostFirst(definitions)) {
    const scope = normalizeScope(definition.nodes ?? [], definition.links ?? [], byId);
    if (!scope.changed) continue;
    subgraphsChanged = true;
    const next = {
      ...definition,
      nodes: scope.nodes,
      links: scope.links as WorkflowSubgraphLink[],
    };
    normalized.set(definition.id, next);
    byId.set(definition.id, next);
  }
  const subgraphs = definitions.map((definition) => normalized.get(definition.id) ?? definition);

  const root = normalizeScope(workflow.nodes, workflow.links ?? [], byId);

  if (!root.changed && !subgraphsChanged) return workflow;

  return {
    ...workflow,
    nodes: root.nodes,
    links: root.links as WorkflowLink[],
    ...(subgraphsChanged
      ? { definitions: { ...workflow.definitions, subgraphs } }
      : {}),
  };
}

/**
 * Where a link's slot index lands once the placeholder is re-seated.
 *
 * The remap is built from the slots the placeholder was carrying, so it only
 * covers indices that list actually had. An index past the end is not garbage
 * by default: it is what a caller that rewired against the DEFINITION writes,
 * having left the placeholder's own list for this pass to rebuild — moving
 * nodes into a subgraph does exactly that, addressing the output slots the move
 * just added. Read in the old list's terms those indices do not exist, and
 * dropping them threw away every connection the moved nodes were still feeding.
 *
 * So an index the remap does not cover is taken at face value when the
 * definition has a slot there, and only treated as dead when it does not.
 */
function resolveSlot(
  slot: number,
  remap: Map<number, number>,
  definitionSlotCount: number,
  oldSlotCount: number,
): number | undefined {
  const mapped = remap.get(slot);
  if (mapped !== undefined) return mapped;
  // An index the placeholder DID carry, left unmapped, means the slot it named
  // is gone from the definition — a deletion. Taking it at face value would
  // hand the link to whichever slot has shuffled into that position, which is
  // how a prompt ends up feeding an unrelated input. Only an index beyond the
  // old list gets the benefit of the doubt.
  if (slot >= 0 && slot < oldSlotCount) return undefined;
  return slot >= 0 && slot < definitionSlotCount ? slot : undefined;
}

/**
 * Definitions ordered so that anything nested comes before what nests it.
 *
 * Subgraphs cannot contain themselves, so this is a DAG; a malformed file that
 * says otherwise is left in its original order for the ids on the cycle rather
 * than looped over forever.
 */
function orderInnermostFirst(
  definitions: WorkflowSubgraphDefinition[],
): WorkflowSubgraphDefinition[] {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const ordered: WorkflowSubgraphDefinition[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (definition: WorkflowSubgraphDefinition) => {
    if (state.get(definition.id)) return;
    state.set(definition.id, 'visiting');
    for (const node of definition.nodes ?? []) {
      const inner = byId.get(node.type);
      if (inner && state.get(inner.id) !== 'visiting') visit(inner);
    }
    state.set(definition.id, 'done');
    ordered.push(definition);
  };

  definitions.forEach(visit);
  return ordered;
}

type AnyLink = WorkflowLink | WorkflowSubgraphLink;

function readLink(link: AnyLink) {
  return Array.isArray(link)
    ? {
        id: link[0],
        originId: link[1],
        originSlot: link[2],
        targetId: link[3],
        targetSlot: link[4],
      }
    : {
        id: link.id,
        originId: link.origin_id,
        originSlot: link.origin_slot,
        targetId: link.target_id,
        targetSlot: link.target_slot,
      };
}

function withSlots(link: AnyLink, originSlot: number, targetSlot: number): AnyLink {
  if (Array.isArray(link)) {
    const next: WorkflowLink = [...link];
    next[2] = originSlot;
    next[4] = targetSlot;
    return next;
  }
  return { ...link, origin_slot: originSlot, target_slot: targetSlot };
}

interface ScopeResult {
  nodes: WorkflowNode[];
  links: AnyLink[];
  changed: boolean;
}

function normalizeScope(
  nodes: WorkflowNode[],
  links: AnyLink[],
  byId: Map<string, WorkflowSubgraphDefinition>,
): ScopeResult {
  const placeholders = nodes.filter((node) => byId.has(node.type));
  if (placeholders.length === 0) return { nodes, links, changed: false };

  /**
   * placeholder id → { inputs: old→new, outputs: old→new } plus how many slots
   * the DEFINITION has, which is what an index beyond the old list is measured
   * against.
   */
  const remaps = new Map<number, {
    inputs: Map<number, number>;
    outputs: Map<number, number>;
    inputCount: number;
    outputCount: number;
    oldInputCount: number;
    oldOutputCount: number;
  }>();
  const rebuilt = new Map<number, WorkflowNode>();
  let changed = false;

  for (const placeholder of placeholders) {
    const definition = byId.get(placeholder.type)!;
    const oldInputs = placeholder.inputs ?? [];
    const oldOutputs = placeholder.outputs ?? [];

    // An absent boundary list means the definition never declared one — not
    // that the boundary is empty. Leave those slots alone rather than wiping
    // the instance's own.
    const inputMap = definition.inputs
      ? buildSlotMap(oldInputs, definition.inputs)
      : identityMap(oldInputs.length);
    const outputMap = definition.outputs
      ? buildSlotMap(oldOutputs, definition.outputs)
      : identityMap(oldOutputs.length);

    const newInputs = definition.inputs
      ? buildBoundaryInputs(definition, oldInputs, inputMap)
      : oldInputs;
    const newOutputs = definition.outputs
      ? buildBoundaryOutputs(definition, oldOutputs, outputMap)
      : oldOutputs;

    remaps.set(placeholder.id, {
      inputs: inputMap,
      outputs: outputMap,
      inputCount: newInputs.length,
      outputCount: newOutputs.length,
      oldInputCount: oldInputs.length,
      oldOutputCount: oldOutputs.length,
    });

    if (slotsEqual(oldInputs, newInputs) && slotsEqual(oldOutputs, newOutputs)) continue;
    changed = true;
    rebuilt.set(placeholder.id, {
      ...placeholder,
      inputs: newInputs,
      outputs: newOutputs,
    });
  }

  // Rewrite (or drop) every link that touches a rebuilt placeholder slot.
  const droppedLinkIds = new Set<number>();
  const nextLinks: AnyLink[] = [];
  for (const link of links) {
    const { id, originId, originSlot, targetId, targetSlot } = readLink(link);
    const originRemap = remaps.get(originId);
    const targetRemap = remaps.get(targetId);
    if (!originRemap && !targetRemap) {
      nextLinks.push(link);
      continue;
    }

    const nextOriginSlot = originRemap
      ? resolveSlot(
          originSlot,
          originRemap.outputs,
          originRemap.outputCount,
          originRemap.oldOutputCount,
        )
      : originSlot;
    const nextTargetSlot = targetRemap
      ? resolveSlot(
          targetSlot,
          targetRemap.inputs,
          targetRemap.inputCount,
          targetRemap.oldInputCount,
        )
      : targetSlot;
    // No boundary slot to land on: the definition no longer has this slot, so
    // the connection is already dead. ComfyUI discards it too.
    if (nextOriginSlot === undefined || nextTargetSlot === undefined) {
      droppedLinkIds.add(id);
      changed = true;
      continue;
    }
    if (nextOriginSlot === originSlot && nextTargetSlot === targetSlot) {
      nextLinks.push(link);
      continue;
    }
    changed = true;
    nextLinks.push(withSlots(link, nextOriginSlot, nextTargetSlot));
  }

  if (!changed) return { nodes, links, changed: false };

  // Clear references to links this pass discarded. Deliberately scoped to those
  // ids only — pre-existing dangling ids are `collectRootLinkGarbage` and
  // `repairRootLinkSlots`'s business, and sweeping them here would make an
  // otherwise no-op normalization return a changed workflow.
  const nextNodes = droppedLinkIds.size === 0
    ? nodes.map((node) => rebuilt.get(node.id) ?? node)
    : nodes.map((node) => {
        const base = rebuilt.get(node.id) ?? node;
        const inputs = dropInputLinks(base, droppedLinkIds);
        const outputs = dropOutputLinks(base, droppedLinkIds);
        if (inputs === base.inputs && outputs === base.outputs) return base;
        return { ...base, inputs, outputs };
      });

  return {
    nodes: nextNodes.map((node) =>
      remaps.has(node.id) ? reseatSlotLinkCaches(node, nextLinks) : node,
    ),
    links: nextLinks,
    changed: true,
  };
}

/**
 * Point a placeholder's slot link caches at the links it actually has.
 *
 * `inputs[i].link` and `outputs[j].links` are caches of the link table, and a
 * caller that rewires against the definition leaves them behind — a slot the
 * move just added lists nothing while the table has a dozen links hanging off
 * it. Left that way the slot renders unconnected and, worse, the pre-save link
 * GC reads the empty cache as proof the links are garbage and deletes them.
 */
function reseatSlotLinkCaches(placeholder: WorkflowNode, links: AnyLink[]): WorkflowNode {
  const incoming = new Map<number, number>();
  const outgoing = new Map<number, number[]>();
  for (const link of links) {
    const { id, originId, originSlot, targetId, targetSlot } = readLink(link);
    if (targetId === placeholder.id) incoming.set(targetSlot, id);
    if (originId === placeholder.id) outgoing.set(originSlot, [...(outgoing.get(originSlot) ?? []), id]);
  }

  let touched = false;
  const inputs = (placeholder.inputs ?? []).map((input, index) => {
    const link = incoming.get(index) ?? null;
    if ((input.link ?? null) === link) return input;
    touched = true;
    return { ...input, link };
  });
  const outputs = (placeholder.outputs ?? []).map((output, index) => {
    const next = outgoing.get(index) ?? null;
    const current = output.links ?? null;
    if (current === null ? next === null : sameIds(current, next)) return output;
    touched = true;
    return { ...output, links: next };
  });
  return touched ? { ...placeholder, inputs, outputs } : placeholder;
}

function sameIds(a: number[], b: number[] | null): boolean {
  if (b === null) return a.length === 0;
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function identityMap(length: number): Map<number, number> {
  const map = new Map<number, number>();
  for (let index = 0; index < length; index += 1) map.set(index, index);
  return map;
}

type BoundarySlot = NonNullable<WorkflowSubgraphDefinition['inputs']>[number];

/**
 * Push the boundary's display names onto a rebuilt slot.
 *
 * `label` is what the card actually shows and renames happen at the boundary,
 * so the boundary's label always wins. `localized_name` only ever surfaces when
 * there is no label, so it is carried over but never introduced — adding it
 * would rewrite every affected file on first save to no visible effect.
 */
function applyBoundaryPresentation(
  slot: { label?: string; localized_name?: string },
  carried: { label?: string; localized_name?: string } | undefined,
  boundary: BoundarySlot,
): void {
  if (boundary.label !== undefined) slot.label = boundary.label;
  if (
    boundary.localized_name !== undefined
    && (!carried || carried.localized_name !== undefined)
  ) {
    slot.localized_name = boundary.localized_name;
  }
}

function buildBoundaryInputs(
  definition: WorkflowSubgraphDefinition,
  oldInputs: WorkflowInput[],
  inputMap: Map<number, number>,
): WorkflowInput[] {
  const oldByNewSlot = new Map<number, WorkflowInput>();
  for (const [oldSlot, newSlot] of inputMap) {
    const existing = oldInputs[oldSlot];
    if (existing) oldByNewSlot.set(newSlot, existing);
  }

  return (definition.inputs ?? []).map((boundary, boundarySlot) => {
    const carried = oldByNewSlot.get(boundarySlot);
    const name = boundary.name ?? carried?.name ?? '';
    // Merge onto the carried slot rather than replacing it: presentation and
    // identity come from the boundary (ComfyUI rebuilds the slot from it and
    // names the widget after it), but anything else the file carried —
    // slot_index, shape, pos, custom keys — is none of our business.
    const input: WorkflowInput = {
      ...(carried ?? {}),
      name,
      type: String(boundary.type ?? carried?.type ?? '*'),
      link: carried?.link ?? null,
    };
    applyBoundaryPresentation(input, carried, boundary);
    if (getSubgraphBoundaryWidgetIndexForSlot(definition, boundarySlot) !== null) {
      input.widget = { name };
    } else {
      delete input.widget;
    }
    return input;
  });
}

function buildBoundaryOutputs(
  definition: WorkflowSubgraphDefinition,
  oldOutputs: WorkflowOutput[],
  outputMap: Map<number, number>,
): WorkflowOutput[] {
  const oldByNewSlot = new Map<number, WorkflowOutput>();
  for (const [oldSlot, newSlot] of outputMap) {
    const existing = oldOutputs[oldSlot];
    if (existing) oldByNewSlot.set(newSlot, existing);
  }

  return (definition.outputs ?? []).map((boundary, boundarySlot) => {
    const carried = oldByNewSlot.get(boundarySlot);
    const output: WorkflowOutput = {
      ...(carried ?? {}),
      name: boundary.name ?? carried?.name ?? '',
      type: String(boundary.type ?? carried?.type ?? '*'),
      links: carried ? carried.links : [],
    };
    applyBoundaryPresentation(output, carried, boundary);
    return output;
  });
}

function dropInputLinks(node: WorkflowNode, droppedLinkIds: Set<number>): WorkflowInput[] {
  const inputs = node.inputs ?? [];
  let touched = false;
  const next = inputs.map((input) => {
    if (input.link == null || !droppedLinkIds.has(input.link)) return input;
    touched = true;
    return { ...input, link: null };
  });
  return touched ? next : inputs;
}

function dropOutputLinks(node: WorkflowNode, droppedLinkIds: Set<number>): WorkflowOutput[] {
  const outputs = node.outputs ?? [];
  let touched = false;
  const next = outputs.map((output) => {
    const links = output.links;
    if (!links?.length || !links.some((linkId) => droppedLinkIds.has(linkId))) return output;
    touched = true;
    return { ...output, links: links.filter((linkId) => !droppedLinkIds.has(linkId)) };
  });
  return touched ? next : outputs;
}

function slotsEqual(
  a: Array<WorkflowInput | WorkflowOutput>,
  b: Array<WorkflowInput | WorkflowOutput>,
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((slot, index) => JSON.stringify(slot) === JSON.stringify(b[index]));
}
