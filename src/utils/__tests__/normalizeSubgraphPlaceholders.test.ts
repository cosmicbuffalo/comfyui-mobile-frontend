import { describe, expect, it } from 'vitest';
import type {
  Workflow,
  WorkflowLink,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import { normalizeSubgraphPlaceholders } from '@/utils/normalizeSubgraphPlaceholders';

const SG = 'aaaaaaaa-1111-2222-3333-444444444444';
const NESTED = 'bbbbbbbb-1111-2222-3333-444444444444';

function makeNode(id: number, type: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
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
  } as unknown as WorkflowNode;
}

function makeWorkflow(
  nodes: WorkflowNode[],
  links: WorkflowLink[],
  subgraphs: WorkflowSubgraphDefinition[],
): Workflow {
  return {
    last_node_id: 100,
    last_link_id: 100,
    nodes,
    links,
    groups: [],
    config: {},
    definitions: { subgraphs },
    version: 0.4,
  } as unknown as Workflow;
}

/**
 * The Krea-2 shape: the definition declares four boundary inputs, but the
 * serialized placeholder lists only the middle two — so its slot 0 is really
 * boundary slot 1.
 */
function kreaLikeDefinition(): WorkflowSubgraphDefinition {
  return {
    id: SG,
    name: 'Text to Image',
    nodes: [
      makeNode(10, 'PromptNode', {
        inputs: [{ name: 'text', type: 'STRING', link: 1, widget: { name: 'text' } }],
      }),
      makeNode(11, 'SizeNode', {
        inputs: [
          { name: 'width', type: 'INT', link: 2, widget: { name: 'width' } },
          { name: 'height', type: 'INT', link: 3, widget: { name: 'height' } },
        ],
      }),
      makeNode(12, 'LoaderNode', {
        inputs: [{ name: 'unet_name', type: 'COMBO', link: 4, widget: { name: 'unet_name' } }],
      }),
    ],
    inputs: [
      { name: 'value', type: 'STRING', linkIds: [1] },
      { name: 'width_1', type: 'INT', label: 'width', linkIds: [2] },
      { name: 'height_1', type: 'INT', label: 'height', linkIds: [3] },
      { name: 'unet_name', type: 'COMBO', linkIds: [4] },
    ],
    outputs: [{ name: 'IMAGE', type: 'IMAGE', linkIds: [] }],
    links: [
      { id: 1, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'STRING' },
      { id: 2, origin_id: -10, origin_slot: 1, target_id: 11, target_slot: 0, type: 'INT' },
      { id: 3, origin_id: -10, origin_slot: 2, target_id: 11, target_slot: 1, type: 'INT' },
      { id: 4, origin_id: -10, origin_slot: 3, target_id: 12, target_slot: 0, type: 'COMBO' },
    ],
  } as unknown as WorkflowSubgraphDefinition;
}

describe('normalizeSubgraphPlaceholders', () => {
  it('rebuilds a truncated placeholder to the full boundary list', () => {
    const placeholder = makeNode(30, SG, {
      inputs: [
        { name: 'width_1', type: 'INT', link: null, widget: { name: 'width_1' } },
        { name: 'height_1', type: 'INT', link: null, widget: { name: 'height_1' } },
      ],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
    });
    const wf = makeWorkflow([placeholder], [], [kreaLikeDefinition()]);

    const next = normalizeSubgraphPlaceholders(wf);
    const normalized = next.nodes[0];

    expect(normalized.inputs.map((input) => input.name)).toEqual([
      'value',
      'width_1',
      'height_1',
      'unet_name',
    ]);
    // Every one of these is widget-backed, so each gets a widget named after
    // its boundary slot.
    expect(normalized.inputs.map((input) => input.widget?.name)).toEqual([
      'value',
      'width_1',
      'height_1',
      'unet_name',
    ]);
    // Boundary labels win over the serialized entry's own presentation.
    expect(normalized.inputs[1].label).toBe('width');
  });

  it('remaps links onto the placeholder new slot indices', () => {
    const upstream = makeNode(20, 'IntSource', {
      outputs: [{ name: 'INT', type: 'INT', links: [50] }],
    });
    const placeholder = makeNode(30, SG, {
      // Serialized slot 0 is really boundary slot 1.
      inputs: [{ name: 'width_1', type: 'INT', link: 50, widget: { name: 'width_1' } }],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
    });
    const wf = makeWorkflow(
      [upstream, placeholder],
      [[50, 20, 0, 30, 0, 'INT']],
      [kreaLikeDefinition()],
    );

    const next = normalizeSubgraphPlaceholders(wf);

    expect(next.links[0]).toEqual([50, 20, 0, 30, 1, 'INT']);
    const normalized = next.nodes.find((node) => node.id === 30)!;
    expect(normalized.inputs[0].link).toBeNull();
    expect(normalized.inputs[1].link).toBe(50);
  });

  it('does not mark a widget on a socket-backed boundary input', () => {
    const definition = {
      id: SG,
      name: 'Sub',
      nodes: [
        makeNode(10, 'Sink', {
          // No `widget`: a real socket.
          inputs: [{ name: 'image', type: 'IMAGE', link: 1 }],
        }),
      ],
      inputs: [{ name: 'image', type: 'IMAGE', linkIds: [1] }],
      outputs: [],
      links: [
        { id: 1, origin_id: -10, origin_slot: 0, target_id: 10, target_slot: 0, type: 'IMAGE' },
      ],
    } as unknown as WorkflowSubgraphDefinition;
    const wf = makeWorkflow([makeNode(30, SG)], [], [definition]);

    const normalized = normalizeSubgraphPlaceholders(wf).nodes[0];

    expect(normalized.inputs).toHaveLength(1);
    expect(normalized.inputs[0].widget).toBeUndefined();
  });

  it('is idempotent and returns the same object when nothing changes', () => {
    const wf = makeWorkflow([makeNode(30, SG)], [], [kreaLikeDefinition()]);

    const once = normalizeSubgraphPlaceholders(wf);
    const twice = normalizeSubgraphPlaceholders(once);

    expect(twice).toBe(once);
  });

  it('leaves a workflow with no subgraph definitions untouched', () => {
    const wf = makeWorkflow([makeNode(1, 'SaveImage')], [], []);
    expect(normalizeSubgraphPlaceholders(wf)).toBe(wf);
  });

  it('drops a link whose slot no longer exists on the boundary', () => {
    const upstream = makeNode(20, 'Source', {
      outputs: [{ name: 'INT', type: 'INT', links: [50, 51] }],
    });
    const placeholder = makeNode(30, SG, {
      inputs: [
        { name: 'width_1', type: 'INT', link: 50, widget: { name: 'width_1' } },
        { name: 'height_1', type: 'INT', link: null, widget: { name: 'height_1' } },
        { name: 'unet_name', type: 'COMBO', link: null, widget: { name: 'unet_name' } },
        { name: 'value', type: 'STRING', link: null, widget: { name: 'value' } },
        // A fifth slot the definition has no room for.
        { name: 'removed_slot', type: 'INT', link: 51 },
      ],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
    });
    const wf = makeWorkflow(
      [upstream, placeholder],
      [
        [50, 20, 0, 30, 0, 'INT'],
        [51, 20, 0, 30, 4, 'INT'],
      ],
      [kreaLikeDefinition()],
    );

    const next = normalizeSubgraphPlaceholders(wf);

    expect(next.links.map((link) => link[0])).toEqual([50]);
    // The origin's own bookkeeping loses the dead link too.
    expect(next.nodes.find((node) => node.id === 20)!.outputs[0].links).toEqual([50]);
    expect(next.nodes.find((node) => node.id === 30)!.inputs).toHaveLength(4);
  });

  it('normalizes a placeholder nested inside a subgraph definition', () => {
    const nestedDefinition = {
      id: NESTED,
      name: 'Nested',
      nodes: [
        makeNode(70, 'Leaf', {
          inputs: [{ name: 'steps', type: 'INT', link: 1, widget: { name: 'steps' } }],
        }),
      ],
      inputs: [
        { name: 'seed', type: 'INT', linkIds: [] },
        { name: 'steps', type: 'INT', linkIds: [1] },
      ],
      outputs: [],
      links: [
        { id: 1, origin_id: -10, origin_slot: 0, target_id: 70, target_slot: 0, type: 'INT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;
    const outerDefinition = {
      id: SG,
      name: 'Outer',
      // The nested placeholder omits boundary slot 0 ('seed').
      nodes: [
        makeNode(60, NESTED, {
          inputs: [{ name: 'steps', type: 'INT', link: null, widget: { name: 'steps' } }],
        }),
      ],
      inputs: [],
      outputs: [],
      links: [],
    } as unknown as WorkflowSubgraphDefinition;
    const wf = makeWorkflow([makeNode(30, SG)], [], [outerDefinition, nestedDefinition]);

    const next = normalizeSubgraphPlaceholders(wf);
    const nestedPlaceholder = next.definitions!.subgraphs!.find((sg) => sg.id === SG)!.nodes[0];

    expect(nestedPlaceholder.inputs.map((input) => input.name)).toEqual(['seed', 'steps']);
  });

  it('leaves slots alone when the definition declares no boundary list', () => {
    const definition = {
      id: SG,
      name: 'Sub',
      nodes: [],
      links: [],
      // No `inputs` / `outputs` keys at all.
    } as unknown as WorkflowSubgraphDefinition;
    const placeholder = makeNode(30, SG, {
      inputs: [{ name: 'kept', type: 'INT', link: null }],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }],
    });
    const wf = makeWorkflow([placeholder], [], [definition]);

    const next = normalizeSubgraphPlaceholders(wf);

    expect(next.nodes[0].inputs.map((input) => input.name)).toEqual(['kept']);
    expect(next.nodes[0].outputs).toHaveLength(1);
  });
});

describe('nested definitions normalize before the scopes that hold them', () => {
  /**
   * OUTER contains a placeholder for INNER. INNER's boundary input `strength`
   * backs a widget, but the placeholder inside OUTER arrived without the widget
   * marker that says so — the shape a file written by another frontend has.
   *
   * OUTER's own `strength` boundary is therefore only knowable as widget-backed
   * once that inner placeholder has been normalized. Doing the root first read
   * OUTER half-built and left the root placeholder unmarked.
   */
  function nestedWorkflow(): Workflow {
    const inner: WorkflowSubgraphDefinition = {
      id: NESTED,
      name: 'Inner',
      inputs: [{ id: 'i0', name: 'strength', type: 'FLOAT', linkIds: [1] }],
      outputs: [],
      nodes: [
        makeNode(20, 'Sampler', {
          inputs: [{ name: 'strength', type: 'FLOAT', link: 1, widget: { name: 'strength' } }],
        }),
      ],
      links: [
        { id: 1, origin_id: -10, origin_slot: 0, target_id: 20, target_slot: 0, type: 'FLOAT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;

    const outer: WorkflowSubgraphDefinition = {
      id: SG,
      name: 'Outer',
      inputs: [{ id: 'o0', name: 'strength', type: 'FLOAT', linkIds: [2] }],
      outputs: [],
      nodes: [
        // No widget marker on the inner placeholder — normalizing it is what
        // puts one there.
        makeNode(30, NESTED, {
          inputs: [{ name: 'strength', type: 'FLOAT', link: 2 }],
        }),
      ],
      links: [
        { id: 2, origin_id: -10, origin_slot: 0, target_id: 30, target_slot: 0, type: 'FLOAT' },
      ],
    } as unknown as WorkflowSubgraphDefinition;

    return makeWorkflow(
      [makeNode(1, SG, { inputs: [{ name: 'strength', type: 'FLOAT', link: null }] })],
      [],
      [outer, inner],
    );
  }

  it('marks the root placeholder in a single pass', () => {
    const result = normalizeSubgraphPlaceholders(nestedWorkflow());

    expect(result.nodes[0].inputs[0].widget).toEqual({ name: 'strength' });
    const outer = result.definitions!.subgraphs!.find((d) => d.id === SG)!;
    expect(outer.nodes![0].inputs[0].widget).toEqual({ name: 'strength' });
  });

  it('is idempotent — a second pass changes nothing', () => {
    const once = normalizeSubgraphPlaceholders(nestedWorkflow());
    expect(normalizeSubgraphPlaceholders(once)).toBe(once);
  });

  it('does not loop on a definition that claims to contain itself', () => {
    const workflow = nestedWorkflow();
    const outer = workflow.definitions!.subgraphs!.find((d) => d.id === SG)!;
    outer.nodes!.push(makeNode(31, SG));
    expect(() => normalizeSubgraphPlaceholders(workflow)).not.toThrow();
  });
});

describe('links addressed in definition coordinates', () => {
  /**
   * What "move nodes into a subgraph" leaves behind: the definition has gained
   * an output slot, the parent links already point at it by its definition
   * index, and the placeholder's own slot list has not been touched — this pass
   * is what re-seats it.
   */
  function movedShape(): Workflow {
    const definition: WorkflowSubgraphDefinition = {
      id: SG,
      name: 'Moved',
      inputs: [],
      outputs: [
        { id: 'o0', name: 'IMAGE', type: 'IMAGE', linkIds: [] },
        { id: 'o1', name: 'value', type: 'INT', linkIds: [] },
      ],
      nodes: [makeNode(20, 'INTConstant')],
      links: [],
    } as unknown as WorkflowSubgraphDefinition;

    // The placeholder still lists only the output it had before the move.
    const placeholder = makeNode(1, SG, {
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [10] }],
    });
    const consumer = makeNode(2, 'KSampler', {
      inputs: [{ name: 'steps', type: 'INT', link: 11, widget: { name: 'steps' } }],
    });
    const viewer = makeNode(3, 'PreviewImage', {
      inputs: [{ name: 'images', type: 'IMAGE', link: 10 }],
    });

    return makeWorkflow(
      [placeholder, consumer, viewer],
      [
        [10, 1, 0, 3, 0, 'IMAGE'],
        // Output slot 1 exists on the definition but not yet on the placeholder.
        [11, 1, 1, 2, 0, 'INT'],
      ] as unknown as WorkflowLink[],
      [definition],
    );
  }

  it('keeps a link whose slot the definition has but the placeholder has not caught up to', () => {
    const result = normalizeSubgraphPlaceholders(movedShape());

    // Dropping this took every connection the moved nodes were still feeding.
    expect(result.links.some((link) => link[0] === 11)).toBe(true);
    expect(result.nodes.find((n) => n.id === 2)!.inputs[0].link).toBe(11);
  });

  it('points the rebuilt slot at the links it actually has', () => {
    const result = normalizeSubgraphPlaceholders(movedShape());
    const placeholder = result.nodes.find((n) => n.id === 1)!;

    // An empty cache here reads as garbage to the pre-save link collector.
    expect(placeholder.outputs).toHaveLength(2);
    expect(placeholder.outputs[1].links).toEqual([11]);
    expect(placeholder.outputs[0].links).toEqual([10]);
  });

  it('still drops a link to a slot the definition does not have either', () => {
    const workflow = movedShape();
    workflow.links.push([12, 1, 7, 2, 0, 'INT'] as never);

    const result = normalizeSubgraphPlaceholders(workflow);
    expect(result.links.some((link) => link[0] === 12)).toBe(false);
  });
});

describe('normalizeSubgraphPlaceholders — deleted boundary slots', () => {
  /**
   * The reported corruption: a subgraph whose middle input slots are deleted
   * from inside, while the placeholder outside is still wired to the slots
   * around them. Nothing that survives may move.
   */
  function deletedSlotsWorkflow(): Workflow {
    const definition: WorkflowSubgraphDefinition = {
      id: SG,
      name: '1st Section',
      // `positive` and `negative` used to sit at slots 1 and 2 and have been
      // deleted from inside the subgraph.
      inputs: [
        { id: 'i0', name: 'model', type: 'MODEL', linkIds: [] },
        { id: 'i3', name: 'clip_vision_start_image', type: 'IMAGE', linkIds: [] },
      ],
      outputs: [],
      nodes: [],
      links: [],
      groups: [],
    } as unknown as WorkflowSubgraphDefinition;

    // The placeholder still carries the pre-deletion list of four.
    const placeholder = makeNode(50, SG, {
      inputs: [
        { name: 'model', type: 'MODEL', link: 10 },
        { name: 'positive', type: 'CONDITIONING', link: 11, label: 'Positive prompt' },
        { name: 'negative', type: 'CONDITIONING', link: 12, label: 'Negative prompt' },
        { name: 'clip_vision_start_image', type: 'IMAGE', link: 13, label: 'Start image' },
      ],
    });
    const feeders = [
      makeNode(1, 'CheckpointLoader', { outputs: [{ name: 'MODEL', type: 'MODEL', links: [10] }] }),
      makeNode(2, 'PositivePrompt', {
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [11] }],
      }),
      makeNode(3, 'NegativePrompt', {
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [12] }],
      }),
      makeNode(4, 'LoadImage', { outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [13] }] }),
    ];
    const links: WorkflowLink[] = [
      [10, 1, 0, 50, 0, 'MODEL'],
      [11, 2, 0, 50, 1, 'CONDITIONING'],
      [12, 3, 0, 50, 2, 'CONDITIONING'],
      [13, 4, 0, 50, 3, 'IMAGE'],
    ];
    return makeWorkflow([...feeders, placeholder], links, [definition]);
  }

  it('drops the deleted slots\' links instead of moving them onto the survivors', () => {
    const normalized = normalizeSubgraphPlaceholders(deletedSlotsWorkflow());

    const byId = new Map(normalized.links.map((link) => [link[0], link]));
    // The two deleted slots take their connections with them.
    expect(byId.has(11)).toBe(false);
    expect(byId.has(12)).toBe(false);
    // Everything else keeps feeding exactly what it fed. Link 13 is the one
    // that went wrong in the wild: the image feeder ended up displaced by the
    // deleted `negative`, so the prompt appeared to feed
    // clip_vision_start_image.
    expect(byId.get(10)).toEqual([10, 1, 0, 50, 0, 'MODEL']);
    expect(byId.get(13)).toEqual([13, 4, 0, 50, 1, 'IMAGE']);

    const placeholder = normalized.nodes.find((node) => node.id === 50);
    expect(placeholder?.inputs.map((input) => input.name)).toEqual([
      'model',
      'clip_vision_start_image',
    ]);
    // Labels ride the same index identity as links, and slid the same way in
    // the wild — the surviving slot must not inherit the deleted one's name.
    expect(placeholder?.inputs.map((input) => input.label)).toEqual([
      undefined,
      'Start image',
    ]);
    // The surviving slot's cached link is the image's, not the prompt's.
    expect(placeholder?.inputs[1]?.link).toBe(13);
  });

  it('clears the dropped links off the nodes that were feeding them', () => {
    const normalized = normalizeSubgraphPlaceholders(deletedSlotsWorkflow());

    const positive = normalized.nodes.find((node) => node.id === 2);
    const negative = normalized.nodes.find((node) => node.id === 3);
    const image = normalized.nodes.find((node) => node.id === 4);
    expect(positive?.outputs[0]?.links ?? []).toEqual([]);
    expect(negative?.outputs[0]?.links ?? []).toEqual([]);
    // Untouched.
    expect(image?.outputs[0]?.links).toEqual([13]);
  });

  it('does not displace links whose types happen to match either', () => {
    // The dangerous half of this bug: when the slot that shuffles into a
    // vacated index has a COMPATIBLE type, nothing looks wrong. No red link, no
    // validation error — the graph just runs with one control driving another
    // node's value. Type-clean displacement has to fail here too, or a
    // regression can hide behind a passing validator.
    const definition = {
      id: SG,
      name: 'Controls',
      inputs: [
        { id: 'i0', name: 'frame_rate', type: 'FLOAT', linkIds: [] },
        { id: 'i1', name: 'seconds', type: 'FLOAT', linkIds: [] },
      ],
      outputs: [],
      nodes: [],
      links: [],
      groups: [],
    } as unknown as WorkflowSubgraphDefinition;

    const placeholder = makeNode(60, SG, {
      inputs: [
        { name: 'repulsion_boost', type: 'FLOAT', link: 20 },
        { name: 'frame_rate', type: 'FLOAT', link: 21 },
        { name: 'seconds', type: 'FLOAT', link: 22 },
      ],
    });
    const feeders = [
      makeNode(5, 'RepulsionBoost', { outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [20] }] }),
      makeNode(6, 'FrameRate', { outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [21] }] }),
      makeNode(7, 'Seconds', { outputs: [{ name: 'FLOAT', type: 'FLOAT', links: [22] }] }),
    ];
    const workflow = makeWorkflow(
      [...feeders, placeholder],
      [
        [20, 5, 0, 60, 0, 'FLOAT'],
        [21, 6, 0, 60, 1, 'FLOAT'],
        [22, 7, 0, 60, 2, 'FLOAT'],
      ],
      [definition],
    );

    const normalized = normalizeSubgraphPlaceholders(workflow);

    // repulsion_boost is gone, so its link goes with it...
    expect(normalized.links.some((link) => link[0] === 20)).toBe(false);
    // ...and the two survivors stay on their own inputs rather than each
    // sliding up one to drive their neighbour.
    expect(normalized.links.find((link) => link[0] === 21)).toEqual([21, 6, 0, 60, 0, 'FLOAT']);
    expect(normalized.links.find((link) => link[0] === 22)).toEqual([22, 7, 0, 60, 1, 'FLOAT']);
    const rebuilt = normalized.nodes.find((node) => node.id === 60);
    expect(rebuilt?.inputs.map((input) => [input.name, input.link])).toEqual([
      ['frame_rate', 21],
      ['seconds', 22],
    ]);
  });

  it('still follows a renamed slot rather than dropping it', () => {
    // Rename is the case the positional fallback exists for: the placeholder
    // names something the definition no longer has, but the definition's slot
    // at that index is going spare, so the link belongs to it.
    const workflow = deletedSlotsWorkflow();
    workflow.definitions!.subgraphs![0].inputs = [
      { id: 'i0', name: 'model', type: 'MODEL', linkIds: [] },
      { id: 'i1', name: 'prompt', type: 'CONDITIONING', linkIds: [] },
    ] as never;
    workflow.nodes = workflow.nodes.map((node) =>
      node.id === 50
        ? {
            ...node,
            inputs: [
              { name: 'model', type: 'MODEL', link: 10 },
              { name: 'positive', type: 'CONDITIONING', link: 11 },
            ],
          }
        : node,
    );
    workflow.links = [
      [10, 1, 0, 50, 0, 'MODEL'],
      [11, 2, 0, 50, 1, 'CONDITIONING'],
    ] as WorkflowLink[];

    const normalized = normalizeSubgraphPlaceholders(workflow);

    const link = normalized.links.find((candidate) => candidate[0] === 11);
    expect(link).toEqual([11, 2, 0, 50, 1, 'CONDITIONING']);
  });
});
