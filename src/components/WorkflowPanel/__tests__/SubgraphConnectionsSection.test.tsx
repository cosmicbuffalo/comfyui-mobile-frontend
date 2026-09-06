import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/api/types';
import { SubgraphConnectionsSection } from '../SubgraphConnectionsSection';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  scrollToNode: vi.fn(),
  revealNodeWithParents: vi.fn(),
  expand: vi.fn(),
  setScopeTrail: vi.fn(),
  setScopeInstance: vi.fn(),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  ),
}));

vi.mock('@/hooks/useConnectionSectionFolds', () => ({
  useConnectionSectionFoldsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ expand: mocks.expand, collapsedItemKeys: [], toggleCollapsed: vi.fn() }),
}));

// The pickers have their own suites; here they only need to announce they opened.
vi.mock('@/components/modals/BoundaryConnectionModal', () => ({
  BoundaryConnectionModal: ({ direction, slotName }: { direction: string; slotName: string }) => (
    <div data-testid="boundary-picker">{`picker:${direction}:${slotName}`}</div>
  ),
}));

vi.mock('@/components/modals/AddBoundarySlotModal', () => ({
  AddBoundarySlotModal: ({ direction }: { direction: string }) => (
    <div data-testid="add-slot-picker">{`add:${direction}`}</div>
  ),
}));

vi.mock('@/components/modals/EditBoundarySlotLabelModal', () => ({
  EditBoundarySlotLabelModal: ({
    direction,
    slotIndex,
  }: {
    direction: string;
    slotIndex: number;
  }) => <div data-testid="label-editor">{`label:${direction}:${slotIndex}`}</div>,
}));

const SUBGRAPH_ID = 'aaaaaaaa-0000-4000-8000-000000000000';

/**
 * A subgraph whose single input feeds TWO inner nodes (native fan-out, no relay
 * node), and whose single output is fed by one of them.
 */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 10,
    last_link_id: 10,
    nodes: [
      {
        id: 99,
        type: SUBGRAPH_ID,
        title: 'Styler',
        itemKey: 'root/node:99',
        pos: [0, 0],
        size: [10, 10],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [{ name: 'text', type: 'STRING', link: null }],
        outputs: [{ name: 'result', type: 'IMAGE', links: null }],
        properties: {},
        widgets_values: [],
      },
    ],
    links: [],
    groups: [],
    config: {},
    definitions: {
      subgraphs: [
        {
          id: SUBGRAPH_ID,
          name: 'Styler',
          inputs: [{ name: 'text', type: 'STRING', linkIds: [1, 2] }],
          outputs: [{ name: 'result', type: 'IMAGE', linkIds: [3] }],
          nodes: [
            {
              id: 1,
              type: 'CLIPTextEncode',
              title: 'Positive',
              itemKey: `${SUBGRAPH_ID}/node:1`,
              pos: [0, 0],
              size: [10, 10],
              flags: {},
              order: 0,
              mode: 0,
              inputs: [{ name: 'text', type: 'STRING', link: 1 }],
              outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: null }],
              properties: {},
              widgets_values: [],
            },
            {
              id: 2,
              type: 'CLIPTextEncode',
              title: 'Negative',
              itemKey: `${SUBGRAPH_ID}/node:2`,
              pos: [0, 0],
              size: [10, 10],
              flags: {},
              order: 1,
              mode: 0,
              inputs: [{ name: 'text', type: 'STRING', link: 2 }],
              outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [3] }],
              properties: {},
              widgets_values: [],
            },
          ],
          links: [
            { id: 1, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'STRING' },
            { id: 2, origin_id: -10, origin_slot: 0, target_id: 2, target_slot: 0, type: 'STRING' },
            { id: 3, origin_id: 2, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
          ],
        },
      ],
    },
  } as unknown as Workflow;
}

/** The section renders through the shared ConnectionRow, so slots are addressed
 *  by their spoken action rather than by a class of their own. */
function slotButton(labelStart: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.getAttribute('aria-label')?.startsWith(labelStart),
  );
  if (!match) throw new Error(`no button whose aria-label starts with "${labelStart}"`);
  return match;
}

function menuItems(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>('.fixed.z-\\[1000\\] button'),
  );
}

describe('SubgraphConnectionsSection', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useRowMenuStore.setState({ openKey: null });
    mocks.state = {
      workflow: makeWorkflow(),
      nodeTypes: null,
      scopeStack: [
        { type: 'root' },
        { type: 'subgraph', id: SUBGRAPH_ID, placeholderNodeId: 99 },
      ],
      scrollToNode: mocks.scrollToNode,
      revealNodeWithParents: mocks.revealNodeWithParents,
      setScopeTrail: mocks.setScopeTrail,
      setScopeInstance: mocks.setScopeInstance,
    };
    mocks.scrollToNode.mockClear();
    mocks.revealNodeWithParents.mockClear();
    mocks.expand.mockClear();
    mocks.setScopeTrail.mockClear();
    mocks.setScopeInstance.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async () => {
    await act(async () => {
      root.render(<SubgraphConnectionsSection subgraphId={SUBGRAPH_ID} />);
    });
  };

  it('lays the boundary out like a node card: inputs left, outputs right', async () => {
    await render();

    expect(document.body.textContent).toContain('Inputs');
    expect(document.body.textContent).toContain('Outputs');
    expect(document.body.textContent).toContain('text');
    expect(document.body.textContent).toContain('result');

    // Same two-column grid as NodeCardConnections, so the columns line up.
    const grid = document.querySelector('.grid.grid-cols-2');
    expect(grid).toBeTruthy();
    expect(grid!.children).toHaveLength(2);

    // Boundary slots take the promoted outline the inner slots wired to them
    // take, so one treatment means "crosses the subgraph edge" everywhere.
    expect(slotButton('Go to').className).toContain('connection-promoted');
  });

  it('offers the endpoints of a fanned-out input rather than guessing', async () => {
    await render();

    await act(async () => slotButton('Show 2 connections').click());

    expect(mocks.scrollToNode).not.toHaveBeenCalled();
    const endpoints = menuItems();
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0].textContent).toContain('Positive · text');

    await act(async () => endpoints[1].click());
    expect(mocks.scrollToNode).toHaveBeenCalledWith(
      `${SUBGRAPH_ID}/node:2`,
      undefined,
      // Flash the inner input the boundary slot actually feeds.
      'connection-button-2-input-0',
    );
  });

  it('jumps straight to the single endpoint of an output slot', async () => {
    await render();

    await act(async () => slotButton('Go to Negative').click());

    expect(mocks.scrollToNode).toHaveBeenCalledWith(
      `${SUBGRAPH_ID}/node:2`,
      undefined,
      'connection-button-2-output-0',
    );
    expect(menuItems()).toHaveLength(0);
  });

  it('still offers the Add buttons for a subgraph with no boundary slots yet', async () => {
    const workflow = makeWorkflow();
    const def = workflow.definitions!.subgraphs![0];
    def.inputs = [];
    def.outputs = [];
    mocks.state.workflow = workflow;

    await render();

    // An empty boundary needs somewhere to start, so the section stays.
    expect(slotButton('Add input slot')).toBeTruthy();
    expect(slotButton('Add output slot')).toBeTruthy();
  });

  it('opens the add-slot picker for the side whose button was pressed', async () => {
    await render();

    await act(async () => slotButton('Add output slot').click());

    expect(document.querySelector('[data-testid="add-slot-picker"]')?.textContent).toBe(
      'add:output',
    );
  });

  it('trails each column with its own add button, not a row of its own', async () => {
    await render();

    const columns = document.querySelectorAll('.grid.grid-cols-2 > div');
    // Adding an input belongs with the inputs, after the last of them.
    const inputButtons = Array.from(columns[0].querySelectorAll('button[aria-label]'));
    expect(inputButtons.at(-1)?.getAttribute('aria-label')).toBe('Add input slot');
    const outputButtons = Array.from(columns[1].querySelectorAll('button[aria-label]'));
    expect(outputButtons.at(-1)?.getAttribute('aria-label')).toBe('Add output slot');
  });

  it('marks the add buttons as invitations rather than slots', async () => {
    await render();

    // Grey, unmarked, and never dimmed the way an empty slot is.
    const add = slotButton('Add input slot');
    expect(add.className).toContain('connection-add-slot');
    expect(add.className).not.toContain('opacity-40');
    expect(add.className).not.toContain('connection-promoted');
  });

  it('renders nothing without a definition to describe', async () => {
    mocks.state.workflow = { ...makeWorkflow(), definitions: { subgraphs: [] } };

    await render();
    expect(container.textContent).toBe('');
  });

  it('opens the label editor from the menu on the slot it belongs to', async () => {
    await render();

    const menus = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button.row-actions-button'),
    );
    expect(menus).toHaveLength(2);

    await act(async () => menus[1].click());
    const rename = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Rename',
    );
    await act(async () => rename?.click());

    expect(document.querySelector('[data-testid="label-editor"]')?.textContent).toBe(
      'label:output:0',
    );
  });

  it('offers no move past either end of a direction\'s list', async () => {
    await render();

    const menus = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button.row-actions-button'),
    );
    // One input and one output, so each is both first and last in its column.
    await act(async () => menus[0].click());
    const labels = Array.from(document.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).not.toContain('Move up');
    expect(labels).not.toContain('Move down');
    expect(labels).toContain('Remove input');
  });

  it('shows each slot under the name THIS instance gives it', async () => {
    const workflow = makeWorkflow();
    workflow.definitions!.subgraphs![0].inputs![0].label = 'Prompt';
    workflow.nodes[0].properties = { mobileSlotLabels: { 'input:text': 'Positive' } };
    mocks.state.workflow = workflow;

    await render();

    expect(document.body.textContent).toContain('Positive');
    expect(document.body.textContent).not.toContain('Prompt');
  });

  it('marks a slot the other instances call something else', async () => {
    const workflow = makeWorkflow();
    workflow.nodes[0].properties = { mobileSlotLabels: { 'input:text': 'Positive' } };
    // A second instance, which keeps the shared name.
    workflow.nodes.push({ ...workflow.nodes[0], id: 100, properties: {} });
    mocks.state.workflow = workflow;

    await render();

    const marked = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button.row-actions-button'),
    ).filter((button) => button.className.includes('fuchsia'));
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('aria-label')).toContain('Positive');
  });
});

describe('SubgraphConnectionsSection instances', () => {
  let container: HTMLDivElement;
  let root: Root;

  /** The workflow plus a second instance of the same type, at root. */
  function twoInstances(): Workflow {
    const workflow = makeWorkflow();
    workflow.nodes.push({
      ...workflow.nodes[0],
      id: 100,
      itemKey: 'root/node:100',
      properties: { mobileInstanceNumber: 2 },
    });
    workflow.nodes[0].properties = { mobileInstanceNumber: 1 };
    // Instance 99's text input is fed from outside; instance 100's is not.
    workflow.nodes[0].inputs = [{ name: 'text', type: 'STRING', link: 500 }];
    workflow.nodes.push({
      ...workflow.nodes[0],
      id: 7,
      type: 'PrimitiveString',
      itemKey: 'root/node:7',
      title: 'Prompt source',
      inputs: [],
      outputs: [{ name: 'STRING', type: 'STRING', links: [500] }],
      properties: {},
    });
    workflow.links = [[500, 7, 0, 99, 0, 'STRING']] as Workflow['links'];
    return workflow;
  }

  beforeEach(() => {
    useRowMenuStore.setState({ openKey: null });
    mocks.state = {
      workflow: twoInstances(),
      nodeTypes: null,
      scopeStack: [
        { type: 'root' },
        { type: 'subgraph', id: SUBGRAPH_ID, placeholderNodeId: 99 },
      ],
      scrollToNode: mocks.scrollToNode,
      revealNodeWithParents: mocks.revealNodeWithParents,
      setScopeTrail: mocks.setScopeTrail,
      setScopeInstance: mocks.setScopeInstance,
    };
    mocks.setScopeInstance.mockClear();
    mocks.setScopeTrail.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async () => {
    await act(async () => {
      root.render(<SubgraphConnectionsSection subgraphId={SUBGRAPH_ID} />);
    });
  };

  it('groups a slot destinations by inside, this instance, and the others', async () => {
    await render();

    const inputSlot = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.getAttribute('aria-label')?.startsWith('Show '))!;
    await act(async () => inputSlot.click());

    const menu = document.querySelector('.fixed.z-\\[1000\\]');
    expect(menu?.textContent).toContain('In this subgraph');
    expect(menu?.textContent).toContain('Positive · text');
    // Instance 99 is the one in view, and it is the one wired to the source.
    expect(menu?.textContent).toContain('Connected to this instance');
    expect(menu?.textContent).toContain('Prompt source');
    // Instance 100's input is unwired outside, so it contributes nothing.
    expect(menu?.textContent).not.toContain('Connected to other instances');
  });

  it('lists the other instances\' connections under their own heading', async () => {
    const workflow = twoInstances();
    // Wire instance 100's input to a second source, so it has somewhere to go.
    workflow.nodes.find((n) => n.id === 100)!.inputs = [
      { name: 'text', type: 'STRING', link: 501 },
    ];
    workflow.nodes.push({
      ...workflow.nodes.find((n) => n.id === 7)!,
      id: 8,
      itemKey: 'root/node:8',
      title: 'Other source',
      outputs: [{ name: 'STRING', type: 'STRING', links: [501] }],
    });
    workflow.links = [
      [500, 7, 0, 99, 0, 'STRING'],
      [501, 8, 0, 100, 0, 'STRING'],
    ] as Workflow['links'];
    mocks.state.workflow = workflow;

    await render();
    const inputSlot = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.getAttribute('aria-label')?.startsWith('Show '))!;
    await act(async () => inputSlot.click());

    const menu = document.querySelector('.fixed.z-\\[1000\\]');
    expect(menu?.textContent).toContain('Connected to this instance');
    expect(menu?.textContent).toContain('Prompt source');
    expect(menu?.textContent).toContain('Connected to other instances');
    // Named by the instance it belongs to, since that is what distinguishes it.
    expect(menu?.textContent).toContain('Other source');
  });

  it('travels to the outer node through its own scope trail', async () => {
    await render();

    const inputSlot = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.getAttribute('aria-label')?.startsWith('Show '))!;
    await act(async () => inputSlot.click());

    const outerEntry = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.fixed.z-\\[1000\\] button'),
    ).find((button) => button.textContent?.includes('Prompt source'))!;
    await act(async () => outerEntry.click());

    expect(mocks.setScopeTrail).toHaveBeenCalledWith([{ type: 'root' }]);
  });
});

describe('SubgraphConnectionsSection unwired inside', () => {
  let container: HTMLDivElement;
  let root: Root;

  /**
   * The input slot carries nothing inside the subgraph. `outerLink` decides
   * whether the placeholder's matching input is fed from the root scope.
   */
  function unwiredInside(outerLink: boolean): Workflow {
    const workflow = makeWorkflow();
    // Endpoints are read from the subgraph's own link table, so that is what
    // has to be empty for the slot to be unwired on the inside.
    workflow.definitions!.subgraphs![0].links = [];
    workflow.definitions!.subgraphs![0].inputs![0].linkIds = [];
    for (const node of workflow.definitions!.subgraphs![0].nodes!) {
      node.inputs = node.inputs?.map((input) => ({ ...input, link: null }));
    }
    if (outerLink) {
      workflow.nodes[0].inputs = [{ name: 'text', type: 'STRING', link: 500 }];
      workflow.nodes.push({
        ...workflow.nodes[0],
        id: 7,
        type: 'PrimitiveString',
        itemKey: 'root/node:7',
        title: 'Prompt source',
        inputs: [],
        outputs: [{ name: 'STRING', type: 'STRING', links: [500] }],
        properties: {},
      });
      workflow.links = [[500, 7, 0, 99, 0, 'STRING']] as Workflow['links'];
    }
    return workflow;
  }

  const mountWith = async (workflow: Workflow) => {
    mocks.state = {
      workflow,
      nodeTypes: null,
      scopeStack: [
        { type: 'root' },
        { type: 'subgraph', id: SUBGRAPH_ID, placeholderNodeId: 99 },
      ],
      scrollToNode: mocks.scrollToNode,
      revealNodeWithParents: mocks.revealNodeWithParents,
      setScopeTrail: mocks.setScopeTrail,
      setScopeInstance: mocks.setScopeInstance,
    };
    await act(async () => {
      root.render(<SubgraphConnectionsSection subgraphId={SUBGRAPH_ID} />);
    });
  };

  const inputSlotButton = () =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.getAttribute('aria-label')?.startsWith('Connect subgraph input'),
    )!;

  beforeEach(() => {
    useRowMenuStore.setState({ openKey: null });
    mocks.scrollToNode.mockClear();
    mocks.setScopeTrail.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // The slot has an outer destination, so it used to be followed on tap — which
  // left the subgraph to show a connection the slot does not have inside it.
  it('offers the picker for a slot fed from outside but unwired inside', async () => {
    await mountWith(unwiredInside(true));

    await act(async () => inputSlotButton().click());

    expect(document.querySelector('[data-testid="boundary-picker"]')?.textContent).toBe(
      'picker:input:text',
    );
    // Emphatically not a trip out to the root scope.
    expect(mocks.setScopeTrail).not.toHaveBeenCalled();
    expect(mocks.scrollToNode).not.toHaveBeenCalled();
  });

  it('offers the picker for a slot wired on neither side', async () => {
    await mountWith(unwiredInside(false));

    await act(async () => inputSlotButton().click());

    expect(document.querySelector('[data-testid="boundary-picker"]')?.textContent).toBe(
      'picker:input:text',
    );
  });

  it('names the slot by what tapping it does, rather than by an outside link', async () => {
    await mountWith(unwiredInside(true));

    expect(inputSlotButton().getAttribute('aria-label')).toBe(
      'Connect subgraph input text',
    );
  });

  // The other half of the rule: once the inside IS wired, an outer connection
  // is still worth offering — it just shares a menu rather than taking the tap.
  it('still opens the menu when the slot is wired inside and outside', async () => {
    const workflow = makeWorkflow();
    workflow.nodes[0].inputs = [{ name: 'text', type: 'STRING', link: 500 }];
    workflow.nodes.push({
      ...workflow.nodes[0],
      id: 7,
      type: 'PrimitiveString',
      itemKey: 'root/node:7',
      title: 'Prompt source',
      inputs: [],
      outputs: [{ name: 'STRING', type: 'STRING', links: [500] }],
      properties: {},
    });
    workflow.links = [[500, 7, 0, 99, 0, 'STRING']] as Workflow['links'];
    await mountWith(workflow);

    const slot = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.getAttribute('aria-label')?.startsWith('Show '))!;
    await act(async () => slot.click());

    const menu = document.querySelector('.fixed.z-\\[1000\\]');
    expect(menu?.textContent).toContain('In this subgraph');
    expect(menu?.textContent).toContain('Prompt source');
    expect(document.querySelector('[data-testid="boundary-picker"]')).toBeNull();
  });
});
