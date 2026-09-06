import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/api/types';
import { AddBoundarySlotModal } from '../AddBoundarySlotModal';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  addBoundaryInput: vi.fn(),
  addBoundaryOutput: vi.fn(),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  ),
}));

const SUBGRAPH_ID = 'aaaaaaaa-0000-4000-8000-000000000000';

/**
 * Node 1's `text` input is already promoted; node 2 has one input wired from
 * inside (`latent`), one free widget input (`steps`), and one free output.
 */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 10,
    last_link_id: 10,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    definitions: {
      subgraphs: [
        {
          id: SUBGRAPH_ID,
          name: 'Styler',
          inputs: [{ name: 'text', type: 'STRING', linkIds: [1] }],
          outputs: [],
          nodes: [
            {
              id: 1,
              type: 'CLIPTextEncode',
              title: 'Encoder',
              itemKey: `${SUBGRAPH_ID}/node:1`,
              pos: [0, 0],
              size: [10, 10],
              flags: {},
              order: 0,
              mode: 0,
              inputs: [{ name: 'text', type: 'STRING', link: 1 }],
              outputs: [{ name: 'LATENT', type: 'LATENT', links: [2] }],
              properties: {},
              widgets_values: [],
            },
            {
              id: 2,
              type: 'KSampler',
              title: 'Sampler',
              itemKey: `${SUBGRAPH_ID}/node:2`,
              pos: [0, 0],
              size: [10, 10],
              flags: {},
              order: 1,
              mode: 0,
              inputs: [
                { name: 'latent', type: 'LATENT', link: 2 },
                { name: 'steps', type: 'INT', link: null, widget: { name: 'steps' } },
              ],
              outputs: [{ name: 'IMAGE', type: 'IMAGE', links: null }],
              properties: {},
              widgets_values: [],
            },
          ],
          links: [
            { id: 1, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'STRING' },
            { id: 2, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'LATENT' },
          ],
        },
      ],
    },
  } as unknown as Workflow;
}

function rows(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('button.add-boundary-candidate-row'),
  );
}

describe('AddBoundarySlotModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.state = {
      workflow: makeWorkflow(),
      nodeTypes: null,
      addBoundaryInput: mocks.addBoundaryInput,
      addBoundaryOutput: mocks.addBoundaryOutput,
    };
    mocks.addBoundaryInput.mockClear();
    mocks.addBoundaryOutput.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (direction: 'input' | 'output') => {
    await act(async () => {
      root.render(
        <AddBoundarySlotModal
          isOpen
          onClose={() => {}}
          direction={direction}
          subgraphId={SUBGRAPH_ID}
        />,
      );
    });
  };

  it('offers only inputs that are neither promoted nor fed from inside', async () => {
    await render('input');

    // `text` is already promoted, `latent` is wired inside — promoting either
    // would mean cutting a link the user never asked to cut.
    const labels = rows().map((row) => row.textContent);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain('Sampler');
    expect(labels[0]).toContain('steps');
  });

  it('marks a widget-backed input so it is recognizable in the list', async () => {
    await render('input');
    expect(rows()[0].textContent).toContain('Widget');
  });

  it('promotes the chosen input', async () => {
    await render('input');

    await act(async () => rows()[0].click());

    expect(mocks.addBoundaryInput).toHaveBeenCalledWith({
      nodeKey: `${SUBGRAPH_ID}/node:2`,
      inputSlot: 1,
    });
  });

  it('offers every unpromoted output, wired inside or not', async () => {
    await render('output');

    // Node 1's LATENT already feeds node 2, which does not stop it being
    // exposed as well — an output can fan out to both.
    const labels = rows().map((row) => row.textContent);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('LATENT');
    expect(labels[1]).toContain('IMAGE');

    await act(async () => rows()[1].click());
    expect(mocks.addBoundaryOutput).toHaveBeenCalledWith({
      nodeKey: `${SUBGRAPH_ID}/node:2`,
      outputSlot: 0,
    });
  });

  it('says so when there is nothing left to expose', async () => {
    const workflow = makeWorkflow();
    const def = workflow.definitions!.subgraphs![0];
    // Promote the sampler's remaining free input too.
    def.links = [
      ...def.links,
      { id: 3, origin_id: -10, origin_slot: 1, target_id: 2, target_slot: 1, type: 'INT' },
    ];
    mocks.state.workflow = workflow;

    await render('input');

    expect(rows()).toHaveLength(0);
    expect(document.body.textContent).toContain('already exposed');
  });
});
