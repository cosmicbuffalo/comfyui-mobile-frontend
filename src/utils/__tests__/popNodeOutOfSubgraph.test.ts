import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode, WorkflowSubgraphDefinition } from '@/api/types';
import {
  getPopOutTerminalKind,
  popNodeOutOfSubgraph,
} from '../popNodeOutOfSubgraph';

const INNER = 'inner-subgraph';
const PARENT = 'parent-subgraph';

function node(id: number, type: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type,
    pos: [id * 10, id * 10],
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

function placeholder(id: number, type: string): WorkflowNode {
  return node(id, type);
}

function sourceDefinition(): WorkflowSubgraphDefinition {
  return {
    id: INNER,
    name: 'Inner',
    inputs: [],
    outputs: [],
    nodes: [
      node(10, 'LoadImage', {
        title: 'Loader',
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
      }),
      node(11, 'Process', {
        inputs: [{ name: 'image', type: 'IMAGE', link: 1 }],
      }),
    ],
    links: [
      { id: 1, origin_id: 10, origin_slot: 0, target_id: 11, target_slot: 0, type: 'IMAGE' },
    ],
  };
}

function sinkDefinition(): WorkflowSubgraphDefinition {
  return {
    id: INNER,
    name: 'Inner',
    inputs: [],
    outputs: [],
    nodes: [
      node(11, 'Process', {
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1] }],
      }),
      node(12, 'SaveImage', {
        title: 'Saver',
        inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
      }),
    ],
    links: [
      { id: 1, origin_id: 11, origin_slot: 0, target_id: 12, target_slot: 0, type: 'IMAGE' },
    ],
  };
}

function workflow(definitions: WorkflowSubgraphDefinition[], rootNodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: Math.max(...rootNodes.map((entry) => entry.id), 20),
    last_link_id: 0,
    nodes: rootNodes,
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: { subgraphs: definitions },
  };
}

describe('getPopOutTerminalKind', () => {
  it('accepts one-sided terminals and rejects middle, isolated, and boundary-connected nodes', () => {
    expect(getPopOutTerminalKind(sourceDefinition(), 10)).toBe('source');
    expect(getPopOutTerminalKind(sinkDefinition(), 12)).toBe('sink');
    expect(getPopOutTerminalKind(sourceDefinition(), 11)).toBe('sink');

    const middle = sourceDefinition();
    middle.nodes[1].outputs = [{ name: 'out', type: 'IMAGE', links: [2] }];
    middle.nodes.push(node(13, 'Next', { inputs: [{ name: 'in', type: 'IMAGE', link: 2 }] }));
    middle.links.push({ id: 2, origin_id: 11, origin_slot: 0, target_id: 13, target_slot: 0, type: 'IMAGE' });
    expect(getPopOutTerminalKind(middle, 11)).toBeNull();
    expect(getPopOutTerminalKind(middle, 13)).toBe('sink');
    expect(getPopOutTerminalKind(middle, 999)).toBeNull();

    const boundaryFed = sinkDefinition();
    boundaryFed.links[0] = { id: 1, origin_id: -10, origin_slot: 0, target_id: 12, target_slot: 0, type: 'IMAGE' };
    expect(getPopOutTerminalKind(boundaryFed, 12)).toBeNull();
  });
});

describe('popNodeOutOfSubgraph', () => {
  it('pops one source node to root and feeds every direct instance through a new input', () => {
    const result = popNodeOutOfSubgraph(
      workflow([sourceDefinition()], [placeholder(1, INNER), placeholder(2, INNER)]),
      INNER,
      10,
    )!;

    expect(result.kind).toBe('source');
    expect(result.rootNodeIds).toHaveLength(1);
    const rootSource = result.workflow.nodes.find((entry) => entry.id === result.rootNodeIds[0])!;
    expect(rootSource.type).toBe('LoadImage');
    const def = result.workflow.definitions!.subgraphs![0];
    expect(def.nodes.map((entry) => entry.type)).toEqual(['Process']);
    expect(def.inputs).toHaveLength(1);
    expect(def.links).toEqual([
      expect.objectContaining({ origin_id: -10, origin_slot: 0, target_id: 11, target_slot: 0 }),
    ]);
    expect(result.workflow.links).toEqual(expect.arrayContaining([
      expect.arrayContaining([rootSource.outputs[0].links![0], rootSource.id, 0, 1, 0, 'IMAGE']),
      expect.arrayContaining([rootSource.outputs[0].links![1], rootSource.id, 0, 2, 0, 'IMAGE']),
    ]));
  });

  it('duplicates a sink once per direct instance and connects each clone through a new output', () => {
    const result = popNodeOutOfSubgraph(
      workflow([sinkDefinition()], [placeholder(1, INNER), placeholder(2, INNER)]),
      INNER,
      12,
    )!;

    expect(result.kind).toBe('sink');
    expect(result.rootNodeIds).toHaveLength(2);
    const def = result.workflow.definitions!.subgraphs![0];
    expect(def.nodes.map((entry) => entry.type)).toEqual(['Process']);
    expect(def.outputs).toHaveLength(1);
    expect(def.links).toEqual([
      expect.objectContaining({ origin_id: 11, origin_slot: 0, target_id: -20, target_slot: 0 }),
    ]);
    for (const [index, cloneId] of result.rootNodeIds.entries()) {
      expect(result.workflow.links).toContainEqual(
        expect.arrayContaining([expect.any(Number), index + 1, 0, cloneId, 0, 'IMAGE']),
      );
    }
  });

  it('threads a source through a parent subgraph and still creates only one root node', () => {
    const parent: WorkflowSubgraphDefinition = {
      id: PARENT,
      name: 'Parent',
      inputs: [],
      outputs: [],
      nodes: [placeholder(50, INNER)],
      links: [],
    };
    const result = popNodeOutOfSubgraph(
      workflow([sourceDefinition(), parent], [placeholder(1, PARENT), placeholder(2, PARENT)]),
      INNER,
      10,
    )!;

    expect(result.rootNodeIds).toHaveLength(1);
    const defs = new Map(result.workflow.definitions!.subgraphs!.map((entry) => [entry.id, entry]));
    expect(defs.get(INNER)!.inputs).toHaveLength(1);
    expect(defs.get(PARENT)!.inputs).toHaveLength(1);
    expect(defs.get(PARENT)!.links).toContainEqual(
      expect.objectContaining({ origin_id: -10, origin_slot: 0, target_id: 50, target_slot: 0 }),
    );
    expect(result.workflow.links.map((link) => link.slice(1, 5))).toEqual(expect.arrayContaining([
      [result.rootNodeIds[0], 0, 1, 0],
      [result.rootNodeIds[0], 0, 2, 0],
    ]));
  });

  it('threads each nested sink instance outward and creates one root clone per concrete path', () => {
    const parent: WorkflowSubgraphDefinition = {
      id: PARENT,
      name: 'Parent',
      inputs: [],
      outputs: [],
      nodes: [placeholder(50, INNER)],
      links: [],
    };
    const result = popNodeOutOfSubgraph(
      workflow([sinkDefinition(), parent], [placeholder(1, PARENT), placeholder(2, PARENT)]),
      INNER,
      12,
    )!;

    expect(result.rootNodeIds).toHaveLength(2);
    const defs = new Map(result.workflow.definitions!.subgraphs!.map((entry) => [entry.id, entry]));
    expect(defs.get(INNER)!.outputs).toHaveLength(1);
    expect(defs.get(PARENT)!.outputs).toHaveLength(1);
    expect(defs.get(PARENT)!.links).toContainEqual(
      expect.objectContaining({ origin_id: 50, origin_slot: 0, target_id: -20, target_slot: 0 }),
    );
    expect(result.workflow.links.map((link) => link.slice(1, 5))).toEqual(expect.arrayContaining([
      [1, 0, result.rootNodeIds[0], 0],
      [2, 0, result.rootNodeIds[1], 0],
    ]));
  });
});
