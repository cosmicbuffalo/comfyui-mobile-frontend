import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import type { MobileLayout } from '@/utils/mobileLayout';
import { getGroupKey } from '@/utils/mobileLayout';
import { resolveItemReferenceAppearance } from '@/utils/itemParentage';

const OUTER = 'sg-outer';

function node(id: number, type = 'KSampler', overrides?: Partial<WorkflowNode>): WorkflowNode {
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
    ...overrides,
  } as WorkflowNode;
}

/**
 * root
 *   └ group 1 "Outer group"
 *       └ placeholder 10 (OUTER)
 *            └ group 2 "Inner group"
 *                 └ node 20
 */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 20,
    last_link_id: 0,
    nodes: [node(10, OUTER)],
    links: [],
    groups: [{ id: 1, title: 'Outer group', bounding: [0, 0, 400, 400], color: '#3f789e' }],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [
        {
          id: OUTER,
          name: 'Outer',
          inputs: [],
          outputs: [],
          nodes: [node(20)],
          links: [],
          groups: [{ id: 2, title: 'Inner group', bounding: [0, 0, 200, 200], color: '#a1309b' }],
        },
      ],
    },
  } as unknown as Workflow;
}

function makeLayout(): MobileLayout {
  const outerGroup = getGroupKey(1, null);
  const innerGroup = getGroupKey(2, OUTER);
  return {
    root: [{ type: 'group', id: 1, subgraphId: null, itemKey: outerGroup }],
    groups: {
      // The placeholder is a `subgraph` ref carrying its node id, never a
      // `node` ref — matching only `node` found a group for nothing the
      // instance lists actually display.
      [outerGroup]: [{ type: 'subgraph', id: OUTER, nodeId: 10 }],
      [innerGroup]: [{ type: 'node', id: 20 }],
    },
    groupParents: {
      [outerGroup]: { scope: 'root' },
      [innerGroup]: { scope: 'subgraph', subgraphId: OUTER },
    },
    subgraphs: { [OUTER]: [{ type: 'group', id: 2, subgraphId: OUTER, itemKey: innerGroup }] },
  } as unknown as MobileLayout;
}

const labels = (workflow: Workflow, layout: MobileLayout | null, nodeId: number) =>
  resolveItemReferenceAppearance(workflow, layout, null, {
    nodeId,
    subgraphId: null,
  }).parents.map((chip) => chip.label);

describe('resolveItemReferenceAppearance', () => {
  it('names every container down to the item, outermost first', () => {
    expect(labels(makeWorkflow(), makeLayout(), 20)).toEqual([
      'Outer group',
      'Outer',
      'Inner group',
    ]);
  });

  it('finds the group holding a placeholder, which is a subgraph ref', () => {
    // The bug this pins: a group whose member is a placeholder was invisible,
    // so the trail lost every level above a subgraph.
    expect(labels(makeWorkflow(), makeLayout(), 10)).toEqual(['Outer group']);
  });

  it('has nothing to say about a node sitting loose at root', () => {
    const workflow = makeWorkflow();
    workflow.nodes.push(node(30));
    expect(labels(workflow, makeLayout(), 30)).toEqual([]);
  });

  it('falls back to the group id when a group has no title', () => {
    const workflow = makeWorkflow();
    workflow.groups[0].title = '   ';
    expect(labels(workflow, makeLayout(), 20)[0]).toBe('Group 1');
  });

  it('paints each chip over the ones above it, so nesting reads as depth', () => {
    const { parents } = resolveItemReferenceAppearance(makeWorkflow(), makeLayout(), null, {
      nodeId: 20,
      subgraphId: null,
    });
    // Every chip resolves to a real colour rather than inheriting the panel,
    // and the two groups differ — they are tinted by their own colours.
    for (const chip of parents) {
      expect(chip.surfaceColor).toMatch(/^(#|rgb)/);
      expect(chip.borderColor).toMatch(/^(#|rgb)/);
    }
    expect(parents[0].surfaceColor).not.toBe(parents[2].surfaceColor);
  });

  it('still gives an item its own colours with no workflow at all', () => {
    const appearance = resolveItemReferenceAppearance(null, null, null, {
      nodeId: 1,
      subgraphId: null,
    });
    expect(appearance.parents).toEqual([]);
    expect(appearance.surfaceColor).toMatch(/^(#|rgb)/);
  });

  it('survives a layout that has not been built yet', () => {
    expect(labels(makeWorkflow(), null, 20)).toEqual(['Outer']);
  });
});
