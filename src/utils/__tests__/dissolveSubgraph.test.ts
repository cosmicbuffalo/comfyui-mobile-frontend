import { describe, expect, it } from 'vitest';
import { dissolveSubgraph } from '../dissolveSubgraph';
import type {
  NodeTypes,
  Workflow,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import {
  getLinkId,
  getLinkOriginId,
  getLinkOriginSlot,
  getLinkTargetId,
  getLinkTargetSlot,
} from '@/utils/canonicalWorkflowOps';

function makeNode(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
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
  };
}

function makeWorkflow(
  rootNodes: WorkflowNode[],
  rootLinks: WorkflowLink[],
  subgraphs: WorkflowSubgraphDefinition[],
): Workflow {
  return {
    nodes: rootNodes,
    links: rootLinks,
    groups: [],
    last_node_id: Math.max(0, ...rootNodes.map((n) => n.id)),
    last_link_id: Math.max(0, ...rootLinks.map((l) => l[0])),
    version: 1,
    config: {},
    extra: {},
    definitions: { subgraphs },
  } as unknown as Workflow;
}

const SG_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/**
 * Definition: inner chain 10 → 20 (MODEL), with a boundary input feeding
 * 10's input 0 and a boundary output from 20's output 0.
 */
function makeChainDef(): WorkflowSubgraphDefinition {
  return {
    id: SG_ID,
    name: 'Chain',
    inputs: [{ name: 'model_in', type: 'MODEL' }],
    outputs: [{ name: 'model_out', type: 'MODEL' }],
    nodes: [
      makeNode(10, 'InnerA', {
        inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
        outputs: [{ name: 'out', type: 'MODEL', links: [2] }],
      }),
      makeNode(20, 'InnerB', {
        inputs: [{ name: 'model', type: 'MODEL', link: 2 }],
        outputs: [{ name: 'out', type: 'MODEL', links: [3] }],
      }),
    ],
    links: [
      { id: 1, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'MODEL' },
      { id: 2, origin_id: 10, origin_slot: 0, target_id: 20, target_slot: 0, type: 'MODEL' },
      { id: 3, origin_id: 20, origin_slot: 0, target_id: -20, target_slot: 0, type: 'MODEL' },
    ],
    groups: [],
  } as unknown as WorkflowSubgraphDefinition;
}

function makeRootFixture() {
  const source = makeNode(1, 'Loader', {
    outputs: [{ name: 'out', type: 'MODEL', links: [100] }],
  });
  const sink = makeNode(2, 'Saver', {
    inputs: [{ name: 'model', type: 'MODEL', link: 101 }],
  });
  const placeholder = makeNode(5, SG_ID, {
    inputs: [{ name: 'model_in', type: 'MODEL', link: 100 }],
    outputs: [{ name: 'model_out', type: 'MODEL', links: [101] }],
  });
  const links: WorkflowLink[] = [
    [100, 1, 0, 5, 0, 'MODEL'],
    [101, 5, 0, 2, 0, 'MODEL'],
  ];
  return makeWorkflow([source, sink, placeholder], links, [makeChainDef()]);
}

describe('dissolveSubgraph', () => {
  it('promotes inner nodes with fresh IDs and preserves all wiring', () => {
    const wf = makeRootFixture();
    const result = dissolveSubgraph(wf, SG_ID, null, null);
    expect(result).not.toBeNull();
    const next = result!.workflow;

    // Placeholder gone, two promoted nodes with fresh non-colliding IDs.
    expect(next.nodes.map((n) => n.type).sort()).toEqual(['InnerA', 'InnerB', 'Loader', 'Saver']);
    const innerA = next.nodes.find((n) => n.type === 'InnerA')!;
    const innerB = next.nodes.find((n) => n.type === 'InnerB')!;
    expect(innerA.id).toBeGreaterThan(5);
    expect(innerB.id).toBeGreaterThan(5);

    // All links unique, tuple format, no reference to the placeholder.
    const ids = next.links.map((l) => getLinkId(l));
    expect(new Set(ids).size).toBe(ids.length);
    for (const link of next.links) {
      expect(Array.isArray(link)).toBe(true);
      expect(getLinkOriginId(link)).not.toBe(5);
      expect(getLinkTargetId(link)).not.toBe(5);
    }

    // Wiring: 1 → innerA → innerB → 2.
    const byEndpoints = next.links.map((l) => [
      getLinkOriginId(l),
      getLinkOriginSlot(l),
      getLinkTargetId(l),
      getLinkTargetSlot(l),
    ]);
    expect(byEndpoints).toContainEqual([1, 0, innerA.id, 0]);
    expect(byEndpoints).toContainEqual([innerA.id, 0, innerB.id, 0]);
    expect(byEndpoints).toContainEqual([innerB.id, 0, 2, 0]);

    // Node link references rebuilt consistently.
    const linkInto = (nodeId: number, slot: number) =>
      next.links.find((l) => getLinkTargetId(l) === nodeId && getLinkTargetSlot(l) === slot);
    expect(innerA.inputs[0]?.link).toBe(getLinkId(linkInto(innerA.id, 0)!));
    expect(innerB.inputs[0]?.link).toBe(getLinkId(linkInto(innerB.id, 0)!));
    expect(next.nodes.find((n) => n.id === 2)?.inputs[0]?.link).toBe(
      getLinkId(linkInto(2, 0)!),
    );

    // Definition removed; counters advanced.
    expect(next.definitions?.subgraphs ?? []).toHaveLength(0);
    expect(next.last_node_id).toBeGreaterThanOrEqual(innerB.id);
    expect(next.last_link_id).toBeGreaterThanOrEqual(Math.max(...ids));
  });

  it('bakes promoted widget values into the promoted nodes', () => {
    const nodeTypes: NodeTypes = {
      InnerA: {
        input: { required: { text: ['STRING', {}] } },
        output: ['MODEL'],
        output_name: ['MODEL'],
        name: 'InnerA',
        display_name: 'Inner A',
        description: '',
        python_module: '',
        category: 'test',
      },
    };
    const def: WorkflowSubgraphDefinition = {
      id: SG_ID,
      name: 'Promoted',
      inputs: [{ name: 'text', type: 'STRING' }],
      outputs: [],
      nodes: [
        makeNode(10, 'InnerA', {
          inputs: [{ name: 'text', type: 'STRING', link: 1, widget: { name: 'text' } }],
          widgets_values: ['stale'],
        }),
      ],
      links: [
        { id: 1, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'STRING' },
      ],
      groups: [],
    } as unknown as WorkflowSubgraphDefinition;
    const placeholder = makeNode(5, SG_ID, {
      inputs: [{ name: 'text', type: 'STRING', link: null, widget: { name: 'text' } }],
      widgets_values: ['fresh'],
    });
    const wf = makeWorkflow([placeholder], [], [def]);

    const next = dissolveSubgraph(wf, SG_ID, null, nodeTypes)!.workflow;
    expect(next.nodes.find((n) => n.type === 'InnerA')?.widgets_values).toEqual(['fresh']);
    // Definition untouched (immutability).
    expect(def.nodes[0]?.widgets_values).toEqual(['stale']);
  });

  it('dissolves multiple instances independently and keeps IDs distinct', () => {
    const wf = makeRootFixture();
    const placeholderB = makeNode(6, SG_ID, { inputs: [], outputs: [] });
    wf.nodes.push(placeholderB);
    wf.last_node_id = 6;

    const next = dissolveSubgraph(wf, SG_ID, null, null)!.workflow;

    // 2 root + 2 inner per instance × 2 instances.
    expect(next.nodes).toHaveLength(6);
    const allIds = next.nodes.map((n) => n.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(next.definitions?.subgraphs ?? []).toHaveLength(0);
  });

  it('keeps the definition when another scope still references it', () => {
    const wf = makeRootFixture();
    const otherSgId = 'ffffffff-1111-2222-3333-444444444444';
    wf.definitions!.subgraphs!.push({
      id: otherSgId,
      name: 'Other',
      inputs: [],
      outputs: [],
      nodes: [makeNode(30, SG_ID)], // nested placeholder of SG_ID
      links: [],
      groups: [],
    } as unknown as WorkflowSubgraphDefinition);

    const next = dissolveSubgraph(wf, SG_ID, null, null)!.workflow;
    expect(next.definitions?.subgraphs?.map((sg) => sg.id)).toContain(SG_ID);
  });

  it('dissolves inside a parent subgraph using object-format links', () => {
    const parentId = 'bbbbbbbb-2222-3333-4444-555555555555';
    const chain = makeChainDef();
    const parentDef: WorkflowSubgraphDefinition = {
      id: parentId,
      name: 'Parent',
      inputs: [],
      outputs: [],
      nodes: [
        makeNode(40, 'Loader', { outputs: [{ name: 'out', type: 'MODEL', links: [7] }] }),
        makeNode(41, SG_ID, {
          inputs: [{ name: 'model_in', type: 'MODEL', link: 7 }],
          outputs: [{ name: 'model_out', type: 'MODEL', links: [8] }],
        }),
        makeNode(42, 'Saver', { inputs: [{ name: 'model', type: 'MODEL', link: 8 }] }),
      ],
      links: [
        { id: 7, origin_id: 40, origin_slot: 0, target_id: 41, target_slot: 0, type: 'MODEL' },
        { id: 8, origin_id: 41, origin_slot: 0, target_id: 42, target_slot: 0, type: 'MODEL' },
      ],
      groups: [],
    } as unknown as WorkflowSubgraphDefinition;
    const rootPlaceholder = makeNode(1, parentId);
    const wf = makeWorkflow([rootPlaceholder], [], [chain, parentDef]);

    const next = dissolveSubgraph(wf, SG_ID, parentId, null)!.workflow;
    const parent = next.definitions?.subgraphs?.find((sg) => sg.id === parentId);
    expect(parent).toBeDefined();
    expect(parent!.nodes.map((n) => n.type).sort()).toEqual([
      'InnerA',
      'InnerB',
      'Loader',
      'Saver',
    ]);
    // Object format, unique IDs, no placeholder references.
    const ids = parent!.links.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const link of parent!.links) {
      expect(Array.isArray(link)).toBe(false);
      expect(link.origin_id).not.toBe(41);
      expect(link.target_id).not.toBe(41);
    }
    const innerA = parent!.nodes.find((n) => n.type === 'InnerA')!;
    const innerB = parent!.nodes.find((n) => n.type === 'InnerB')!;
    const byEndpoints = parent!.links.map((l) => [l.origin_id, l.target_id]);
    expect(byEndpoints).toContainEqual([40, innerA.id]);
    expect(byEndpoints).toContainEqual([innerA.id, innerB.id]);
    expect(byEndpoints).toContainEqual([innerB.id, 42]);
    // SG_ID definition removed, parent kept.
    expect(next.definitions?.subgraphs?.map((sg) => sg.id)).toEqual([parentId]);
  });

  it('promotes groups with fresh IDs and reports the mapping', () => {
    const wf = makeRootFixture();
    (wf.definitions!.subgraphs![0] as WorkflowSubgraphDefinition).groups = [
      { id: 1, title: 'Inner group', color: '#fff', bounding: [0, 0, 100, 100] },
    ];
    wf.groups = [{ id: 3, title: 'Root group', color: '#fff', bounding: [0, 0, 50, 50] }];

    const result = dissolveSubgraph(wf, SG_ID, null, null)!;
    const promoted = result.workflow.groups.find((g) => g.title === 'Inner group');
    expect(promoted).toBeDefined();
    expect(promoted!.id).toBeGreaterThan(3);
    expect(result.groupIdMap.get(1)).toBe(promoted!.id);
  });

  it('returns null for an unknown subgraph or missing placeholder', () => {
    const wf = makeRootFixture();
    expect(dissolveSubgraph(wf, 'nope', null, null)).toBeNull();
    wf.nodes = wf.nodes.filter((n) => n.type !== SG_ID);
    expect(dissolveSubgraph(wf, SG_ID, null, null)).toBeNull();
  });
});
