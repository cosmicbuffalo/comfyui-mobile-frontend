/**
 * The parts of a serialized subgraph definition that only the desktop frontend
 * reads, and that mobile therefore has no reason to invent for itself — until
 * it writes a definition of its own, at which point leaving them out is fatal.
 *
 * Stock's `Subgraph` constructor ends with:
 *
 *   this.inputNode.configure(data.inputNode)
 *   this.outputNode.configure(data.outputNode)
 *
 * and `SubgraphIONodeBase.configure` opens with `this._boundingRect.set(data.bounding)`.
 * There is no guard on either: `data.inputNode` being absent throws
 * "Cannot read properties of undefined (reading 'bounding')" out of
 * `loadSubgraphs`, which stock calls AFTER it has cleared the canvas and
 * without a try/catch anywhere above it. The workflow does not fail to open —
 * it disappears.
 *
 * `version`/`revision`/`state` are the schema's other required fields. They
 * cost nothing to supply and their absence is a validation alert.
 *
 * All 280 subgraph definitions in ComfyUI's template corpus carry these five
 * fields, with `inputNode.id` always -10 and `outputNode.id` always -20 — the
 * same sentinels the boundary links already use as their endpoints.
 */

import type { Workflow, WorkflowSubgraphDefinition } from '@/api/types';
import {
  SUBGRAPH_INPUT_NODE_ID,
  SUBGRAPH_OUTPUT_NODE_ID,
} from '@/utils/canonicalWorkflowOps';

/**
 * Where the IO nodes sit on the desktop canvas when mobile had no say in it.
 * Stock re-arranges them itself (`inputNode.arrange()`) the first time the
 * subgraph is opened, so these only have to be finite and out of the way.
 */
const DEFAULT_INPUT_NODE_BOUNDING: [number, number, number, number] = [-400, 0, 120, 60];
const DEFAULT_OUTPUT_NODE_BOUNDING: [number, number, number, number] = [400, 0, 120, 60];

function hasBounding(value: unknown): boolean {
  const bounding = (value as { bounding?: unknown } | undefined)?.bounding;
  return Array.isArray(bounding) && bounding.length === 4 && bounding.every((n) => typeof n === 'number');
}

function isCompleteState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return ['lastGroupId', 'lastNodeId', 'lastLinkId', 'lastRerouteId'].every(
    (key) => typeof state[key] === 'number',
  );
}

/**
 * Fill in whatever a definition is missing of the desktop-only envelope,
 * leaving anything already there exactly as it is — a definition that came
 * from stock must round-trip untouched.
 */
export function ensureSubgraphDefinitionEnvelope(
  def: WorkflowSubgraphDefinition,
): WorkflowSubgraphDefinition {
  const needsInputNode = !hasBounding(def.inputNode);
  const needsOutputNode = !hasBounding(def.outputNode);
  const needsVersion = def.version !== 1;
  const needsRevision = typeof def.revision !== 'number';
  const needsState = !isCompleteState(def.state);
  if (!needsInputNode && !needsOutputNode && !needsVersion && !needsRevision && !needsState) {
    return def;
  }

  const maxNodeId = Math.max(0, ...(def.nodes ?? []).map((node) => node.id));
  const maxLinkId = Math.max(0, ...(def.links ?? []).map((link) => link.id));
  const maxGroupId = Math.max(0, ...(def.groups ?? []).map((group) => group.id ?? 0));

  return {
    ...def,
    ...(needsInputNode
      ? { inputNode: { id: SUBGRAPH_INPUT_NODE_ID, bounding: [...DEFAULT_INPUT_NODE_BOUNDING] } }
      : {}),
    ...(needsOutputNode
      ? { outputNode: { id: SUBGRAPH_OUTPUT_NODE_ID, bounding: [...DEFAULT_OUTPUT_NODE_BOUNDING] } }
      : {}),
    ...(needsVersion ? { version: 1 } : {}),
    ...(needsRevision ? { revision: 0 } : {}),
    ...(needsState
      ? {
          // Merged, not replaced: a definition's `state` also carries this
          // app's own item colour, which a wholesale rewrite would drop.
          state: {
            ...(def.state ?? {}),
            lastGroupId: typeof def.state?.lastGroupId === 'number' ? def.state.lastGroupId : maxGroupId,
            lastNodeId: typeof def.state?.lastNodeId === 'number' ? def.state.lastNodeId : maxNodeId,
            lastLinkId: typeof def.state?.lastLinkId === 'number' ? def.state.lastLinkId : maxLinkId,
            lastRerouteId: typeof def.state?.lastRerouteId === 'number' ? def.state.lastRerouteId : 0,
          },
        }
      : {}),
  };
}

/** Apply {@link ensureSubgraphDefinitionEnvelope} to every definition, at any depth. */
export function ensureSubgraphDefinitionEnvelopes(workflow: Workflow): Workflow {
  const defs = workflow.definitions?.subgraphs;
  if (!defs || defs.length === 0) return workflow;

  let changed = false;
  const next = defs.map((def) => {
    const withEnvelope = ensureSubgraphDefinitionEnvelope(def);
    // Definitions may nest, even though stock flattens them on serialize.
    const nested = withEnvelope.definitions?.subgraphs;
    const withNested = nested
      ? (ensureSubgraphDefinitionEnvelopes(withEnvelope as unknown as Workflow) as unknown as WorkflowSubgraphDefinition)
      : withEnvelope;
    if (withNested !== def) changed = true;
    return withNested;
  });

  if (!changed) return workflow;
  return { ...workflow, definitions: { ...workflow.definitions, subgraphs: next } };
}

/**
 * Raise the root link-id allocator past every link id actually in use,
 * subgraph interiors included.
 *
 * Stock hands out the next link id as `graph.state.lastLinkId + 1`, and a
 * subgraph does not have its own counter — `Subgraph.state` returns the ROOT
 * graph's. So one allocator covers the whole file, and mobile numbering a
 * definition's interior links past it leaves stock ready to reissue an id that
 * is already in use. The next connection drawn inside that subgraph would land
 * on `_links.set(existingId, …)` and quietly overwrite a live link.
 *
 * Only links. Node ids look like the same problem and are not: every node
 * arrives through `LGraph.add`, which calls `syncLastNodeId`, so stock repairs
 * `lastNodeId` from the nodes themselves as it loads. Links are inserted
 * straight into the map with no such step. (`ensureGlobalIdUniqueness` would
 * have covered both, but it appears exactly once in the shipped bundle — its
 * own definition. It is never called.)
 *
 * Returns the workflow unchanged when the counter is already clear, so a file
 * that needs no repair keeps its identity through the validator.
 */
export function reconcileIdAllocators(workflow: Workflow): Workflow {
  let maxLinkId = 0;
  for (const link of workflow.links ?? []) {
    if (typeof link?.[0] === 'number') maxLinkId = Math.max(maxLinkId, link[0]);
  }

  const walk = (defs: WorkflowSubgraphDefinition[] | undefined): void => {
    for (const def of defs ?? []) {
      for (const link of def.links ?? []) {
        if (typeof link.id === 'number') maxLinkId = Math.max(maxLinkId, link.id);
      }
      walk(def.definitions?.subgraphs);
    }
  };
  walk(workflow.definitions?.subgraphs);

  const state = workflow.state;
  const declared = Math.max(
    workflow.last_link_id ?? 0,
    typeof state?.lastLinkId === 'number' ? state.lastLinkId : 0,
  );
  if (maxLinkId <= declared) return workflow;

  return {
    ...workflow,
    last_link_id: maxLinkId,
    // Only touch `state` when the file already carries one: writing a partial
    // one where stock expects all four counters would trade this problem for a
    // validation alert.
    ...(state ? { state: { ...state, lastLinkId: maxLinkId } } : {}),
  };
}
