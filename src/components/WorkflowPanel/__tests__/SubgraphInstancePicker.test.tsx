import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { getGroupKey } from '@/utils/mobileLayout';
import { SubgraphInstancePicker } from '../SubgraphInstancePicker';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  ),
}));

const SG = 'sg-styler';
const HOST = 'sg-host';

function node(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type,
    itemKey: `key:${id}`,
    pos: [0, 0],
    size: [10, 10],
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
 * Instance 10 sits inside a group at root; instance 30 sits inside another
 * subgraph — so the two are told apart by where they are, not their numbers.
 */
function makeWorkflow(): Workflow {
  return {
    nodes: [
      node(10, SG, {
        properties: { mobileInstanceNumber: 1 },
        title: 'Positive styler',
        color: '#3f789e',
      }),
      node(20, HOST, { title: 'Wrapper' }),
    ],
    links: [],
    groups: [{ id: 7, title: 'Prompting', color: '#3f789e', bounding: [0, 0, 10, 10] }],
    config: {},
    definitions: {
      subgraphs: [
        { id: SG, name: 'Styler', inputs: [], outputs: [], nodes: [], links: [] },
        {
          id: HOST,
          name: 'Host',
          inputs: [],
          outputs: [],
          nodes: [node(30, SG, { properties: { mobileInstanceNumber: 2 } })],
          links: [],
        },
      ],
    },
  } as unknown as Workflow;
}

/** Instance 10 lives in group 7; instance 30 lives in the HOST subgraph. */
const GROUP_KEY = getGroupKey(7, null);
const layout = {
  root: [
    { type: 'group', id: 7, subgraphId: null, itemKey: GROUP_KEY },
    { type: 'subgraph', id: HOST, nodeId: 20 },
  ],
  // A placeholder inside a group is a `subgraph` ref carrying its node id, the
  // way the layout actually records one — not a `node` ref.
  groups: { [GROUP_KEY]: [{ type: 'subgraph', id: SG, nodeId: 10 }] },
  groupParents: { [GROUP_KEY]: { scope: 'root' } },
  subgraphs: { [HOST]: [{ type: 'node', id: 30 }] },
  hiddenBlocks: {},
} as never;

describe('SubgraphInstancePicker', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSelect = vi.fn();

  beforeEach(() => {
    mocks.state = { workflow: makeWorkflow(), mobileLayout: layout, nodeTypes: null };
    onSelect.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (currentInstanceId: number | null = 10) => {
    const workflow = mocks.state.workflow as Workflow;
    const instances = [
      workflow.nodes.find((n) => n.id === 10)!,
      workflow.definitions!.subgraphs!.find((sg) => sg.id === HOST)!.nodes[0],
    ];
    await act(async () => {
      root.render(
        <SubgraphInstancePicker
          instances={instances}
          currentInstanceId={currentInstanceId}
          onSelect={onSelect}
          renderTrigger={({ ref, onClick, current }) => (
            <button ref={ref} type="button" className="subgraph-instance-trigger" onClick={onClick}>
              {current?.label}
            </button>
          )}
        />,
      );
    });
  };

  const open = async () => {
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button.subgraph-instance-trigger')!.click(),
    );
  };

  it('names the instance in view on the trigger, with its own title', async () => {
    await render();
    expect(
      container.querySelector('button.subgraph-instance-trigger')!.textContent,
    ).toContain('Instance 1: Positive styler');
  });

  it('omits the trailing title when the placeholder has none of its own', async () => {
    await render(30);
    // Instance 30 is untitled, so its display name would just repeat "Styler".
    expect(container.querySelector('button.subgraph-instance-trigger')!.textContent).toContain(
      'Instance 2',
    );
    expect(
      container.querySelector('button.subgraph-instance-trigger')!.textContent,
    ).not.toContain('Instance 2:');
  });

  it('shows each instance with the containers it sits in', async () => {
    await render();
    await open();

    // The entry is a container with the label button inside it, the same shape
    // the bookmark bar uses.
    const options = Array.from(
      document.querySelectorAll<HTMLElement>('.subgraph-instance-option'),
    );
    expect(options).toHaveLength(2);

    // Instance 10 is inside a group at root.
    const first = options[0].querySelectorAll('.subgraph-instance-parent');
    expect(Array.from(first).map((chip) => chip.textContent)).toEqual(['Prompting']);
    // Instance 30 is inside the Wrapper subgraph.
    const second = options[1].querySelectorAll('.subgraph-instance-parent');
    expect(Array.from(second).map((chip) => chip.textContent)).toEqual(['Wrapper']);
  });

  it('hangs under the anchor it is given, not the name that opened it', async () => {
    const anchor = document.createElement('div');
    anchor.getBoundingClientRect = () =>
      ({ left: 100, right: 500, width: 400, bottom: 60, top: 40, height: 20 }) as DOMRect;
    document.body.appendChild(anchor);
    const panel = document.createElement('div');
    panel.id = 'node-list-wrapper';
    panel.getBoundingClientRect = () => ({ width: 1000, left: 0, right: 1000 }) as DOMRect;
    document.body.appendChild(panel);

    await act(async () => {
      root.render(
        <SubgraphInstancePicker
          instances={[(mocks.state.workflow as Workflow).nodes.find((n) => n.id === 10)!]}
          currentInstanceId={10}
          onSelect={onSelect}
          anchorRef={{ current: anchor }}
          renderTrigger={({ ref, onClick }) => (
            <button ref={ref} type="button" className="subgraph-instance-trigger" onClick={onClick} />
          )}
        />,
      );
    });
    await open();

    const list = document.querySelector<HTMLElement>('.subgraph-instance-list')!;
    // Centred on the anchor's middle (300), below its bottom edge.
    expect(list.style.left).toBe('300px');
    expect(list.style.top).toBe('64px');
    // And capped against the panel rather than the window.
    expect(list.style.maxWidth).toContain('800px');

    anchor.remove();
    panel.remove();
  });

  it('paints the parent chips rather than leaving them uncoloured', async () => {
    await render();
    await open();

    const chip = document.querySelector<HTMLElement>('.subgraph-instance-parent')!;
    expect(chip.style.backgroundColor).toMatch(/^rgba\(/);
    expect(chip.style.borderColor).toMatch(/^rgba\(/);
  });

  it('paints each instance entry with its assigned workflow colour', async () => {
    await render();
    await open();

    const option = document.querySelector<HTMLElement>('.subgraph-instance-option')!;
    expect(option.style.backgroundColor).toMatch(/^rgba\(/);
    expect(option.style.borderColor).toMatch(/^rgba\(/);
  });

  it('leaves the parent chips inert, so the row only ever picks an instance', async () => {
    await render();
    await open();

    // Colour outlines, not controls: a chip that navigated would be a second,
    // hidden action inside the option.
    expect(document.querySelectorAll('.subgraph-instance-parent button')).toHaveLength(0);
    expect(document.querySelector('.subgraph-instance-parent')!.tagName).toBe('SPAN');
  });

  it('selects an instance and closes', async () => {
    await render();
    await open();

    const options = document.querySelectorAll<HTMLElement>('.subgraph-instance-option');
    await act(async () => options[1].querySelector('button')!.click());

    expect(onSelect).toHaveBeenCalledWith(30);
    expect(document.querySelectorAll('.subgraph-instance-option')).toHaveLength(0);
  });

  it('does not re-select the instance already in view', async () => {
    await render();
    await open();

    const options = document.querySelectorAll<HTMLElement>('.subgraph-instance-option');
    await act(async () => options[0].querySelector('button')!.click());

    expect(onSelect).not.toHaveBeenCalled();
  });
});
