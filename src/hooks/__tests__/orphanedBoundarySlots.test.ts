import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowSubgraphDefinition } from '@/api/types';
import { createEmptyMobileLayout, makeLocationPointer } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return { ...actual, queuePrompt: vi.fn(async () => ({ prompt_id: 'p' })) };
});

/**
 * Deleting a node inside a subgraph must take its orphaned boundary slot with
 * it — or stock rotates every promoted value after that slot.
 *
 * Whether a slot is widget-backed is derived from its INTERIOR link on both
 * sides. Stock has no fallback: a slot whose link no longer resolves to an
 * inner input carrying `widget` consumes NO `widgets_values` entry, so
 * everything after it shifts up one. Mobile's resolver falls back to a type
 * check (deliberately — the issue-#69 truncated-serialization shape needs it),
 * so mobile keeps counting the dead slot and the two frontends read different
 * values from the same file.
 *
 * THE TEST TRAP, learned the hard way: never assert this through mobile's own
 * accessors (`getPlaceholderValueIndexForBoundarySlot` and friends) — the
 * writer and the reader share the fallback predicate, so they agree with each
 * other whether or not the file is right. `stockValueMapping` below models
 * stock's rule inline instead: a boundary input consumes a value only if some
 * interior link resolves to an inner input carrying `widget`, values taken in
 * boundary order.
 */
function stockValueMapping(
  def: WorkflowSubgraphDefinition,
  instanceValues: unknown[],
): Record<string, unknown> {
  const mapping: Record<string, unknown> = {};
  let valueIndex = 0;
  (def.inputs ?? []).forEach((slot, slotIndex) => {
    const consumes = (def.links ?? []).some((link) => {
      if (link.origin_id !== -10 || link.origin_slot !== slotIndex) return false;
      const inner = (def.nodes ?? []).find((n) => n.id === link.target_id);
      return inner?.inputs?.[link.target_slot]?.widget?.name != null;
    });
    if (!consumes) return;
    mapping[slot.name as string] = instanceValues[valueIndex];
    valueIndex += 1;
  });
  return mapping;
}

const SG = 'sg-orphan';
const OUTER = 'sg-outer';
const innerKey = (nodeId: number) =>
  makeLocationPointer({ type: 'node', nodeId, subgraphId: SG });
const rootKey = (nodeId: number) =>
  makeLocationPointer({ type: 'node', nodeId, subgraphId: null });

function node(id: number, type: string, itemKey: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    itemKey,
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  };
}

/**
 * `width` (inner node 100) and `cfg` (inner node 101) promoted to the
 * boundary; instances in two scopes with DISTINCT values, so a carry that
 * hands one instance another's value cannot pass. Optionally a legacy
 * (#69-shape) slot with no interior link at all, which must never be pruned.
 */
function makeWorkflow({ legacySlot = false, outerLinks = false } = {}): Workflow {
  const rootPlaceholderInputs = [
    { name: 'width', type: 'INT', link: outerLinks ? 70 : null },
    { name: 'cfg', type: 'FLOAT', link: outerLinks ? 71 : null },
  ];
  return {
    last_node_id: 100,
    last_link_id: 80,
    nodes: [
      node(20, SG, rootKey(20), {
        inputs: rootPlaceholderInputs,
        widgets_values: [512, 7],
      }),
      ...(outerLinks
        ? [
            node(2, 'IntSource', rootKey(2), { outputs: [{ name: 'INT', type: 'INT', links: [70] }] }),
            node(3, 'FloatSource', rootKey(3), { outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [71] }] }),
          ]
        : []),
    ],
    links: outerLinks
      ? [
          [70, 2, 0, 20, 0, 'INT'],
          [71, 3, 0, 20, 1, 'FLOAT'],
        ]
      : [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [
        {
          id: SG,
          name: 'Orphanable',
          inputNode: { id: -10, bounding: [-400, 0, 120, 60] },
          outputNode: { id: -20, bounding: [400, 0, 120, 60] },
          version: 1,
          revision: 0,
          state: { lastGroupId: 0, lastNodeId: 101, lastLinkId: 12, lastRerouteId: 0 },
          inputs: [
            { name: 'width', type: 'INT', linkIds: [11] },
            { name: 'cfg', type: 'FLOAT', linkIds: [12] },
            ...(legacySlot ? [{ name: 'legacy_seed', type: 'INT' }] : []),
          ],
          outputs: [],
          nodes: [
            node(100, 'WidthNode', innerKey(100), {
              inputs: [{ name: 'width', type: 'INT', link: 11, widget: { name: 'width' } }],
              widgets_values: [512],
            }),
            node(101, 'CfgNode', innerKey(101), {
              inputs: [{ name: 'cfg', type: 'FLOAT', link: 12, widget: { name: 'cfg' } }],
              widgets_values: [7],
            }),
          ],
          links: [
            { id: 11, origin_id: -10, origin_slot: 0, target_id: 100, target_slot: 0, type: 'INT' },
            { id: 12, origin_id: -10, origin_slot: 1, target_id: 101, target_slot: 0, type: 'FLOAT' },
          ],
          groups: [],
        },
        {
          id: OUTER,
          name: 'Outer',
          inputNode: { id: -10, bounding: [-400, 0, 120, 60] },
          outputNode: { id: -20, bounding: [400, 0, 120, 60] },
          version: 1,
          revision: 0,
          state: { lastGroupId: 0, lastNodeId: 30, lastLinkId: 0, lastRerouteId: 0 },
          inputs: [],
          outputs: [],
          nodes: [
            node(30, SG, makeLocationPointer({ type: 'node', nodeId: 30, subgraphId: OUTER }), {
              inputs: [
                { name: 'width', type: 'INT', link: null },
                { name: 'cfg', type: 'FLOAT', link: null },
              ],
              // Distinct from the root instance on purpose.
              widgets_values: [1024, 3],
            }),
          ],
          links: [],
          groups: [],
        },
      ],
    },
  } as unknown as Workflow;
}

const nodeTypes = {
  WidthNode: {
    input: { required: { width: ['INT', { default: 512 }] } },
    output: [], output_name: [], name: 'WidthNode', display_name: 'Width Node',
    description: '', python_module: '', category: 'test',
  },
  CfgNode: {
    input: { required: { cfg: ['FLOAT', { default: 7 }] } },
    output: [], output_name: [], name: 'CfgNode', display_name: 'Cfg Node',
    description: '', python_module: '', category: 'test',
  },
} as never;

function loadWorkflow(workflow: Workflow) {
  useWorkflowStore.setState({
    workflow,
    nodeTypes,
    mobileLayout: createEmptyMobileLayout(),
    scopeStack: [{ type: 'root' }],
    activeSessionId: 'session-orphans',
    hiddenItems: {},
    collapsedItems: {},
    itemKeyByPointer: {},
    pointerByHierarchicalKey: {},
  });
}

const defById = (id: string) =>
  useWorkflowStore.getState().workflow!.definitions!.subgraphs!.find((sg) => sg.id === id)!;

describe('deleting the node behind a promoted widget removes its boundary slot', () => {
  beforeEach(() => loadWorkflow(makeWorkflow()));

  it('drops the orphaned slot and keeps each instance on its OWN surviving values', () => {
    useWorkflowStore.getState().deleteNode(innerKey(100), false);

    const def = defById(SG);
    expect((def.inputs ?? []).map((slot) => slot.name)).toEqual(['cfg']);

    // Read through stock's rule, never mobile's resolver.
    const workflow = useWorkflowStore.getState().workflow!;
    const rootInstance = workflow.nodes.find((n) => n.id === 20)!;
    expect(stockValueMapping(def, rootInstance.widgets_values as unknown[]))
      .toEqual({ cfg: 7 });
    const nestedInstance = defById(OUTER).nodes.find((n) => n.id === 30)!;
    expect(stockValueMapping(def, nestedInstance.widgets_values as unknown[]))
      .toEqual({ cfg: 3 });
  });

  it('every surviving widget-backed slot resolves through a real interior link', () => {
    useWorkflowStore.getState().deleteNode(innerKey(100), false);

    const def = defById(SG);
    for (const [index, slot] of (def.inputs ?? []).entries()) {
      const resolves = (def.links ?? []).some((link) =>
        link.origin_id === -10
        && link.origin_slot === index
        && (def.nodes ?? []).find((n) => n.id === link.target_id)
          ?.inputs?.[link.target_slot]?.widget?.name != null);
      expect(resolves, `slot ${slot.name} must not survive on the type fallback`).toBe(true);
    }
  });

  it('disconnecting the interior link prunes the slot the same way', () => {
    useWorkflowStore.getState().disconnectInput(innerKey(100), 0);

    const def = defById(SG);
    expect((def.inputs ?? []).map((slot) => slot.name)).toEqual(['cfg']);
    const rootInstance = useWorkflowStore.getState().workflow!.nodes.find((n) => n.id === 20)!;
    expect(stockValueMapping(def, rootInstance.widgets_values as unknown[]))
      .toEqual({ cfg: 7 });
  });
});

describe('what the prune must NOT touch', () => {
  it('keeps a legacy slot that never had an interior link (issue-#69 shape)', () => {
    loadWorkflow(makeWorkflow({ legacySlot: true }));

    useWorkflowStore.getState().deleteNode(innerKey(100), false);

    const def = defById(SG);
    expect((def.inputs ?? []).map((slot) => slot.name)).toEqual(['cfg', 'legacy_seed']);
  });
});

describe('outer wiring across a prune', () => {
  it('drops the wire into the orphaned slot and re-seats the survivor', () => {
    loadWorkflow(makeWorkflow({ outerLinks: true }));

    useWorkflowStore.getState().deleteNode(innerKey(100), false);

    const workflow = useWorkflowStore.getState().workflow!;
    const placeholder = workflow.nodes.find((n) => n.id === 20)!;
    expect(placeholder.inputs.map((input) => input.name)).toEqual(['cfg']);
    // The cfg feed survives, addressed at its NEW slot index.
    expect(placeholder.inputs[0].link).toBe(71);
    const cfgLink = (workflow.links ?? []).find((link) => link[0] === 71);
    expect(cfgLink?.[4]).toBe(0);
    // The width feed has nothing to feed; it must be gone, not dangling.
    expect((workflow.links ?? []).some((link) => link[0] === 70)).toBe(false);
  });
});
