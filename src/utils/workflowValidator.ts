/**
 * Canonical workflow validator and normalizer.
 *
 * Called before every persistence operation (save, download, queue embed).
 * Applies deterministic corrections so the output is always valid from the
 * ComfyUI backend's perspective.
 *
 * Corrections:
 *  0. Root link-table garbage collection: drops links no node slot references.
 *  1. Root link node-slot consistency: ensures each link's origin and target
 *     nodes have correct slot references (adds missing link IDs, corrects stale ones).
 *  2. SubgraphIO.linkIds recomputation: rebuilds inputs[i].linkIds and
 *     outputs[j].linkIds from the actual boundary links in each subgraph
 *     (origin_id === -10 → input, target_id === -20 → output).
 *  3. Subgraph placeholder slot normalization: rebuilds each placeholder's
 *     inputs/outputs from its definition's boundary lists (see
 *     normalizeSubgraphPlaceholders); a no-op for anything already loaded.
 *  4. Instance title materialization: renders a `{n}` type name onto each
 *     placeholder's own title, where other frontends can read it.
 *  5. widgets_values_named removal: drops the name-keyed widget-value mirror
 *     ComfyUI >= 1.49 writes, which our positional edits would leave stale.
 *  6. Subgraph definition envelope: fills in the inputNode/outputNode/version/
 *     revision/state that only the desktop frontend reads. A definition mobile
 *     minted itself has none, and stock dereferences inputNode.bounding
 *     unguarded while loading — see subgraphDefinitionShape.ts. Applied here so
 *     it also repairs workflows already saved without them.
 *  7. Link allocator reconciliation: raises last_link_id past every link id in
 *     use, subgraph interiors included, since stock allocates new links from
 *     one counter shared across the whole file.
 *
 * Structural issues (missing referenced nodes, slot index out of range) are
 * silently skipped — they indicate upstream bugs that should be fixed at their
 * source, not papered over here.
 */

import type {
  Workflow,
  WorkflowInput,
  WorkflowNode,
  WorkflowOutput,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import { normalizeSubgraphPlaceholders } from '@/utils/normalizeSubgraphPlaceholders';
import {
  ensureSubgraphDefinitionEnvelopes,
  reconcileIdAllocators,
} from '@/utils/subgraphDefinitionShape';
import { materializeSubgraphTitles } from '@/utils/materializeSubgraphTitles';
import {
  SUBGRAPH_INPUT_NODE_ID as SUBGRAPH_INPUT_SENTINEL,
  SUBGRAPH_OUTPUT_NODE_ID as SUBGRAPH_OUTPUT_SENTINEL,
} from '@/utils/canonicalWorkflowOps';

export function validateAndNormalizeWorkflow(workflow: Workflow): Workflow {
  let next = collectRootLinkGarbage(workflow);
  next = repairRootLinkSlots(next);
  next = repairSubgraphLinkIds(next);
  // After the link table is consistent, re-seat subgraph placeholder slots onto
  // their definitions' boundaries. `loadWorkflow` already does this, so for the
  // active workflow it is a no-op; it is here for callers that build a prompt
  // straight from a file (bulk process) and never went through a load.
  next = normalizeSubgraphPlaceholders(next);
  // Render instance names onto the nodes themselves. `{n}` is ours; a title is
  // what every other frontend reads, and what rgthree's Fast Bypasser labels
  // its toggles from.
  next = materializeSubgraphTitles(next);
  next = dropStaleNamedWidgetValues(next);
  // Last, so they see the finished graph: the envelope's fallback state counts
  // the links the steps above settled on, and the allocators clear every id
  // any of them introduced.
  next = ensureSubgraphDefinitionEnvelopes(next);
  next = reconcileIdAllocators(next);
  return next;
}

// ---------------------------------------------------------------------------
// Named widget values
// ---------------------------------------------------------------------------

/**
 * Drop `widgets_values_named`, the name-keyed mirror of `widgets_values` that
 * ComfyUI frontend >= 1.49 writes on every node.
 *
 * We only ever edit the positional `widgets_values`, so carrying the mirror
 * through a mobile save would leave a stale copy of every value we changed.
 * That copy is inert today — `LiteGraph.namedValuesRestore` defaults to false,
 * so restore is positional — but if the user ever turns it on, the mirror wins
 * and every mobile edit silently reverts.
 *
 * Dropping it is safe: `LGraphNode.configure` falls back to positional restore
 * when the key is absent, and desktop regenerates it on its next save.
 */
function dropStaleNamedWidgetValues(workflow: Workflow): Workflow {
  const NAMED = 'widgets_values_named';
  let touched = false;

  const stripNodes = (nodes: WorkflowNode[]): WorkflowNode[] =>
    nodes.map((node) => {
      if (!(NAMED in node)) return node;
      touched = true;
      const rest = { ...(node as WorkflowNode & Record<string, unknown>) };
      delete rest[NAMED];
      return rest as WorkflowNode;
    });

  const nodes = stripNodes(workflow.nodes);
  const subgraphs = workflow.definitions?.subgraphs?.map((subgraph) => {
    const subgraphNodes = stripNodes(subgraph.nodes ?? []);
    return subgraphNodes === subgraph.nodes ? subgraph : { ...subgraph, nodes: subgraphNodes };
  });

  if (!touched) return workflow;
  return {
    ...workflow,
    nodes,
    ...(subgraphs ? { definitions: { ...workflow.definitions, subgraphs } } : {}),
  };
}

// ---------------------------------------------------------------------------
// 0. Root link-table garbage collection
// ---------------------------------------------------------------------------

/**
 * Drop links that no node slot references, and de-duplicate `outputs[].links`.
 *
 * `repairRootLinkSlots` treats the link table as authoritative and rewrites node
 * slots to match it. That is right for a link one endpoint still knows about and
 * wrong for one neither endpoint does — a link referenced by nothing is garbage,
 * and "repairing" it silently re-creates a connection the user deleted.
 *
 * Use Everywhere makes this concrete: it materialises its virtual broadcasts as
 * real links to serialise a prompt and then removes them again, but the cleanup
 * is keyed on `extra.links_added_by_ue` and does not always run. Workflows that
 * miss it accumulate the same edge on every save — beach.json carries 785 such
 * links out of 824, some duplicated 70 times. Without this pass they get
 * resurrected into node slots and written back to disk, leaving one VAE output
 * slot holding 211 duplicate link ids.
 *
 * A link survives when either endpoint still references it, or when its target
 * slot holds a dangling id — in that last case the link is the evidence needed to
 * repair the slot, which is what `repairRootLinkSlots` is for. Only links that
 * nothing references and that repair nothing are dropped.
 */
function collectRootLinkGarbage(workflow: Workflow): Workflow {
  if (workflow.links.length === 0) return workflow;

  const referenced = new Set<number>();
  for (const node of workflow.nodes) {
    for (const input of node.inputs ?? []) {
      if (input.link != null) referenced.add(input.link);
    }
    for (const output of node.outputs ?? []) {
      for (const linkId of output.links ?? []) referenced.add(linkId);
    }
  }

  const linkIds = new Set(workflow.links.map((link) => link[0]));
  const nodeById = new Map<number, WorkflowNode>(workflow.nodes.map((n) => [n.id, n]));

  // A slot whose link id is not in the table has lost its connection; a table
  // entry pointing at that slot is how it gets found again.
  const repairsDanglingTarget = (link: Workflow['links'][number]): boolean => {
    const target = nodeById.get(link[3]);
    const input = target?.inputs?.[link[4]];
    if (!input) return false;
    return input.link != null && !linkIds.has(input.link);
  };

  const nextLinks = workflow.links.filter(
    (link) => referenced.has(link[0]) || repairsDanglingTarget(link),
  );

  // De-duplicate outputs[].links in the same pass — the leaked links land there
  // too once they have been resurrected once.
  let dedupedAnyOutput = false;
  const nextNodes = workflow.nodes.map((node) => {
    if (!node.outputs?.some((output) => output.links && hasDuplicates(output.links))) {
      return node;
    }
    dedupedAnyOutput = true;
    return {
      ...node,
      outputs: node.outputs.map((output) =>
        output.links && hasDuplicates(output.links)
          ? { ...output, links: [...new Set(output.links)] }
          : output,
      ),
    };
  });

  if (nextLinks.length === workflow.links.length && !dedupedAnyOutput) return workflow;
  return { ...workflow, links: nextLinks, nodes: nextNodes };
}

function hasDuplicates(values: number[]): boolean {
  return new Set(values).size !== values.length;
}

// ---------------------------------------------------------------------------
// 1. Root link node-slot consistency
// ---------------------------------------------------------------------------

/**
 * For each root link [id, originId, originSlot, targetId, targetSlot, type]:
 * - Ensure originNode.outputs[originSlot].links contains id
 * - Ensure targetNode.inputs[targetSlot].link === id
 */
function repairRootLinkSlots(workflow: Workflow): Workflow {
  if (workflow.links.length === 0) return workflow;

  const nodeById = new Map<number, WorkflowNode>(
    workflow.nodes.map((n) => [n.id, n]),
  );

  // Collect the set of corrections needed before mutating anything.
  type InputFix = { nodeId: number; slot: number; linkId: number };
  type OutputFix = { nodeId: number; slot: number; linkId: number };
  const inputFixes: InputFix[] = [];
  const outputFixes: OutputFix[] = [];

  for (const link of workflow.links) {
    const [linkId, originId, originSlot, targetId, targetSlot] = link;

    const originNode = nodeById.get(originId);
    if (originNode) {
      const output = originNode.outputs?.[originSlot];
      if (output) {
        const currentLinks = output.links ?? [];
        if (!currentLinks.includes(linkId)) {
          outputFixes.push({ nodeId: originId, slot: originSlot, linkId });
        }
      }
    }

    const targetNode = nodeById.get(targetId);
    if (targetNode) {
      const input = targetNode.inputs?.[targetSlot];
      if (input && input.link !== linkId) {
        inputFixes.push({ nodeId: targetId, slot: targetSlot, linkId });
      }
    }
  }

  if (inputFixes.length === 0 && outputFixes.length === 0) return workflow;

  // Group fixes by node ID
  const inputFixesByNode = new Map<number, InputFix[]>();
  for (const fix of inputFixes) {
    const list = inputFixesByNode.get(fix.nodeId) ?? [];
    list.push(fix);
    inputFixesByNode.set(fix.nodeId, list);
  }
  const outputFixesByNode = new Map<number, OutputFix[]>();
  for (const fix of outputFixes) {
    const list = outputFixesByNode.get(fix.nodeId) ?? [];
    list.push(fix);
    outputFixesByNode.set(fix.nodeId, list);
  }

  const affectedNodeIds = new Set<number>([
    ...inputFixesByNode.keys(),
    ...outputFixesByNode.keys(),
  ]);

  const nextNodes = workflow.nodes.map((node) => {
    if (!affectedNodeIds.has(node.id)) return node;

    let nextInputs: WorkflowInput[] | undefined;
    const iFixList = inputFixesByNode.get(node.id);
    if (iFixList && node.inputs) {
      nextInputs = [...node.inputs];
      for (const { slot, linkId } of iFixList) {
        if (nextInputs[slot]) {
          nextInputs[slot] = { ...nextInputs[slot]!, link: linkId };
        }
      }
    }

    let nextOutputs: WorkflowOutput[] | undefined;
    const oFixList = outputFixesByNode.get(node.id);
    if (oFixList && node.outputs) {
      nextOutputs = [...node.outputs];
      for (const { slot, linkId } of oFixList) {
        const out = nextOutputs[slot];
        if (out) {
          const links = out.links ?? [];
          if (!links.includes(linkId)) {
            nextOutputs[slot] = { ...out, links: [...links, linkId] };
          }
        }
      }
    }

    return {
      ...node,
      ...(nextInputs != null ? { inputs: nextInputs } : {}),
      ...(nextOutputs != null ? { outputs: nextOutputs } : {}),
    };
  });

  return { ...workflow, nodes: nextNodes };
}

// ---------------------------------------------------------------------------
// 2. SubgraphIO.linkIds recomputation
// ---------------------------------------------------------------------------

/**
 * Recompute SubgraphIO.linkIds for every subgraph definition.
 *
 * inputs[i].linkIds  = IDs of links where origin_id === -10 && origin_slot === i
 * outputs[j].linkIds = IDs of links where target_id === -20 && target_slot === j
 *
 * This ensures the backend's `SubgraphSlot.getLinks()` returns correct results
 * after any edit that touched root or subgraph link tables.
 */
function repairSubgraphLinkIds(workflow: Workflow): Workflow {
  const subgraphs = workflow.definitions?.subgraphs;
  if (!subgraphs || subgraphs.length === 0) return workflow;

  let anyChanged = false;
  const nextSubgraphs = subgraphs.map((sg) => {
    return repairOneSubgraphLinkIds(sg, () => { anyChanged = true; });
  });

  if (!anyChanged) return workflow;

  return {
    ...workflow,
    definitions: {
      ...(workflow.definitions ?? {}),
      subgraphs: nextSubgraphs,
    },
  };
}

/**
 * Rebuild one definition's boundary linkIds caches from its actual link table.
 * Returns the same object when nothing changed. Store actions that edit
 * boundary links call this so the in-memory caches never diverge from what
 * save-time repair would produce (divergence shows up as phantom dirty state).
 */
export function rebuildDefinitionLinkIds(
  sg: WorkflowSubgraphDefinition,
): WorkflowSubgraphDefinition {
  return repairOneSubgraphLinkIds(sg, () => {});
}

function repairOneSubgraphLinkIds(
  sg: WorkflowSubgraphDefinition,
  onChanged: () => void,
): WorkflowSubgraphDefinition {
  const links = sg.links ?? [];
  const inputs = sg.inputs ?? [];
  const outputs = sg.outputs ?? [];

  // Build actual boundary link sets
  const inputLinkIds = new Map<number, number[]>();
  const outputLinkIds = new Map<number, number[]>();

  for (const link of links) {
    if (link.origin_id === SUBGRAPH_INPUT_SENTINEL) {
      const slot = link.origin_slot;
      const ids = inputLinkIds.get(slot) ?? [];
      ids.push(link.id);
      inputLinkIds.set(slot, ids);
    }
    if (link.target_id === SUBGRAPH_OUTPUT_SENTINEL) {
      const slot = link.target_slot;
      const ids = outputLinkIds.get(slot) ?? [];
      ids.push(link.id);
      outputLinkIds.set(slot, ids);
    }
  }

  let sgChanged = false;

  const nextInputs = inputs.length > 0
    ? inputs.map((inp, i) => {
        const expected = (inputLinkIds.get(i) ?? []).sort((a, b) => a - b);
        const current = (inp.linkIds ?? []).slice().sort((a, b) => a - b);
        if (sortedArraysEqual(current, expected)) return inp;
        sgChanged = true;
        return { ...inp, linkIds: expected };
      })
    : inputs;

  const nextOutputs = outputs.length > 0
    ? outputs.map((out, j) => {
        const expected = (outputLinkIds.get(j) ?? []).sort((a, b) => a - b);
        const current = (out.linkIds ?? []).slice().sort((a, b) => a - b);
        if (sortedArraysEqual(current, expected)) return out;
        sgChanged = true;
        return { ...out, linkIds: expected };
      })
    : outputs;

  if (!sgChanged) return sg;
  onChanged();
  return { ...sg, inputs: nextInputs, outputs: nextOutputs };
}

function sortedArraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
