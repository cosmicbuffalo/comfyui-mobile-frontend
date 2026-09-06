import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import {
  collectOuterConnections,
  findScopeTrailForPlaceholder,
  reconcileScopeStack,
} from '../subgraphInstanceNavigation';

const INNER = 'sg-inner';
const OUTER = 'sg-outer';

function node(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type,
    itemKey: `key:${id}`,
    pos: [0, 0],
    size: [10, 10],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  } as WorkflowNode;
}

/**
 * Two instances of the same type in DIFFERENT parents: instance 10 at root,
 * instance 30 inside another subgraph. Each is fed by its own loader and feeds
 * its own consumer.
 */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 40,
    last_link_id: 40,
    nodes: [
      node(1, 'CheckpointLoader', { outputs: [{ name: 'MODEL', type: 'MODEL', links: [101] }] }),
      node(10, INNER, {
        inputs: [{ name: 'model', type: 'MODEL', link: 101 }],
        outputs: [{ name: 'image', type: 'IMAGE', links: [102] }],
      }),
      node(2, 'SaveImage', { inputs: [{ name: 'images', type: 'IMAGE', link: 102 }] }),
      node(20, OUTER, { inputs: [], outputs: [] }),
    ],
    links: [
      [101, 1, 0, 10, 0, 'MODEL'],
      [102, 10, 0, 2, 0, 'IMAGE'],
    ],
    groups: [],
    config: {},
    definitions: {
      subgraphs: [
        {
          id: INNER,
          name: 'Inner',
          inputs: [{ id: 'i1', name: 'model', type: 'MODEL', linkIds: [] }],
          outputs: [{ id: 'o1', name: 'image', type: 'IMAGE', linkIds: [] }],
          nodes: [],
          links: [],
        },
        {
          id: OUTER,
          name: 'Outer',
          inputs: [],
          outputs: [],
          nodes: [
            node(3, 'LoraLoader', { outputs: [{ name: 'MODEL', type: 'MODEL', links: [201] }] }),
            node(30, INNER, {
              inputs: [{ name: 'model', type: 'MODEL', link: 201 }],
              outputs: [{ name: 'image', type: 'IMAGE', links: null }],
            }),
          ],
          links: [
            { id: 201, origin_id: 3, origin_slot: 0, target_id: 30, target_slot: 0, type: 'MODEL' },
          ],
        },
      ],
    },
  } as unknown as Workflow;
}

describe('findScopeTrailForPlaceholder', () => {
  it('returns the root trail for a placeholder at root', () => {
    expect(findScopeTrailForPlaceholder(makeWorkflow(), 10)).toEqual([{ type: 'root' }]);
  });

  it('returns the trail of the scope a nested placeholder lives in', () => {
    expect(findScopeTrailForPlaceholder(makeWorkflow(), 30)).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: OUTER, placeholderNodeId: 20 },
    ]);
  });

  it('returns null for a node that is nowhere', () => {
    expect(findScopeTrailForPlaceholder(makeWorkflow(), 999)).toBeNull();
  });

  it('does not hang on a definition that contains itself', () => {
    const workflow = makeWorkflow();
    // A malformed file could nest a type inside itself; the walk must still end.
    workflow.definitions!.subgraphs![1].nodes.push(node(31, OUTER));
    expect(findScopeTrailForPlaceholder(workflow, 999)).toBeNull();
  });
});

describe('collectOuterConnections', () => {
  it('finds what feeds a boundary input on every instance, in its own scope', () => {
    const found = collectOuterConnections(makeWorkflow(), INNER, 10, 'input', 0);

    expect(found).toHaveLength(2);
    // The instance the scope was entered through sorts first.
    expect(found[0]).toMatchObject({
      instanceNodeId: 10,
      isCurrentInstance: true,
      outerNodeId: 1,
      outerNodeName: 'CheckpointLoader',
    });
    expect(found[0].trail).toEqual([{ type: 'root' }]);
    expect(found[1]).toMatchObject({
      instanceNodeId: 30,
      isCurrentInstance: false,
      outerNodeId: 3,
      outerNodeName: 'LoraLoader',
    });
    // Reaching the other instance's feeder means changing scope, not just node.
    expect(found[1].trail).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: OUTER, placeholderNodeId: 20 },
    ]);
  });

  it('skips instances whose slot is unconnected outside', () => {
    // Only instance 10's output is wired; instance 30's is not.
    const found = collectOuterConnections(makeWorkflow(), INNER, 10, 'output', 0);
    expect(found.map(({ instanceNodeId }) => instanceNodeId)).toEqual([10]);
    expect(found[0]).toMatchObject({ outerNodeId: 2, outerNodeName: 'SaveImage' });
  });

  it('reports every consumer of an output slot on one instance', () => {
    const workflow = makeWorkflow();
    // Instance 10's image now feeds two nodes.
    workflow.nodes.push(
      node(4, 'PreviewImage', { inputs: [{ name: 'images', type: 'IMAGE', link: 103 }] }),
    );
    workflow.nodes = workflow.nodes.map((n) =>
      n.id === 10 ? { ...n, outputs: [{ name: 'image', type: 'IMAGE', links: [102, 103] }] } : n,
    );
    workflow.links.push([103, 10, 0, 4, 0, 'IMAGE']);

    const found = collectOuterConnections(workflow, INNER, 10, 'output', 0);
    expect(found.map(({ outerNodeName }) => outerNodeName)).toEqual([
      'SaveImage',
      'PreviewImage',
    ]);
  });

  it('marks nothing as current when the scope has no instance context', () => {
    const found = collectOuterConnections(makeWorkflow(), INNER, null, 'input', 0);
    expect(found.every(({ isCurrentInstance }) => !isCurrentInstance)).toBe(true);
  });
});

/**
 * What happens to where you are standing when the graph changes under you —
 * an undo restoring a snapshot that no longer holds the instance you entered
 * through, most of all.
 */
describe('reconcileScopeStack', () => {
  it('keeps the scope when the instance you entered through survives', () => {
    const workflow = makeWorkflow();
    const stack = [
      { type: 'root' as const },
      { type: 'subgraph' as const, id: INNER, placeholderNodeId: 10 },
    ];
    expect(reconcileScopeStack(stack, workflow)).toEqual(stack);
  });

  it('falls back to a sibling instance when the one you entered through is gone', () => {
    // Instance 10 removed; instance 30 (inside OUTER) is the only one left.
    const workflow = makeWorkflow();
    workflow.nodes = (workflow.nodes ?? []).filter((candidate) => candidate.id !== 10);

    const reconciled = reconcileScopeStack(
      [{ type: 'root' }, { type: 'subgraph', id: INNER, placeholderNodeId: 10 }],
      workflow,
    );

    // You stay in the same subgraph TYPE, on another of its instances, rather
    // than being dropped at root. The definition is shared, so what is on
    // screen is still the thing you were editing — but the per-instance values
    // belong to a different instance now. That is deliberate and it is not
    // silent: SubgraphScopeHeader renders SubgraphInstancePicker, which names
    // the instance you are on, so the header changes when this happens.
    expect(reconciled).toEqual([
      { type: 'root' },
      { type: 'subgraph', id: INNER, placeholderNodeId: 30, enteredPlaceholderNodeId: undefined },
    ]);
  });

  it('drops to root when the whole type is gone', () => {
    const workflow = makeWorkflow();
    workflow.definitions = {
      subgraphs: (workflow.definitions?.subgraphs ?? []).filter(
        (definition) => definition.id !== INNER,
      ),
    };

    // Undoing the creation of a subgraph genuinely cannot leave you inside it.
    expect(
      reconcileScopeStack(
        [{ type: 'root' }, { type: 'subgraph', id: INNER, placeholderNodeId: 10 }],
        workflow,
      ),
    ).toEqual([{ type: 'root' }]);
  });

  it('drops the tail rather than keeping a frame under a broken parent', () => {
    const workflow = makeWorkflow();
    workflow.definitions = {
      subgraphs: (workflow.definitions?.subgraphs ?? []).filter(
        (definition) => definition.id !== OUTER,
      ),
    };

    expect(
      reconcileScopeStack(
        [
          { type: 'root' },
          { type: 'subgraph', id: OUTER, placeholderNodeId: 20 },
          { type: 'subgraph', id: INNER, placeholderNodeId: 30 },
        ],
        workflow,
      ),
    ).toEqual([{ type: 'root' }]);
  });
});
