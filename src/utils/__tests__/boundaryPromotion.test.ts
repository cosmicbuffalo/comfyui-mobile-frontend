import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/api/types';
import type { WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import {
  promotedWidgetKey,
  resolveBoundaryPromotion,
  resolvePromotedWidgetKeys,
} from '../boundaryPromotion';

const SG = 'sg-a';

/**
 * A scope holding a sampler whose `latent` input is fed from inside and whose
 * `steps` input is free, plus an encoder whose output already reaches the
 * subgraph boundary (link 9 → sentinel -20).
 */
const scopedWorkflow: Pick<Workflow, 'nodes' | 'links'> = {
  nodes: [
    {
      id: 1,
      type: 'CLIPTextEncode',
      inputs: [],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [2, 9] }],
    },
    {
      id: 2,
      type: 'KSampler',
      inputs: [
        { name: 'latent', type: 'LATENT', link: 2 },
        { name: 'steps', type: 'INT', link: null },
      ],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: null }],
    },
  ],
  links: [
    [2, 1, 0, 2, 0, 'LATENT'],
    [9, 1, 0, -20, 0, 'LATENT'],
  ],
} as unknown as Pick<Workflow, 'nodes' | 'links'>;

const base = {
  scopedWorkflow,
  currentSubgraphId: SG,
  nodeKey: `${SG}/node:2`,
  nodeId: 2,
} as const;

describe('resolveBoundaryPromotion', () => {
  it('offers an unwired input', () => {
    expect(
      resolveBoundaryPromotion({ ...base, direction: 'input', slotIndex: 1 }),
    ).toEqual({ direction: 'input', nodeKey: `${SG}/node:2`, slotIndex: 1 });
  });

  it('refuses an input already fed from inside, which promoting would unwire', () => {
    expect(
      resolveBoundaryPromotion({ ...base, direction: 'input', slotIndex: 0 }),
    ).toBeNull();
  });

  it('offers an output that only feeds inner nodes', () => {
    // Node 2's IMAGE reaches nothing yet.
    expect(
      resolveBoundaryPromotion({ ...base, direction: 'output', slotIndex: 0 }),
    ).toEqual({ direction: 'output', nodeKey: `${SG}/node:2`, slotIndex: 0 });
  });

  it('offers an output that feeds inner nodes AND is not yet on the boundary', () => {
    const encoder = { ...base, nodeId: 1, nodeKey: `${SG}/node:1` };
    // Node 1 feeds node 2 over link 2 — that alone must not disqualify it.
    const withoutBoundaryLink: Pick<Workflow, 'nodes' | 'links'> = {
      nodes: scopedWorkflow.nodes.map((node) =>
        node.id === 1 ? { ...node, outputs: [{ ...node.outputs![0], links: [2] }] } : node,
      ),
      links: scopedWorkflow.links.filter((link) => link[0] !== 9),
    } as Pick<Workflow, 'nodes' | 'links'>;

    expect(
      resolveBoundaryPromotion({
        ...encoder,
        scopedWorkflow: withoutBoundaryLink,
        direction: 'output',
        slotIndex: 0,
      }),
    ).toEqual({ direction: 'output', nodeKey: `${SG}/node:1`, slotIndex: 0 });
  });

  it('refuses an output that already reaches the boundary', () => {
    expect(
      resolveBoundaryPromotion({
        ...base,
        nodeId: 1,
        nodeKey: `${SG}/node:1`,
        direction: 'output',
        slotIndex: 0,
      }),
    ).toBeNull();
  });

  it('refuses at root, where there is no boundary to promote onto', () => {
    expect(
      resolveBoundaryPromotion({
        ...base,
        currentSubgraphId: null,
        direction: 'input',
        slotIndex: 1,
      }),
    ).toBeNull();
  });

  it('refuses a slot index that does not exist', () => {
    expect(
      resolveBoundaryPromotion({ ...base, direction: 'input', slotIndex: 7 }),
    ).toBeNull();
  });
});

/**
 * The shape that produced the false highlight: a subgraph holding two
 * CLIPTextEncode nodes, both owning a widget named `text`, where only the
 * second one's `text` is wired to the boundary. `proxyWidgets` records that
 * promotion as `["-1", "text"]` — no owner — so a name-only match lit up both.
 */
const promotingPlaceholder = {
  id: 100,
  type: 'sg-prompts',
  properties: {
    proxyWidgets: [
      ['31', 'seed'],
      ['-1', 'text'],
    ],
  },
  inputs: [
    { name: 'text', type: 'STRING', link: null, widget: { name: 'text' } },
  ],
} as unknown as WorkflowNode;

const promotingSubgraph = {
  id: 'sg-prompts',
  inputs: [
    { id: 'slot-1', name: 'text', type: 'STRING', linkIds: [50] },
  ],
  nodes: [
    {
      id: 21,
      type: 'CLIPTextEncode',
      title: 'Positive Prompt',
      inputs: [{ name: 'clip', type: 'CLIP', link: 48 }],
    },
    {
      id: 22,
      type: 'CLIPTextEncode',
      title: 'Negative Prompt',
      inputs: [
        { name: 'clip', type: 'CLIP', link: 49 },
        { name: 'text', type: 'STRING', link: 50, widget: { name: 'text' } },
      ],
    },
    { id: 31, type: 'Seed', inputs: [] },
  ],
  links: [
    { id: 50, origin_id: -10, origin_slot: 0, target_id: 22, target_slot: 1, type: 'STRING' },
  ],
} as unknown as WorkflowSubgraphDefinition;

describe('resolvePromotedWidgetKeys', () => {
  it('credits a boundary-routed promotion only to the node the boundary feeds', () => {
    const keys = resolvePromotedWidgetKeys(promotingPlaceholder, promotingSubgraph);

    expect(keys.has(promotedWidgetKey(22, 'text'))).toBe(true);
    expect(keys.has(promotedWidgetKey(21, 'text'))).toBe(false);
  });

  it('keeps a proxyWidgets entry that names its own node', () => {
    const keys = resolvePromotedWidgetKeys(promotingPlaceholder, promotingSubgraph);

    expect(keys.has(promotedWidgetKey(31, 'seed'))).toBe(true);
    expect(keys.has(promotedWidgetKey(21, 'seed'))).toBe(false);
  });

  it('credits every inner node a fanned-out boundary input feeds', () => {
    const subgraph = {
      ...promotingSubgraph,
      links: [
        ...promotingSubgraph.links,
        { id: 51, origin_id: -10, origin_slot: 0, target_id: 21, target_slot: 1, type: 'STRING' },
      ],
      nodes: promotingSubgraph.nodes.map((node) =>
        node.id === 21
          ? {
              ...node,
              inputs: [
                ...node.inputs,
                { name: 'text', type: 'STRING', link: 51, widget: { name: 'text' } },
              ],
            }
          : node,
      ),
    } as unknown as WorkflowSubgraphDefinition;

    const keys = resolvePromotedWidgetKeys(promotingPlaceholder, subgraph);

    expect(keys.has(promotedWidgetKey(21, 'text'))).toBe(true);
    expect(keys.has(promotedWidgetKey(22, 'text'))).toBe(true);
  });

  it('uses the inner slot name when the boundary slot was renamed', () => {
    const placeholder = {
      ...promotingPlaceholder,
      properties: { proxyWidgets: [['-1', 'prompt']] },
      inputs: [{ name: 'prompt', type: 'STRING', link: null, widget: { name: 'prompt' } }],
    } as unknown as WorkflowNode;
    const subgraph = {
      ...promotingSubgraph,
      inputs: [{ id: 'slot-1', name: 'prompt', type: 'STRING', linkIds: [50] }],
    } as unknown as WorkflowSubgraphDefinition;

    const keys = resolvePromotedWidgetKeys(placeholder, subgraph);

    expect(keys.has(promotedWidgetKey(22, 'text'))).toBe(true);
    expect(keys.has(promotedWidgetKey(22, 'prompt'))).toBe(false);
  });

  it('skips a fan-out target whose slot is a plain socket', () => {
    const subgraph = {
      ...promotingSubgraph,
      links: [
        ...promotingSubgraph.links,
        { id: 51, origin_id: -10, origin_slot: 0, target_id: 21, target_slot: 1, type: 'STRING' },
      ],
      nodes: promotingSubgraph.nodes.map((node) =>
        node.id === 21
          ? { ...node, inputs: [...node.inputs, { name: 'text', type: 'STRING', link: 51 }] }
          : node,
      ),
    } as unknown as WorkflowSubgraphDefinition;

    const keys = resolvePromotedWidgetKeys(promotingPlaceholder, subgraph);

    expect(keys.has(promotedWidgetKey(22, 'text'))).toBe(true);
    expect(keys.has(promotedWidgetKey(21, 'text'))).toBe(false);
  });

  it('promotes nothing when the boundary input reaches no inner node', () => {
    const subgraph = {
      ...promotingSubgraph,
      links: [],
    } as unknown as WorkflowSubgraphDefinition;

    const keys = resolvePromotedWidgetKeys(promotingPlaceholder, subgraph);

    expect(keys.has(promotedWidgetKey(21, 'text'))).toBe(false);
    expect(keys.has(promotedWidgetKey(22, 'text'))).toBe(false);
    expect(keys.has(promotedWidgetKey(31, 'seed'))).toBe(true);
  });
});
