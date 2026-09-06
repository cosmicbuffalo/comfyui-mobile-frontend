import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { getInstanceNumber, getMobileDefMeta } from '../canonicalWorkflowOps';
import { resolveSubgraphPlaceholderWidgetDefs } from '../widgetDefinitions';
import { createSubgraphFromSelection } from '../createSubgraphFromSelection';
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

/**
 * loader → (encodeA, encodeB) → sampler → save
 *
 * Selecting the two encoders exercises both dedup rules at once: they share one
 * outside source (the loader's CLIP), and both feed the one sampler.
 */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 5,
    last_link_id: 5,
    nodes: [
      node(1, 'CheckpointLoader', {
        outputs: [{ name: 'CLIP', type: 'CLIP', links: [1, 2] }],
      }),
      node(2, 'CLIPTextEncode', {
        inputs: [{ name: 'clip', type: 'CLIP', link: 1 }],
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [3] }],
      }),
      node(3, 'CLIPTextEncode', {
        inputs: [{ name: 'clip', type: 'CLIP', link: 2 }],
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [4] }],
      }),
      node(4, 'KSampler', {
        inputs: [
          { name: 'positive', type: 'CONDITIONING', link: 3 },
          { name: 'negative', type: 'CONDITIONING', link: 4 },
        ],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: [5] }],
      }),
      node(5, 'SaveImage', { inputs: [{ name: 'images', type: 'LATENT', link: 5 }] }),
    ],
    links: [
      [1, 1, 0, 2, 0, 'CLIP'],
      [2, 1, 0, 3, 0, 'CLIP'],
      [3, 2, 0, 4, 0, 'CONDITIONING'],
      [4, 3, 0, 4, 1, 'CONDITIONING'],
      [5, 4, 0, 5, 0, 'LATENT'],
    ],
    groups: [],
    config: {},
  } as unknown as Workflow;
}

const select = (workflow: Workflow, nodeIds: number[], name = 'Prompting') =>
  createSubgraphFromSelection(workflow, null, { nodeIds, groupIds: [] }, name)!;

describe('createSubgraphFromSelection', () => {
  it('exposes one input per outside source, not one per crossing link', () => {
    // The loader feeds BOTH encoders from the same output. Two slots would
    // carry the same value into the subgraph.
    const result = select(makeWorkflow(), [2, 3]);
    const def = result.workflow.definitions!.subgraphs!.find(
      (sg) => sg.id === result.subgraphId,
    )!;

    expect(def.inputs).toHaveLength(1);
    expect(def.inputs![0]).toMatchObject({ name: 'clip', type: 'CLIP' });
    // And it fans out to both encoders inside.
    expect(def.inputs![0].linkIds).toHaveLength(2);
  });

  it('exposes one output per inside source, however many outside nodes it feeds', () => {
    const workflow = makeWorkflow();
    // The sampler's LATENT now feeds two nodes outside the selection.
    workflow.nodes.push(node(6, 'PreviewImage', {
      inputs: [{ name: 'images', type: 'LATENT', link: 6 }],
    }));
    workflow.nodes[3].outputs![0].links = [5, 6];
    workflow.links.push([6, 4, 0, 6, 0, 'LATENT'] as never);

    const result = select(workflow, [4]);
    const def = result.workflow.definitions!.subgraphs!.find(
      (sg) => sg.id === result.subgraphId,
    )!;

    expect(def.outputs).toHaveLength(1);
    // Both outside consumers hang off the one placeholder slot.
    const placeholder = result.workflow.nodes.find((n) => n.id === result.placeholderNodeId)!;
    expect(placeholder.outputs[0].links).toHaveLength(2);
  });

  it('takes the links wholly inside the selection with it', () => {
    const result = select(makeWorkflow(), [2, 3, 4]);
    const def = result.workflow.definitions!.subgraphs!.find(
      (sg) => sg.id === result.subgraphId,
    )!;

    // Encoder → sampler on both sides, carried in as ordinary inner links.
    const inner = def.links.filter((l) => l.origin_id > 0 && l.target_id > 0);
    expect(inner).toHaveLength(2);
    expect(result.workflow.links.some((l) => l[1] === 2 || l[1] === 3)).toBe(false);
  });

  it('replaces the selection with one placeholder, wired where they were', () => {
    const result = select(makeWorkflow(), [2, 3]);
    const nodes = result.workflow.nodes;

    expect(nodes.some((n) => n.id === 2 || n.id === 3)).toBe(false);
    const placeholder = nodes.find((n) => n.id === result.placeholderNodeId)!;
    expect(placeholder.type).toBe(result.subgraphId);
    // Fed by the loader, feeding the sampler's two inputs.
    expect(placeholder.inputs).toHaveLength(1);
    expect(placeholder.outputs).toHaveLength(2);
    const sampler = nodes.find((n) => n.id === 4)!;
    expect(sampler.inputs.every((input) => input.link != null)).toBe(true);
  });

  it('leaves the outside source holding only the link that became a slot', () => {
    const result = select(makeWorkflow(), [2, 3]);
    const loader = result.workflow.nodes.find((n) => n.id === 1)!;

    // It fed two encoders; now it feeds one placeholder, and the second link
    // went inside rather than dangling on its output list.
    expect(loader.outputs[0].links).toHaveLength(1);
  });

  it('gives the definition the name it was asked for', () => {
    const result = select(makeWorkflow(), [2, 3], 'Prompt pair');
    expect(
      result.workflow.definitions!.subgraphs!.find((sg) => sg.id === result.subgraphId)!.name,
    ).toBe('Prompt pair');
  });

  it('numbers the first instance, so a {n} name reads right away', () => {
    // Every subgraph is a reusable type, so this is instance one of one — and
    // without the number the token is dropped and "Layer {n}" reads "Layer".
    const result = select(makeWorkflow(), [2, 3], 'Layer {n}');
    const def = result.workflow.definitions!.subgraphs!.find(
      (sg) => sg.id === result.subgraphId,
    )!;

    expect(getMobileDefMeta(def).nextInstanceNumber).toBe(2);
    expect(
      getInstanceNumber(result.workflow.nodes.find((n) => n.id === result.placeholderNodeId)!),
    ).toBe(1);
  });

  it('marks widget-backed boundary inputs so they render as connections', () => {
    // A widget on a selected node that was fed from outside becomes a boundary
    // input. Without the widget marker on the placeholder it falls through to
    // the boundary-only mechanism and draws as a blank, editable field beside
    // the connection that actually feeds it.
    const workflow = makeWorkflow();
    const steps = node(6, 'INTConstant', {
      widgets_values: [7],
      outputs: [{ name: 'value', type: 'INT', links: [6] }],
    });
    workflow.nodes.push(steps);
    workflow.nodes[3].inputs!.push({
      name: 'steps',
      type: 'INT',
      link: 6,
      widget: { name: 'steps' },
    } as never);
    workflow.links.push([6, 6, 0, 4, 2, 'INT'] as never);

    const result = select(workflow, [4]);
    const placeholder = result.workflow.nodes.find((n) => n.id === result.placeholderNodeId)!;
    const slot = placeholder.inputs.find((input) => input.name === 'steps')!;
    expect(slot.widget).toEqual({ name: 'steps' });

    const [widget] = resolveSubgraphPlaceholderWidgetDefs(placeholder, result.workflow, null);
    expect(widget.name).toBe('steps');
    expect(widget.connected).toBe(true);
    expect(widget.value).toBe(7);
  });

  it('refuses an empty selection', () => {
    expect(
      createSubgraphFromSelection(makeWorkflow(), null, { nodeIds: [], groupIds: [] }, 'x'),
    ).toBeNull();
  });

  it('wraps a whole group from selecting only the group', () => {
    const workflow = makeWorkflow();
    // Membership is by node CENTRE, the way LiteGraph measures it, so the
    // encoders are placed with their centres in the box and everything else
    // well clear of it. Nodes are 200x100, so a centre is pos + (100, ~55).
    workflow.groups = [
      { id: 1, title: 'Prompting', bounding: [0, 0, 400, 400], color: '#3f789e' },
    ] as never;
    workflow.nodes[1].pos = [10, 10];
    workflow.nodes[2].pos = [10, 120];
    workflow.nodes[0].pos = [1000, 1000];
    workflow.nodes[3].pos = [1000, 1200];
    workflow.nodes[4].pos = [1000, 1400];

    const result = createSubgraphFromSelection(
      workflow,
      null,
      { nodeIds: [], groupIds: [1] },
      'Prompting',
    )!;
    const def = result.workflow.definitions!.subgraphs!.find(
      (sg) => sg.id === result.subgraphId,
    )!;

    // Both members came along, and so did the group itself.
    expect(def.nodes.map((n) => n.id).sort()).toEqual([2, 3]);
    expect(def.groups?.map((g) => g.title)).toEqual(['Prompting']);
    expect(result.workflow.groups).toHaveLength(0);
    // And the boundary is the same one selecting the two nodes would give.
    expect(def.inputs).toHaveLength(1);
    expect(def.outputs).toHaveLength(2);
  });

  it('nests an existing subgraph inside the new one', () => {
    const workflow = makeWorkflow();
    // Node 2 is now a placeholder for an existing subgraph rather than a plain
    // node — selecting it alongside node 3 should carry it in as a nested one.
    workflow.definitions = {
      subgraphs: [
        { id: 'sg-inner', name: 'Inner', inputs: [], outputs: [], nodes: [], links: [] },
      ],
    } as never;
    workflow.nodes[1].type = 'sg-inner';

    const result = createSubgraphFromSelection(
      workflow,
      null,
      { nodeIds: [2, 3], groupIds: [] },
      'Outer',
    )!;
    const outer = result.workflow.definitions!.subgraphs!.find(
      (sg) => sg.id === result.subgraphId,
    )!;

    // The placeholder travelled in as one of the new subgraph's own nodes...
    expect(outer.nodes.find((n) => n.id === 2)?.type).toBe('sg-inner');
    // ...and the definition it points at is still there, untouched and shared.
    expect(result.workflow.definitions!.subgraphs!.some((sg) => sg.id === 'sg-inner')).toBe(
      true,
    );
  });

  it('round-trips: dissolving what it created gives the graph back', () => {
    const before = makeWorkflow();
    const created = select(before, [2, 3]);
    const dissolved = dissolveSubgraph(created.workflow, created.subgraphId, null, null)!;

    expect(dissolved).not.toBeNull();
    const after = dissolved.workflow;

    // Same node types, and the placeholder is gone.
    expect(after.nodes.map((n) => n.type).sort()).toEqual(
      before.nodes.map((n) => n.type).sort(),
    );
    expect(after.definitions?.subgraphs?.some((sg) => sg.id === created.subgraphId)).toBe(
      false,
    );

    // Same wiring, compared by endpoint identity rather than link id — dissolve
    // mints fresh ids, and the shape is what has to survive the round trip.
    const shape = (wf: Workflow) =>
      wf.links
        .map((l) => {
          const origin = wf.nodes.find((n) => n.id === l[1]);
          const target = wf.nodes.find((n) => n.id === l[3]);
          return `${origin?.type}:${l[2]} -> ${target?.type}:${l[4]}`;
        })
        .sort();
    expect(shape(after)).toEqual(shape(before));
  });
});
