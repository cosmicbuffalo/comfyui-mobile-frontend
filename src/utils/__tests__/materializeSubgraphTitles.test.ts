import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { materializeSubgraphTitles } from '@/utils/materializeSubgraphTitles';
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';

const SG = 'sg-segment';

function node(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
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

function makeWorkflow(
  instances: Array<Partial<WorkflowNode>>,
  definition: Partial<Parameters<typeof materializeSubgraphTitles>[0]['definitions']> = {},
): Workflow {
  void definition;
  return {
    last_node_id: 20,
    last_link_id: 0,
    nodes: instances.map((overrides, index) => node(index + 1, SG, overrides)),
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [
        {
          id: SG,
          name: 'Segment {n}',
          inputs: [],
          outputs: [],
          nodes: [node(20, 'KSampler')],
          links: [],
          groups: [],
        },
      ],
    },
  } as unknown as Workflow;
}

const titles = (workflow: Workflow) => workflow.nodes.map((n) => n.title);
const definitionOf = (workflow: Workflow) => workflow.definitions!.subgraphs![0];

describe('materializeSubgraphTitles', () => {
  it('writes the rendered name onto each instance', () => {
    // Every other frontend reads the raw template, so the rendered name has to
    // land somewhere standard and per-instance for anything else to show it.
    const result = materializeSubgraphTitles(
      makeWorkflow([
        { properties: { mobileInstanceNumber: 1 } },
        { properties: { mobileInstanceNumber: 2 } },
      ]),
    );

    expect(titles(result)).toEqual(['Segment 1', 'Segment 2']);
  });

  it('renders {n+1} the same way', () => {
    const workflow = makeWorkflow([{ properties: { mobileInstanceNumber: 4 } }]);
    definitionOf(workflow).name = 'Segment {n+1}';

    expect(titles(materializeSubgraphTitles(workflow))).toEqual(['Segment 5']);
  });

  it('leaves a title the user typed alone', () => {
    const result = materializeSubgraphTitles(
      makeWorkflow([{ title: 'The good one', properties: { mobileInstanceNumber: 1 } }]),
    );

    expect(titles(result)).toEqual(['The good one']);
  });

  it('rewrites its own title when the type is renamed', () => {
    const once = materializeSubgraphTitles(
      makeWorkflow([{ properties: { mobileInstanceNumber: 3 } }]),
    );
    const renamed = {
      ...once,
      definitions: {
        subgraphs: [{ ...definitionOf(once), name: 'Chunk {n}' }],
      },
    } as Workflow;

    expect(titles(materializeSubgraphTitles(renamed))).toEqual(['Chunk 3']);
  });

  it('clears its own title when the template goes away', () => {
    const once = materializeSubgraphTitles(
      makeWorkflow([{ properties: { mobileInstanceNumber: 3 } }]),
    );
    const renamed = {
      ...once,
      definitions: { subgraphs: [{ ...definitionOf(once), name: 'Chunk' }] },
    } as Workflow;
    const result = materializeSubgraphTitles(renamed);

    // Keeping "Segment 3" would leave a number that means nothing.
    expect(titles(result)).toEqual([undefined]);
  });

  it('touches nothing when there is nothing to render', () => {
    const workflow = makeWorkflow([{ properties: { mobileInstanceNumber: 1 } }]);
    definitionOf(workflow).name = 'Segment';

    expect(materializeSubgraphTitles(workflow)).toBe(workflow);
  });

  it('is idempotent', () => {
    const once = materializeSubgraphTitles(
      makeWorkflow([{ properties: { mobileInstanceNumber: 1 } }]),
    );
    expect(materializeSubgraphTitles(once)).toBe(once);
  });
});

describe('titles inside a definition', () => {
  function withContents(instanceCount: number): Workflow {
    const workflow = makeWorkflow(
      Array.from({ length: instanceCount }, (_, index) => ({
        properties: { mobileInstanceNumber: index + 1 },
      })),
    );
    const definition = definitionOf(workflow);
    definition.nodes = [node(20, 'KSampler', { title: 'Sampler {n}' })];
    definition.groups = [
      { id: 5, title: 'Inner Section {n+1}', bounding: [0, 0, 10, 10], color: '#333' },
    ];
    return workflow;
  }

  it('renders inner nodes and groups for a lone instance', () => {
    const definition = definitionOf(materializeSubgraphTitles(withContents(1)));

    expect(definition.nodes![0].title).toBe('Sampler 1');
    expect(definition.groups![0].title).toBe('Inner Section 2');
  });

  it('leaves them as templates when the type is shared', () => {
    // One group object for twelve instances: no number is true of it, and
    // writing one would put "Section 5" on something they all look at.
    const definition = definitionOf(materializeSubgraphTitles(withContents(3)));

    expect(definition.nodes![0].title).toBe('Sampler {n}');
    expect(definition.groups![0].title).toBe('Inner Section {n+1}');
  });

  it('records the group title it wrote, so a user edit is not overwritten', () => {
    const once = materializeSubgraphTitles(withContents(1));
    const definition = definitionOf(once);
    const meta = definition.extra?.['comfyui-mobile'] as {
      autoGroupTitles?: Record<string, { template: string; rendered?: string }>;
    };
    // The template is kept, because the title it rendered into is now the only
    // other copy of it and renaming the instance has to re-render from it.
    expect(meta.autoGroupTitles).toEqual({
      '5': { template: 'Inner Section {n+1}', rendered: 'Inner Section 2' },
    });

    // A title with no template in it is the user's, and stays.
    const edited = {
      ...once,
      definitions: {
        subgraphs: [{
          ...definition,
          groups: [{ ...definition.groups![0], title: 'Renamed by hand' }],
        }],
      },
    } as Workflow;
    expect(definitionOf(materializeSubgraphTitles(edited)).groups![0].title)
      .toBe('Renamed by hand');
  });
});

describe('a materialized title does not out-live its template', () => {
  it('renders the card from the type, so a rename shows before the next save', () => {
    const once = materializeSubgraphTitles(
      makeWorkflow([{ properties: { mobileInstanceNumber: 3 } }]),
    );
    expect(titles(once)).toEqual(['Segment 3']);

    // Renaming the type does not rewrite the stored titles until the workflow
    // is next normalized — the card must not show the stale one meanwhile.
    const renamed = {
      ...once,
      definitions: { subgraphs: [{ ...definitionOf(once), name: 'Chunk {n}' }] },
    } as Workflow;
    expect(resolveWorkflowNodeDisplayName(renamed, renamed.nodes[0], null)).toBe('Chunk 3');
  });

  it('still shows a title the user typed', () => {
    const workflow = makeWorkflow([
      { title: 'The good one', properties: { mobileInstanceNumber: 1 } },
    ]);
    expect(resolveWorkflowNodeDisplayName(workflow, workflow.nodes[0], null)).toBe('The good one');
  });
});
