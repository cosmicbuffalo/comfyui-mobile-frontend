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

/** Subgraph input boundary sentinel node ID (all boundary-input links originate here). */
const SUBGRAPH_INPUT_SENTINEL = -10;

/** Subgraph output boundary sentinel node ID (all boundary-output links target here). */
const SUBGRAPH_OUTPUT_SENTINEL = -20;

export function validateAndNormalizeWorkflow(workflow: Workflow): Workflow {
  let next = collectRootLinkGarbage(workflow);
  next = repairRootLinkSlots(next);
  next = repairSubgraphLinkIds(next);
  return next;
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
