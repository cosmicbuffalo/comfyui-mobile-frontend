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
  MOBILE_INSTANCE_NUMBER_PROPERTY,
  makeScopeLink,
  maxNodeIdAcrossScopes,
  withMobileDefMeta,
} from '@/utils/canonicalWorkflowOps';
import { generateUniqueSubgraphId } from '@/utils/duplicateNode';
import { normalizeSubgraphPlaceholders } from '@/utils/normalizeSubgraphPlaceholders';
import { ensureSubgraphDefinitionEnvelope } from '@/utils/subgraphDefinitionShape';
import { newBoundarySlotId, uniqueBoundaryName } from '@/utils/subgraphBoundaryNames';
import { collectGroupMoveSelection } from '@/utils/workflowClipboard';

type ScopeLink = WorkflowLink | WorkflowSubgraphLink;

export interface CreateSubgraphSelection {
  nodeIds: number[];
  groupIds: number[];
}

export interface CreateSubgraphResult {
  workflow: Workflow;
  subgraphId: string;
  placeholderNodeId: number;
  /** Slots the boundary gained, for telling the user what was exposed. */
  inputCount: number;
  outputCount: number;
}

/** A link that crosses the selection's edge, and so becomes a boundary slot. */
interface CrossingLink {
  link: ScopeLink;
  /** The endpoint INSIDE the selection. */
  innerNodeId: number;
  innerSlot: number;
  /** The endpoint OUTSIDE it. */
  outerNodeId: number;
  outerSlot: number;
  type: string;
}

/**
 * Wrap a selection of nodes and groups into a new subgraph.
 *
 * The boundary is not designed, it is *observed*: every link that crosses the
 * edge of the selection becomes a slot, and every link wholly inside travels in
 * with the nodes. That is the whole rule, and it is what makes the result
 * predictable — whatever the selection was already connected to is what the new
 * subgraph exposes.
 *
 * Two dedup rules stop that producing a slot per link:
 *
 * - one outside source feeding several selected nodes is ONE input slot,
 *   fanning out inside. Two slots carrying the same value would be a worse
 *   subgraph than the graph it replaced.
 * - one selected output feeding several outside nodes is ONE output slot,
 *   fanning out beyond the placeholder, for the same reason.
 *
 * `dissolveSubgraph` is the exact inverse, which is the useful thing to test
 * against: wrapping a selection and dissolving the result should give the graph
 * back.
 */
export function createSubgraphFromSelection(
  workflow: Workflow,
  scopeSubgraphId: string | null,
  selection: CreateSubgraphSelection,
  name: string,
): CreateSubgraphResult | null {
  const defs = workflow.definitions?.subgraphs ?? [];
  const scopeDef = scopeSubgraphId
    ? defs.find((sg) => sg.id === scopeSubgraphId)
    : null;
  if (scopeSubgraphId && !scopeDef) return null;

  const scopeNodes: WorkflowNode[] = scopeSubgraphId ? (scopeDef!.nodes ?? []) : (workflow.nodes ?? []);
  const scopeLinks: ScopeLink[] = scopeSubgraphId ? (scopeDef!.links ?? []) : (workflow.links ?? []);
  const scopeGroups: WorkflowGroup[] = scopeSubgraphId
    ? (scopeDef!.groups ?? [])
    : (workflow.groups ?? []);

  // A selected group brings its members and any groups nested in it, so
  // selecting one group is enough to wrap everything it holds. Delegated to the
  // helper the clipboard already uses rather than re-deriving membership from
  // geometry: it follows the app's own rule for which group a node belongs to,
  // which is not simply "inside the box" once groups are nested.
  const moving = collectGroupMoveSelection(workflow, scopeSubgraphId, selection.groupIds);
  const groupIds = new Set(moving.groupIds);
  const memberIds = new Set([...selection.nodeIds, ...moving.nodeIds]);
  const members = scopeNodes.filter((node) => memberIds.has(node.id));
  if (members.length === 0) return null;

  const internal: ScopeLink[] = [];
  const incoming: CrossingLink[] = [];
  const outgoing: CrossingLink[] = [];
  const untouched: ScopeLink[] = [];
  for (const link of scopeLinks) {
    const originInside = memberIds.has(getLinkOriginId(link));
    const targetInside = memberIds.has(getLinkTargetId(link));
    if (originInside && targetInside) {
      internal.push(link);
    } else if (targetInside) {
      incoming.push({
        link,
        innerNodeId: getLinkTargetId(link),
        innerSlot: getLinkTargetSlot(link),
        outerNodeId: getLinkOriginId(link),
        outerSlot: getLinkOriginSlot(link),
        type: getLinkType(link),
      });
    } else if (originInside) {
      outgoing.push({
        link,
        innerNodeId: getLinkOriginId(link),
        innerSlot: getLinkOriginSlot(link),
        outerNodeId: getLinkTargetId(link),
        outerSlot: getLinkTargetSlot(link),
        type: getLinkType(link),
      });
    } else {
      untouched.push(link);
    }
  }

  // Inputs keyed by the OUTSIDE source, outputs by the INSIDE source: those are
  // the ends that one slot can serve several links from.
  const inputGroups = groupBy(incoming, (entry) => `${entry.outerNodeId}:${entry.outerSlot}`);
  const outputGroups = groupBy(outgoing, (entry) => `${entry.innerNodeId}:${entry.innerSlot}`);

  const memberById = new Map(members.map((node) => [node.id, node]));
  const newSubgraphId = generateUniqueSubgraphId(defs);
  const placeholderNodeId = maxNodeIdAcrossScopes(workflow) + 1;

  let nextInnerLinkId = 0;
  const innerLinks: WorkflowSubgraphLink[] = internal.map((link) => ({
    id: (nextInnerLinkId += 1),
    origin_id: getLinkOriginId(link),
    origin_slot: getLinkOriginSlot(link),
    target_id: getLinkTargetId(link),
    target_slot: getLinkTargetSlot(link),
    type: getLinkType(link),
  }));

  const takenInputNames = new Set<string>();
  const boundaryInputs: NonNullable<WorkflowSubgraphDefinition['inputs']> = [];
  inputGroups.forEach((entries) => {
    const slotIndex = boundaryInputs.length;
    const first = entries[0];
    const inner = memberById.get(first.innerNodeId);
    const slotName = uniqueBoundaryName(
      takenInputNames,
      inner?.inputs?.[first.innerSlot]?.name || first.type.toLowerCase() || 'input',
    );
    const linkIds: number[] = [];
    for (const entry of entries) {
      const id = (nextInnerLinkId += 1);
      linkIds.push(id);
      innerLinks.push({
        id,
        origin_id: SUBGRAPH_INPUT_NODE_ID,
        origin_slot: slotIndex,
        target_id: entry.innerNodeId,
        target_slot: entry.innerSlot,
        type: entry.type,
      });
    }
    boundaryInputs.push({
      id: newBoundarySlotId(),
      name: slotName,
      type: first.type,
      linkIds,
    });
  });

  const takenOutputNames = new Set<string>();
  const boundaryOutputs: NonNullable<WorkflowSubgraphDefinition['outputs']> = [];
  outputGroups.forEach((entries) => {
    const slotIndex = boundaryOutputs.length;
    const first = entries[0];
    const inner = memberById.get(first.innerNodeId);
    const slotName = uniqueBoundaryName(
      takenOutputNames,
      inner?.outputs?.[first.innerSlot]?.name || first.type.toLowerCase() || 'output',
    );
    const id = (nextInnerLinkId += 1);
    innerLinks.push({
      id,
      origin_id: first.innerNodeId,
      origin_slot: first.innerSlot,
      target_id: SUBGRAPH_OUTPUT_NODE_ID,
      target_slot: slotIndex,
      type: first.type,
    });
    boundaryOutputs.push({
      id: newBoundarySlotId(),
      name: slotName,
      type: first.type,
      linkIds: [id],
    });
  });

  const definitionName = name.trim() || 'Subgraph';

  // The envelope (inputNode/outputNode/version/revision/state) is what the
  // desktop frontend loads a definition through, and it dereferences
  // `inputNode.bounding` without a guard. `validateAndNormalizeWorkflow` would
  // fill it in on the way to disk regardless; building it correctly here keeps
  // the in-memory workflow valid too, so anything that clones this definition
  // before the first save carries it as well.
  const definition: WorkflowSubgraphDefinition = ensureSubgraphDefinitionEnvelope({
    id: newSubgraphId,
    name: definitionName,
    inputs: boundaryInputs,
    outputs: boundaryOutputs,
    nodes: members.map((node) => rebindInnerNode(node, innerLinks)),
    links: innerLinks,
    groups: scopeGroups
      .filter((group) => groupIds.has(group.id))
      .map((group) => ({ ...structuredClone(group), itemKey: undefined })),
  });

  // The placeholder stands where the selection did, so the graph keeps its
  // shape: the ordering that mobile derives from position is preserved.
  const topLeft = members.reduce(
    (acc, node) => [Math.min(acc[0], node.pos[0]), Math.min(acc[1], node.pos[1])] as [number, number],
    [members[0].pos[0], members[0].pos[1]] as [number, number],
  );

  const placeholder: WorkflowNode = {
    id: placeholderNodeId,
    type: newSubgraphId,
    pos: topLeft,
    size: [240, 100],
    flags: {},
    order: Math.min(...members.map((node) => node.order ?? 0)),
    mode: 0,
    inputs: boundaryInputs.map((slot, index) => ({
      name: slot.name ?? `input_${index}`,
      type: String(slot.type ?? '*'),
      // The first link of the group survives to carry the value in; its
      // siblings were duplicates of the same source and are dropped outside.
      link: inputGroups.get(keyAt(inputGroups, index))![0].link,
    })).map((slot) => ({ ...slot, link: getLinkId(slot.link) })),
    outputs: boundaryOutputs.map((slot, index) => ({
      name: slot.name ?? `output_${index}`,
      type: String(slot.type ?? '*'),
      links: outputGroups
        .get(keyAt(outputGroups, index))!
        .map((entry) => getLinkId(entry.link)),
    })),
    // Instance one of a type that may well end up with more; numbering it now
    // is what lets a "{n}" in the name read as "Segment 1" straight away.
    properties: { [MOBILE_INSTANCE_NUMBER_PROPERTY]: 1 },
    widgets_values: [],
  };

  // Outside links are re-pointed rather than rebuilt, so the nodes on the far
  // side keep the link ids they already reference.
  const keptLinkIds = new Set<number>();
  const rewired: ScopeLink[] = [...untouched];
  inputGroups.forEach((entries, key) => {
    const slotIndex = [...inputGroups.keys()].indexOf(key);
    const survivor = entries[0].link;
    keptLinkIds.add(getLinkId(survivor));
    rewired.push(
      makeScopeLink(
        getLinkId(survivor),
        getLinkOriginId(survivor),
        getLinkOriginSlot(survivor),
        placeholderNodeId,
        slotIndex,
        getLinkType(survivor),
        scopeSubgraphId,
      ),
    );
  });
  outputGroups.forEach((entries, key) => {
    const slotIndex = [...outputGroups.keys()].indexOf(key);
    for (const entry of entries) {
      keptLinkIds.add(getLinkId(entry.link));
      rewired.push(
        makeScopeLink(
          getLinkId(entry.link),
          placeholderNodeId,
          slotIndex,
          entry.outerNodeId,
          entry.outerSlot,
          entry.type,
          scopeSubgraphId,
        ),
      );
    }
  });

  const survivingNodes = scopeNodes
    .filter((node) => !memberIds.has(node.id))
    .map((node) => pruneDroppedLinks(node, keptLinkIds, scopeLinks, memberIds));

  const nextScopeNodes = [...survivingNodes, placeholder];
  const nextScopeGroups = scopeGroups.filter((group) => !groupIds.has(group.id));

  const nextDefs = [...defs, withMobileDefMeta(definition, { nextInstanceNumber: 2 })];
  const nextWorkflow: Workflow = scopeSubgraphId
    ? {
        ...workflow,
        definitions: {
          ...(workflow.definitions ?? {}),
          subgraphs: nextDefs.map((sg) =>
            sg.id === scopeSubgraphId
              ? {
                  ...sg,
                  nodes: nextScopeNodes,
                  links: rewired as WorkflowSubgraphLink[],
                  groups: nextScopeGroups,
                }
              : sg,
          ),
        },
      }
    : {
        ...workflow,
        nodes: nextScopeNodes,
        links: rewired as WorkflowLink[],
        groups: nextScopeGroups,
        definitions: { ...(workflow.definitions ?? {}), subgraphs: nextDefs },
      };

  return {
    // The placeholder is built from the boundary, but which of its inputs back
    // widgets is a fact about the definition's insides. Normalizing seats the
    // slots on the definition and marks them, the same pass a loaded workflow
    // goes through — without it every widget-backed input renders as a blank,
    // editable field instead of the connection that feeds it.
    workflow: normalizeSubgraphPlaceholders(nextWorkflow),
    subgraphId: newSubgraphId,
    placeholderNodeId,
    inputCount: boundaryInputs.length,
    outputCount: boundaryOutputs.length,
  };
}

function keyAt(map: Map<string, CrossingLink[]>, index: number): string {
  return [...map.keys()][index];
}

function groupBy(
  entries: CrossingLink[],
  key: (entry: CrossingLink) => string,
): Map<string, CrossingLink[]> {
  const map = new Map<string, CrossingLink[]>();
  for (const entry of entries) {
    const list = map.get(key(entry));
    if (list) list.push(entry);
    else map.set(key(entry), [entry]);
  }
  return map;
}


/** Point a member's own slots at the link ids the definition now uses. */
function rebindInnerNode(node: WorkflowNode, innerLinks: WorkflowSubgraphLink[]): WorkflowNode {
  const clone = structuredClone(node) as WorkflowNode;
  clone.itemKey = undefined;
  clone.inputs = (clone.inputs ?? []).map((input, index) => {
    const link = innerLinks.find((l) => l.target_id === node.id && l.target_slot === index);
    return { ...input, link: link ? link.id : null };
  });
  clone.outputs = (clone.outputs ?? []).map((output, index) => {
    const ids = innerLinks
      .filter((l) => l.origin_id === node.id && l.origin_slot === index)
      .map((l) => l.id);
    return { ...output, links: ids.length > 0 ? ids : null };
  });
  return clone;
}

/**
 * Drop link ids a surviving node can no longer reach.
 *
 * An outside node that fed several selected nodes from one output keeps only
 * the link that became the boundary slot; the rest went inside with the
 * members and would otherwise dangle on its output list.
 */
function pruneDroppedLinks(
  node: WorkflowNode,
  keptLinkIds: Set<number>,
  scopeLinks: ScopeLink[],
  memberIds: Set<number>,
): WorkflowNode {
  const crossed = new Set(
    scopeLinks
      .filter(
        (link) =>
          memberIds.has(getLinkOriginId(link)) || memberIds.has(getLinkTargetId(link)),
      )
      .map((link) => getLinkId(link)),
  );
  const dropped = (id: number) => crossed.has(id) && !keptLinkIds.has(id);
  const inputsTouched = (node.inputs ?? []).some((i) => i.link != null && dropped(i.link));
  const outputsTouched = (node.outputs ?? []).some((o) => o.links?.some(dropped));
  if (!inputsTouched && !outputsTouched) return node;
  return {
    ...node,
    inputs: (node.inputs ?? []).map((input) =>
      input.link != null && dropped(input.link) ? { ...input, link: null } : input,
    ),
    outputs: (node.outputs ?? []).map((output) => {
      if (!output.links?.some(dropped)) return output;
      const kept = output.links.filter((id) => !dropped(id));
      return { ...output, links: kept.length > 0 ? kept : null };
    }),
  };
}
