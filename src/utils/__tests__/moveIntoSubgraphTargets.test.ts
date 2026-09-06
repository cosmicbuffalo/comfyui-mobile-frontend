import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { collectMoveIntoSubgraphTargets } from '@/utils/moveIntoSubgraphTargets';

const OUTER = 'sg-outer';
const INNER = 'sg-inner';

function node(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: `root/node:${id}`,
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
    ...overrides,
  } as WorkflowNode;
}

/**
 * Root holds a plain node and one subgraph placeholder. That subgraph's own
 * scope holds two plain nodes and nothing nested — the case where the action
 * had nowhere to lead.
 */
function makeWorkflow(innerNodes: WorkflowNode[] = []): Workflow {
  return {
    last_node_id: 20,
    last_link_id: 0,
    nodes: [node(1, 'INTConstant'), node(2, OUTER)],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [
        {
          id: OUTER,
          name: 'Outer',
          inputs: [],
          outputs: [],
          nodes: [
            node(10, 'CLIPTextEncode', { itemKey: `${OUTER}/node:10` }),
            node(11, 'KSampler', { itemKey: `${OUTER}/node:11` }),
            ...innerNodes,
          ],
          links: [],
          groups: [],
        },
        { id: INNER, name: 'Inner', inputs: [], outputs: [], nodes: [], links: [], groups: [] },
      ],
    },
  } as unknown as Workflow;
}

const ROOT = [{ type: 'root' } as const];
const IN_OUTER = [
  { type: 'root' } as const,
  { type: 'subgraph', id: OUTER, placeholderNodeId: 2 } as const,
];

describe('collectMoveIntoSubgraphTargets', () => {
  it('offers the placeholders sitting in the root scope', () => {
    const targets = collectMoveIntoSubgraphTargets(makeWorkflow(), ROOT, ['root/node:1']);
    expect(targets.map((n) => n.id)).toEqual([2]);
  });

  it('offers nothing inside a subgraph that holds no nested subgraph', () => {
    // The reported bug: the action showed here, opening a picker with no
    // destinations in it.
    expect(
      collectMoveIntoSubgraphTargets(makeWorkflow(), IN_OUTER, [`${OUTER}/node:10`]),
    ).toEqual([]);
  });

  it('offers a nested subgraph once one is in the scope', () => {
    const nested = node(12, INNER, { itemKey: `${OUTER}/node:12` });
    const targets = collectMoveIntoSubgraphTargets(
      makeWorkflow([nested]),
      IN_OUTER,
      [`${OUTER}/node:10`],
    );
    expect(targets.map((n) => n.id)).toEqual([12]);
  });

  it('never offers a placeholder as a destination for itself', () => {
    const nested = node(12, INNER, { itemKey: `${OUTER}/node:12` });
    expect(
      collectMoveIntoSubgraphTargets(makeWorkflow([nested]), IN_OUTER, [`${OUTER}/node:12`]),
    ).toEqual([]);
  });

  it('offers nothing when the workflow defines no subgraphs at all', () => {
    const bare = {
      last_node_id: 1,
      last_link_id: 0,
      nodes: [node(1, 'INTConstant')],
      links: [],
      groups: [],
      config: {},
      version: 1,
    } as unknown as Workflow;
    expect(collectMoveIntoSubgraphTargets(bare, ROOT, ['root/node:1'])).toEqual([]);
  });

  it('offers nothing without a workflow', () => {
    expect(collectMoveIntoSubgraphTargets(null, ROOT, ['root/node:1'])).toEqual([]);
  });

  it('never offers a destination that already lives inside what is moving', () => {
    // Moving placeholder X into Y nests X's type inside Y's. If Y is already
    // inside X, the two definitions end up containing each other and expansion
    // leaves an unexpanded subgraph node for the server to reject.
    const workflow = {
      last_node_id: 20,
      last_link_id: 0,
      nodes: [node(1, OUTER), node(2, INNER)],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          {
            id: OUTER,
            name: 'Outer',
            inputs: [],
            outputs: [],
            // Outer already contains an Inner instance.
            nodes: [node(10, INNER, { itemKey: `${OUTER}/node:10` })],
            links: [],
            groups: [],
          },
          { id: INNER, name: 'Inner', inputs: [], outputs: [], nodes: [], links: [], groups: [] },
        ],
      },
    } as unknown as Workflow;

    // Moving the Outer placeholder: Inner is not a legal destination.
    expect(collectMoveIntoSubgraphTargets(workflow, ROOT, ['root/node:1'])).toEqual([]);
    // The other direction is fine — Inner does not contain Outer.
    expect(
      collectMoveIntoSubgraphTargets(workflow, ROOT, ['root/node:2']).map((n) => n.id),
    ).toEqual([1]);
  });

  it('never offers another instance of the type being moved', () => {
    const workflow = {
      last_node_id: 20,
      last_link_id: 0,
      nodes: [node(1, OUTER), node(2, OUTER)],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          { id: OUTER, name: 'Outer', inputs: [], outputs: [], nodes: [], links: [], groups: [] },
        ],
      },
    } as unknown as Workflow;

    // Node 2 is a sibling instance of the same type: putting node 1 inside it
    // would put the type inside itself.
    expect(collectMoveIntoSubgraphTargets(workflow, ROOT, ['root/node:1'])).toEqual([]);
  });
});
