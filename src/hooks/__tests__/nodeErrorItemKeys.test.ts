import { describe, expect, it } from 'vitest';
import { buildNodeErrorsByItemKey } from '@/hooks/useWorkflow/nodeErrors';
import type { NodeError } from '@/hooks/useWorkflowErrors';
import type { Workflow, WorkflowNode } from '@/api/types';

const SUBGRAPH_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeNode(id: number, type: string, itemKey?: string): WorkflowNode {
  return {
    id,
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...(itemKey ? { itemKey } : {}),
  } as unknown as WorkflowNode;
}

/**
 * A workflow shaped like the stock image templates: the root holds a save node
 * and one subgraph placeholder, and every node that actually runs lives inside
 * the definition.
 */
function makeWorkflow(): Workflow {
  return {
    nodes: [
      makeNode(9, 'SaveImage', 'root/node:9'),
      makeNode(57, SUBGRAPH_ID, `root/subgraph:${SUBGRAPH_ID}`),
    ],
    links: [],
    groups: [],
    last_node_id: 57,
    last_link_id: 0,
    version: 1,
    config: {},
    extra: {},
    definitions: {
      subgraphs: [
        {
          id: SUBGRAPH_ID,
          name: 'Text to Image',
          nodes: [makeNode(3, 'KSampler')],
          links: [],
          inputs: [],
          outputs: [],
        },
      ],
    },
  } as unknown as Workflow;
}

const error: NodeError = {
  type: 'invalid_input_type',
  message: 'Failed to convert an input value to a INT value',
  details: 'seed, None',
  inputName: 'seed',
};

describe('buildNodeErrorsByItemKey', () => {
  const innerItemKey = `root/subgraph:${SUBGRAPH_ID}/node:3`;

  it('resolves a hierarchical prompt id to the inner node item key', () => {
    // ComfyUI reports a node inside a subgraph as `<placeholder>:<inner>`, which
    // matches no `node.id` in the canonical workflow. `expandedNodeIdMap`, built
    // when the prompt was queued, is what carries it home.
    const byItemKey = buildNodeErrorsByItemKey(
      makeWorkflow(),
      {},
      { '57:3': innerItemKey, '66': innerItemKey },
      { '57:3': [error] },
    );

    expect(byItemKey).toEqual({ [innerItemKey]: [error] });
  });

  it('resolves the synthetic expanded id the same way', () => {
    // The prompt can also come back keyed by the flat id expansion assigned.
    const byItemKey = buildNodeErrorsByItemKey(
      makeWorkflow(),
      {},
      { '57:3': innerItemKey, '66': innerItemKey },
      { '66': [error] },
    );

    expect(byItemKey).toEqual({ [innerItemKey]: [error] });
  });

  it('resolves a plain root node id', () => {
    const byItemKey = buildNodeErrorsByItemKey(
      makeWorkflow(),
      { 'root/node:9': 'root/node:9' },
      {},
      { '9': [error] },
    );

    expect(byItemKey).toEqual({ 'root/node:9': [error] });
  });

  it('drops an id that resolves to nothing rather than throwing', () => {
    const byItemKey = buildNodeErrorsByItemKey(makeWorkflow(), {}, {}, {
      '404:1': [error],
    });

    expect(byItemKey).toEqual({});
  });
});
