import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { getInstanceNumber, getMobileDefMeta } from '../canonicalWorkflowOps';
import { numberSubgraphInstances } from '../subgraphInstanceNumbers';

function placeholder(id: number, instanceNumber?: number): WorkflowNode {
  return {
    id,
    type: 'sg',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: instanceNumber == null ? {} : { mobileInstanceNumber: instanceNumber },
    widgets_values: [],
  } as unknown as WorkflowNode;
}

function workflowWith(rootIds: Array<[number, number | undefined]>, extra?: unknown): Workflow {
  return {
    last_node_id: 100,
    last_link_id: 0,
    nodes: rootIds.map(([id, n]) => placeholder(id, n)),
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [
        { id: 'sg', name: 'Layer {n}', inputs: [], outputs: [], nodes: [], links: [], ...(extra ? { extra } : {}) },
      ],
    },
  } as unknown as Workflow;
}

const numbersIn = (workflow: Workflow) =>
  workflow.nodes.map((node) => getInstanceNumber(node));

describe('numberSubgraphInstances', () => {
  it('numbers instances that never had numbers, lowest id first', () => {
    // What a subgraph imported from desktop looks like: no numbers at all.
    const result = numberSubgraphInstances(workflowWith([[7, undefined], [3, undefined]]), 'sg');

    expect(numbersIn(result.workflow)).toEqual([2, 1]);
    expect(result.next).toBe(3);
  });

  it('leaves existing numbers alone and fills the gaps around them', () => {
    // Renumbering to close the gap would rename instances the user never
    // touched — a {n} name shows these numbers on the card.
    const result = numberSubgraphInstances(
      workflowWith([[1, 3], [2, undefined], [3, undefined], [4, 1]]),
      'sg',
    );

    expect(numbersIn(result.workflow)).toEqual([3, 2, 4, 1]);
    expect(result.next).toBe(5);
  });

  it('does not reuse a number the stored counter has already moved past', () => {
    // Instance 2 was deleted. Handing its number to the next one would give two
    // different things the same name over the life of the workflow.
    const result = numberSubgraphInstances(
      workflowWith([[1, 1]], { 'comfyui-mobile': { nextInstanceNumber: 3 } }),
      'sg',
    );

    expect(result.next).toBe(3);
  });

  it('numbers instances nested inside other definitions too', () => {
    const workflow = workflowWith([[1, undefined]]);
    workflow.definitions!.subgraphs!.push({
      id: 'outer',
      name: 'Outer',
      inputs: [],
      outputs: [],
      nodes: [placeholder(9)],
      links: [],
    } as never);

    const result = numberSubgraphInstances(workflow, 'sg');
    const nested = result.workflow.definitions!.subgraphs!.find((d) => d.id === 'outer')!;

    expect(getInstanceNumber(result.workflow.nodes[0])).toBe(1);
    expect(getInstanceNumber(nested.nodes![0])).toBe(2);
  });

  it('returns the workflow untouched when everything is already numbered', () => {
    const workflow = workflowWith([[1, 1], [2, 2]]);
    const result = numberSubgraphInstances(workflow, 'sg');

    expect(result.workflow).toBe(workflow);
    expect(result.next).toBe(3);
    expect(getMobileDefMeta(result.workflow.definitions!.subgraphs![0]).nextInstanceNumber)
      .toBeUndefined();
  });
});
