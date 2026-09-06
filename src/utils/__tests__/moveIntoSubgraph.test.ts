import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { createSubgraphFromSelection } from '../createSubgraphFromSelection';
import { moveNodesIntoSubgraph } from '../moveIntoSubgraph';
import { dissolveSubgraph } from '../dissolveSubgraph';

function node(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
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
  } as WorkflowNode;
}

/** loader → encode → sampler → save */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 4,
    last_link_id: 3,
    nodes: [
      node(1, 'Loader', { outputs: [{ name: 'CLIP', type: 'CLIP', links: [1] }] }),
      node(2, 'Encode', {
        inputs: [{ name: 'clip', type: 'CLIP', link: 1 }],
        outputs: [{ name: 'COND', type: 'COND', links: [2] }],
      }),
      node(3, 'Sampler', {
        inputs: [{ name: 'positive', type: 'COND', link: 2 }],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: [3] }],
      }),
      node(4, 'Save', { inputs: [{ name: 'images', type: 'LATENT', link: 3 }] }),
    ],
    links: [
      [1, 1, 0, 2, 0, 'CLIP'],
      [2, 2, 0, 3, 0, 'COND'],
      [3, 3, 0, 4, 0, 'LATENT'],
    ],
    groups: [],
    config: {},
  } as unknown as Workflow;
}

/** Wrap the encoder, leaving loader → [subgraph] → sampler → save. */
function withWrappedEncoder() {
  const created = createSubgraphFromSelection(
    makeWorkflow(),
    null,
    { nodeIds: [2], groupIds: [] },
    'Encoder',
  )!;
  return created;
}

describe('moveNodesIntoSubgraph', () => {
  it('drops the input slot whose feeder moved inside', () => {
    const wrapped = withWrappedEncoder();
    const def = wrapped.workflow.definitions!.subgraphs![0];
    expect(def.inputs).toHaveLength(1);

    // The loader was feeding the subgraph through that slot; now it is inside.
    const moved = moveNodesIntoSubgraph(
      wrapped.workflow,
      null,
      wrapped.placeholderNodeId,
      [1],
    )!;
    const after = moved.workflow.definitions!.subgraphs![0];

    expect(moved.removedInputs).toBe(1);
    expect(after.inputs).toHaveLength(0);
    // The value now travels by an ordinary link inside, not across the edge.
    expect(after.links.some((l) => l.origin_id === -10)).toBe(false);
    expect(after.nodes.map((n) => n.type).sort()).toEqual(['Encode', 'Loader']);
  });

  it('keeps the output slot while something outside still consumes it', () => {
    const wrapped = withWrappedEncoder();
    const moved = moveNodesIntoSubgraph(
      wrapped.workflow,
      null,
      wrapped.placeholderNodeId,
      [1],
    )!;

    // The sampler is still outside, so the encoder's output must still cross.
    expect(moved.removedOutputs).toBe(0);
    expect(moved.workflow.definitions!.subgraphs![0].outputs).toHaveLength(1);
  });

  it('adds a slot for a link the moved node still has outside', () => {
    const workflow = makeWorkflow();
    // The loader also feeds something that will stay outside.
    workflow.nodes.push(node(5, 'Other', { inputs: [{ name: 'clip', type: 'CLIP', link: 4 }] }));
    workflow.nodes[0].outputs![0].links = [1, 4];
    workflow.links.push([4, 1, 0, 5, 0, 'CLIP'] as never);

    const wrapped = createSubgraphFromSelection(
      workflow,
      null,
      { nodeIds: [2], groupIds: [] },
      'Encoder',
    )!;
    const moved = moveNodesIntoSubgraph(
      wrapped.workflow,
      null,
      wrapped.placeholderNodeId,
      [1],
    )!;

    // One slot went (the encoder's feed) and one arrived (the outside node's).
    expect(moved.removedInputs).toBe(1);
    expect(moved.addedOutputs).toBe(1);
    const def = moved.workflow.definitions!.subgraphs![0];
    expect(def.outputs).toHaveLength(2);
  });

  it('removes the node from the parent scope', () => {
    const wrapped = withWrappedEncoder();
    const moved = moveNodesIntoSubgraph(
      wrapped.workflow,
      null,
      wrapped.placeholderNodeId,
      [1],
    )!;

    expect(moved.workflow.nodes.some((n) => n.type === 'Loader')).toBe(false);
  });

  it('refuses to move the placeholder into itself', () => {
    const wrapped = withWrappedEncoder();
    expect(
      moveNodesIntoSubgraph(wrapped.workflow, null, wrapped.placeholderNodeId, [
        wrapped.placeholderNodeId,
      ]),
    ).toBeNull();
  });

  it('round-trips: wrap, move a node in, then dissolve gives the graph back', () => {
    const before = makeWorkflow();
    const wrapped = createSubgraphFromSelection(
      before,
      null,
      { nodeIds: [2], groupIds: [] },
      'Encoder',
    )!;
    const moved = moveNodesIntoSubgraph(
      wrapped.workflow,
      null,
      wrapped.placeholderNodeId,
      [1],
    )!;
    const dissolved = dissolveSubgraph(moved.workflow, wrapped.subgraphId, null, null)!;

    const shape = (wf: Workflow) =>
      wf.links
        .map((l) => {
          const origin = wf.nodes.find((n) => n.id === l[1]);
          const target = wf.nodes.find((n) => n.id === l[3]);
          return `${origin?.type}:${l[2]} -> ${target?.type}:${l[4]}`;
        })
        .sort();

    expect(dissolved.workflow.nodes.map((n) => n.type).sort()).toEqual(
      before.nodes.map((n) => n.type).sort(),
    );
    expect(shape(dissolved.workflow)).toEqual(shape(before));
  });
});

describe('boundary slot naming', () => {
  it('does not give two added slots the same name', () => {
    // Two INTConstants, both with an output called "value", moved in while they
    // still feed something outside. Two slots called "value" would make the
    // second wear the first one's label and read the first one's schema.
    const workflow = makeWorkflow();
    for (const id of [10, 11]) {
      workflow.nodes.push(
        node(id, 'INTConstant', {
          outputs: [{ name: 'value', type: 'INT', links: [id] }],
        }),
      );
      workflow.nodes[3].inputs!.push({
        name: id === 10 ? 'steps' : 'cfg',
        type: 'INT',
        link: id,
        widget: { name: id === 10 ? 'steps' : 'cfg' },
      } as never);
      workflow.links.push([id, id, 0, 4, workflow.nodes[3].inputs!.length - 1, 'INT'] as never);
    }
    // Keep them feeding something outside so each needs an output slot.
    workflow.nodes.push(node(12, 'PreviewAny', {
      inputs: [
        { name: 'a', type: 'INT', link: 20 },
        { name: 'b', type: 'INT', link: 21 },
      ],
    }));
    workflow.nodes.find((n) => n.id === 10)!.outputs![0].links = [10, 20];
    workflow.nodes.find((n) => n.id === 11)!.outputs![0].links = [11, 21];
    workflow.links.push([20, 10, 0, 12, 0, 'INT'] as never);
    workflow.links.push([21, 11, 0, 12, 1, 'INT'] as never);

    const wrapped = createSubgraphFromSelection(
      workflow,
      null,
      { nodeIds: [4], groupIds: [] },
      'Sampler',
    )!;
    const moved = moveNodesIntoSubgraph(
      wrapped.workflow,
      null,
      wrapped.placeholderNodeId,
      [10, 11],
    )!;

    const def = moved.workflow.definitions!.subgraphs!.find((sg) => sg.id === wrapped.subgraphId)!;
    const outputNames = (def.outputs ?? []).map((slot) => slot.name);
    expect(new Set(outputNames).size).toBe(outputNames.length);
    expect(outputNames).toContain('value');
    expect(outputNames).toContain('value_1');
  });
});

describe('what a moved node stays connected to', () => {
  /** loader → encode → sampler, with the sampler already wrapped. */
  function wrappedSampler() {
    const workflow = {
      last_node_id: 3,
      last_link_id: 2,
      nodes: [
        node(1, 'CheckpointLoader', { outputs: [{ name: 'CLIP', type: 'CLIP', links: [1] }] }),
        node(2, 'CLIPTextEncode', {
          inputs: [{ name: 'clip', type: 'CLIP', link: 1 }],
          outputs: [{ name: 'COND', type: 'CONDITIONING', links: [2] }],
        }),
        node(3, 'KSampler', { inputs: [{ name: 'positive', type: 'CONDITIONING', link: 2 }] }),
      ],
      links: [[1, 1, 0, 2, 0, 'CLIP'], [2, 2, 0, 3, 0, 'CONDITIONING']],
      groups: [],
      config: {},
    } as unknown as Workflow;
    return createSubgraphFromSelection(workflow, null, { nodeIds: [3], groupIds: [] }, 'Sampler')!;
  }

  it('wires the input slot it adds to the source that stayed outside', () => {
    const wrapped = wrappedSampler();
    const moved = moveNodesIntoSubgraph(wrapped.workflow, null, wrapped.placeholderNodeId, [2])!;
    const def = moved.workflow.definitions!.subgraphs!.find((sg) => sg.id === wrapped.subgraphId)!;

    // The slot exists, and something actually crosses it.
    expect(def.inputs).toHaveLength(1);
    expect(def.inputs![0].name).toBe('clip');
    const boundaryLink = def.links.find((l) => l.origin_id === -10);
    expect(boundaryLink).toBeDefined();
    expect(def.inputs![0].linkIds).toEqual([boundaryLink!.id]);

    // And the placeholder is fed by the loader through that slot.
    const parentLink = moved.workflow.links.find(
      (l) => l[3] === wrapped.placeholderNodeId && l[4] === 0,
    );
    expect(parentLink?.[1]).toBe(1);
    const placeholder = moved.workflow.nodes.find((n) => n.id === wrapped.placeholderNodeId)!;
    expect(placeholder.inputs![0].name).toBe('clip');
    expect(placeholder.inputs![0].link).toBe(parentLink![0]);
  });

  it('preserves both sides of new input and output boundary connections', () => {
    const workflow = makeWorkflow();
    workflow.nodes.push(node(5, 'DetachedTarget'));
    const wrapped = createSubgraphFromSelection(
      workflow,
      null,
      { nodeIds: [5], groupIds: [] },
      'Target',
    )!;

    const moved = moveNodesIntoSubgraph(
      wrapped.workflow,
      null,
      wrapped.placeholderNodeId,
      [2],
    )!;
    const def = moved.workflow.definitions!.subgraphs!.find((sg) => sg.id === wrapped.subgraphId)!;
    const placeholder = moved.workflow.nodes.find((n) => n.id === wrapped.placeholderNodeId)!;
    const encode = def.nodes!.find((n) => n.type === 'Encode')!;

    const parentInput = moved.workflow.links.find(
      (link) => link[1] === 1 && link[3] === wrapped.placeholderNodeId,
    )!;
    const innerInput = def.links.find(
      (link) => link.origin_id === -10 && link.target_id === encode.id,
    )!;
    expect(placeholder.inputs![parentInput[4]].link).toBe(parentInput[0]);
    expect(encode.inputs![innerInput.target_slot].link).toBe(innerInput.id);
    expect(def.inputs![innerInput.origin_slot].linkIds).toContain(innerInput.id);

    const innerOutput = def.links.find(
      (link) => link.origin_id === encode.id && link.target_id === -20,
    )!;
    const parentOutput = moved.workflow.links.find(
      (link) => link[1] === wrapped.placeholderNodeId && link[3] === 3,
    )!;
    expect(encode.outputs![innerOutput.origin_slot].links).toContain(innerOutput.id);
    expect(def.outputs![innerOutput.target_slot].linkIds).toContain(innerOutput.id);
    expect(placeholder.outputs![parentOutput[2]].links).toContain(parentOutput[0]);
  });

  it('points the moved node at the boundary link, not the one it came in on', () => {
    const wrapped = wrappedSampler();
    const moved = moveNodesIntoSubgraph(wrapped.workflow, null, wrapped.placeholderNodeId, [2])!;
    const def = moved.workflow.definitions!.subgraphs!.find((sg) => sg.id === wrapped.subgraphId)!;

    const encode = def.nodes!.find((n) => n.type === 'CLIPTextEncode')!;
    const boundaryLink = def.links.find((l) => l.origin_id === -10)!;
    // Citing a link id from the graph above names nothing in here: the input
    // reads as wired with nothing behind it.
    expect(encode.inputs[0].link).toBe(boundaryLink.id);
  });

  it('re-points a node already inside whose feed the move replaced', () => {
    const wrapped = wrappedSampler();
    const moved = moveNodesIntoSubgraph(wrapped.workflow, null, wrapped.placeholderNodeId, [2])!;
    const def = moved.workflow.definitions!.subgraphs!.find((sg) => sg.id === wrapped.subgraphId)!;

    const sampler = def.nodes!.find((n) => n.type === 'KSampler')!;
    const encode = def.nodes!.find((n) => n.type === 'CLIPTextEncode')!;
    const feed = def.links.find((l) => l.target_id === sampler.id && l.target_slot === 0)!;
    expect(feed.origin_id).toBe(encode.id);
    expect(sampler.inputs[0].link).toBe(feed.id);
  });
});

describe('what a move does to the other instances of a shared type', () => {
  /**
   * One type, two instances. Its boundary is [seed, boost]; each instance is
   * fed its own seed and its own boost. Moving instance A's seed source inside
   * makes the `seed` slot redundant — for every instance, because the boundary
   * belongs to the definition.
   */
  function twoInstances() {
    const workflow = {
      last_node_id: 30,
      last_link_id: 4,
      nodes: [
        node(1, 'Seed', { outputs: [{ name: 'INT', type: 'INT', links: [1] }] }),
        node(2, 'Seed', { outputs: [{ name: 'INT', type: 'INT', links: [2] }] }),
        node(3, 'Boost', { outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [3] }] }),
        node(4, 'Boost', { outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [4] }] }),
        node(10, 'KSampler', {
          inputs: [
            { name: 'seed', type: 'INT', link: 1 },
            { name: 'boost', type: 'FLOAT', link: 3 },
          ],
        }),
        node(11, 'KSampler', {
          inputs: [
            { name: 'seed', type: 'INT', link: 2 },
            { name: 'boost', type: 'FLOAT', link: 4 },
          ],
        }),
      ],
      links: [
        [1, 1, 0, 10, 0, 'INT'],
        [2, 2, 0, 11, 0, 'INT'],
        [3, 3, 0, 10, 1, 'FLOAT'],
        [4, 4, 0, 11, 1, 'FLOAT'],
      ],
      groups: [],
      config: {},
    } as unknown as Workflow;

    // Wrap sampler 10, then make sampler 11 a second instance of that type.
    const wrapped = createSubgraphFromSelection(
      workflow,
      null,
      { nodeIds: [10], groupIds: [] },
      'Section',
    )!;
    const second = createSubgraphFromSelection(
      wrapped.workflow,
      null,
      { nodeIds: [11], groupIds: [] },
      'Other',
    )!;
    // Point the second placeholder at the first definition, as an instance.
    const asInstance = {
      ...second.workflow,
      nodes: second.workflow.nodes.map((n) =>
        n.id === second.placeholderNodeId ? { ...n, type: wrapped.subgraphId } : n,
      ),
    } as Workflow;
    return { workflow: asInstance, wrapped, second };
  }

  it('drops the other instance\'s link instead of moving it to another input', () => {
    const { workflow, wrapped, second } = twoInstances();
    // Move instance A's seed source inside: the `seed` slot has nothing left
    // to carry for A, so it goes — for both instances.
    const moved = moveNodesIntoSubgraph(workflow, null, wrapped.placeholderNodeId, [1])!;

    const intoOther = moved.workflow.links.filter((l) => l[3] === second.placeholderNodeId);
    const def = moved.workflow.definitions!.subgraphs!.find((sg) => sg.id === wrapped.subgraphId)!;

    // Whatever it still has must land on a slot that exists, and the boost has
    // to still be the boost — not a seed arriving on another input.
    for (const link of intoOther) {
      expect(link[4]).toBeLessThan((def.inputs ?? []).length);
      const slot = def.inputs![link[4]];
      const source = moved.workflow.nodes.find((n) => n.id === link[1])!;
      expect(slot.type).toBe(source.outputs![0].type);
    }
    // The seed that fed the other instance has nowhere to go now.
    expect(intoOther.some((l) => l[1] === 2)).toBe(false);
    const boost = intoOther.find((l) => l[1] === 4)!;
    expect(boost[4]).toBe(0);
    const other = moved.workflow.nodes.find((n) => n.id === second.placeholderNodeId)!;
    expect(other.inputs![0].name).toBe('boost');
    expect(other.inputs![0].link).toBe(boost[0]);
  });

  it('connects a newly added input only on the instance nodes moved into', () => {
    const wrapped = wrappedSamplerForSharedInstance();
    const moved = moveNodesIntoSubgraph(
      wrapped.workflow,
      null,
      wrapped.targetPlaceholderId,
      [2],
    )!;
    const def = moved.workflow.definitions!.subgraphs!.find(
      (sg) => sg.id === wrapped.subgraphId,
    )!;
    const target = moved.workflow.nodes.find((n) => n.id === wrapped.targetPlaceholderId)!;
    const sibling = moved.workflow.nodes.find((n) => n.id === wrapped.siblingPlaceholderId)!;
    const targetLink = moved.workflow.links.find(
      (link) => link[3] === wrapped.targetPlaceholderId && link[4] === 0,
    )!;

    expect(def.inputs?.map((slot) => slot.name)).toEqual(['clip']);
    expect(target.inputs?.map((slot) => slot.name)).toEqual(['clip']);
    expect(target.inputs![0].link).toBe(targetLink[0]);
    expect(sibling.inputs?.map((slot) => slot.name)).toEqual(['clip']);
    expect(sibling.inputs![0].link).toBeNull();
  });

  function wrappedSamplerForSharedInstance() {
    const workflow = {
      last_node_id: 3,
      last_link_id: 2,
      nodes: [
        node(1, 'CheckpointLoader', { outputs: [{ name: 'CLIP', type: 'CLIP', links: [1] }] }),
        node(2, 'CLIPTextEncode', {
          inputs: [{ name: 'clip', type: 'CLIP', link: 1 }],
          outputs: [{ name: 'COND', type: 'CONDITIONING', links: [2] }],
        }),
        node(3, 'KSampler', {
          inputs: [{ name: 'positive', type: 'CONDITIONING', link: 2 }],
        }),
      ],
      links: [[1, 1, 0, 2, 0, 'CLIP'], [2, 2, 0, 3, 0, 'CONDITIONING']],
      groups: [],
      config: {},
    } as unknown as Workflow;
    const created = createSubgraphFromSelection(
      workflow,
      null,
      { nodeIds: [3], groupIds: [] },
      'Sampler',
    )!;
    const target = created.workflow.nodes.find((n) => n.id === created.placeholderNodeId)!;
    const siblingPlaceholderId = 20;
    return {
      workflow: {
        ...created.workflow,
        last_node_id: siblingPlaceholderId,
        nodes: [
          ...created.workflow.nodes,
          {
            ...structuredClone(target),
            id: siblingPlaceholderId,
            pos: [target.pos[0] + 300, target.pos[1]],
            inputs: target.inputs?.map((input) => ({ ...input, link: null })),
            outputs: target.outputs?.map((output) => ({ ...output, links: null })),
          },
        ],
      } as Workflow,
      subgraphId: created.subgraphId,
      targetPlaceholderId: created.placeholderNodeId,
      siblingPlaceholderId,
    };
  }
});
