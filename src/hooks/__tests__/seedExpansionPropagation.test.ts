import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { applySeedOverridesForExpansion } from '@/hooks/useWorkflow';
import { expandWorkflowSubgraphs } from '@/utils/expandWorkflowSubgraphs';

// Regression coverage for issue #69: a subgraph placeholder (e.g. the MiniMax
// H3 video subgraph) that promotes a noise_seed widget with no real
// control_after_generate on the boundary. queueWorkflow's processSeedNode
// records the placeholder's freshly-randomized seed in an ephemeral
// seedOverrides map (keyed by the placeholder's own node id) rather than
// writing it into widgets_values directly, so "always randomize" mode stays
// intact in the saved workflow. applySeedOverridesForExpansion is what makes
// that override actually reach the real executing node.

const nodeTypes: NodeTypes = {
  RandomNoiseLike: {
    input: {
      required: {
        noise_seed: ['INT', { min: 0, max: 999999999 }],
      },
    },
    output: ['NOISE'],
    output_name: ['NOISE'],
    name: 'RandomNoiseLike',
    display_name: 'RandomNoiseLike',
    description: '',
    python_module: '',
    category: '',
  },
};

function buildWorkflow(placeholderSeedValue: number): Workflow {
  const innerNode: WorkflowNode = {
    id: 15,
    type: 'RandomNoiseLike',
    pos: [0, 0],
    size: [100, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [
      { name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: 207 },
    ],
    outputs: [{ name: 'NOISE', type: 'NOISE', links: [] }],
    properties: {},
    widgets_values: [0],
  } as unknown as WorkflowNode;

  const placeholder: WorkflowNode = {
    id: 105,
    type: 'sg-video',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [
      { name: 'noise_seed', type: 'INT', widget: { name: 'noise_seed' }, link: null },
    ],
    outputs: [{ name: 'VIDEO', type: 'VIDEO', links: [] }],
    properties: {},
    widgets_values: [placeholderSeedValue],
  } as unknown as WorkflowNode;

  return {
    last_node_id: 105,
    last_link_id: 207,
    nodes: [placeholder],
    links: [],
    groups: [],
    config: {},
    version: 0.4,
    definitions: {
      subgraphs: [
        {
          id: 'sg-video',
          name: 'Video subgraph',
          nodes: [innerNode],
          links: [
            { id: 207, origin_id: -10, origin_slot: 0, target_id: 15, target_slot: 0, type: 'INT' },
          ],
          inputs: [{ name: 'noise_seed', type: 'INT', linkIds: [207] }],
          outputs: [],
        },
      ],
    },
  } as unknown as Workflow;
}

describe('applySeedOverridesForExpansion (issue #69: seed silently not randomizing)', () => {
  it('BUG SHAPE: without any override, expansion carries the placeholder\'s stale saved seed into the inner node', () => {
    const workflow = buildWorkflow(111);
    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(workflow, nodeTypes);
    const innerId = [...promptKeyMap.entries()].find(([, key]) => key === '105:15')?.[0];
    const inner = expanded.nodes.find((n) => n.id === innerId);
    expect((inner!.widgets_values as unknown[])[0]).toBe(111);
  });

  it('FIX: a placeholder-scoped seed override propagates into the expanded inner node', () => {
    const workflow = buildWorkflow(111); // stale/saved value -- must NOT win
    const freshSeed = 987654321;
    const patched = applySeedOverridesForExpansion(workflow, nodeTypes, { '105': freshSeed });

    const { workflow: expanded, promptKeyMap } = expandWorkflowSubgraphs(patched, nodeTypes);
    const innerId = [...promptKeyMap.entries()].find(([, key]) => key === '105:15')?.[0];
    const inner = expanded.nodes.find((n) => n.id === innerId);

    expect(inner).toBeDefined();
    expect((inner!.widgets_values as unknown[])[0]).toBe(freshSeed);
  });

  it('never mutates the original workflow object (patch is scoped to the expansion clone only)', () => {
    const workflow = buildWorkflow(111);
    applySeedOverridesForExpansion(workflow, nodeTypes, { '105': 42 });
    const placeholder = workflow.nodes.find((n) => n.id === 105)!;
    expect((placeholder.widgets_values as unknown[])[0]).toBe(111);
  });

  it('is a no-op when there are no overrides, or the override targets a non-placeholder node', () => {
    const workflow = buildWorkflow(111);
    expect(applySeedOverridesForExpansion(workflow, nodeTypes, {})).toBe(workflow);
    // '999' matches no node in this workflow at all.
    expect(applySeedOverridesForExpansion(workflow, nodeTypes, { '999': 42 })).toBe(workflow);
  });

  // Flagged in code review (Copilot, PR #70): a seed promoted EXCLUSIVELY via
  // properties.proxyWidgets (no slot/boundary promotion at all -- the pattern
  // some helper nodes like EasySeed use) resolves to a descriptor whose
  // widgetIndex is offset by PROXY_INDEX_OFFSET (10000). That offset is a
  // sentinel meaning "route through the inner node", not a real
  // widgets_values position -- only the proxyRoutes-aware UI code
  // (NodeCard.tsx) knows how to follow it. applySeedOverridesForExpansion
  // does a raw widgets_values[seedIndex] write with no such routing, so
  // resolving a proxy-offset seedIndex there would balloon widgets_values
  // into a ~10001-element sparse array. Proxy-promoted seeds are deliberately
  // excluded from this queue-time path (see buildSubgraphSeedWidgetDescriptors
  // in useWorkflow.ts) -- verify that holds and nothing gets corrupted.
  it('REGRESSION: a seed promoted only via proxyWidgets is not resolved here, and never corrupts widgets_values', () => {
    const innerSeedNode: WorkflowNode = {
      id: 15,
      type: 'RandomNoiseLike',
      pos: [0, 0],
      size: [100, 100],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [],
      outputs: [{ name: 'NOISE', type: 'NOISE', links: [] }],
      properties: {},
      widgets_values: [777],
    } as unknown as WorkflowNode;

    const placeholder: WorkflowNode = {
      id: 105,
      type: 'sg-proxy-only',
      pos: [0, 0],
      size: [200, 100],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [], // no slot/boundary entry for the seed at all
      outputs: [{ name: 'VIDEO', type: 'VIDEO', links: [] }],
      properties: {
        proxyWidgets: [['15', 'noise_seed']],
      },
      widgets_values: ['unrelated prompt text'], // only 1 slot -- nowhere near index 10000
    } as unknown as WorkflowNode;

    const workflow: Workflow = {
      last_node_id: 105,
      last_link_id: 0,
      nodes: [placeholder],
      links: [],
      groups: [],
      config: {},
      version: 0.4,
      definitions: {
        subgraphs: [
          {
            id: 'sg-proxy-only',
            name: 'Proxy-only subgraph',
            nodes: [innerSeedNode],
            links: [],
            inputs: [],
            outputs: [],
          },
        ],
      },
    } as unknown as Workflow;

    const patched = applySeedOverridesForExpansion(workflow, nodeTypes, { '105': 42 });

    expect(patched).toBe(workflow); // no-op: the exact bug-corrupted case would NOT be a no-op
    const resultPlaceholder = patched.nodes.find((n) => n.id === 105)!;
    expect((resultPlaceholder.widgets_values as unknown[]).length).toBe(1);
  });
});
