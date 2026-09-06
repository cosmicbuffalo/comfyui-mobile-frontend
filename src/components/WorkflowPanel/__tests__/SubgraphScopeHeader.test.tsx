import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { SubgraphScopeHeader } from '../SubgraphScopeHeader';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  renameSubgraphType: vi.fn(),
  updateNodeTitle: vi.fn(),
  setScopeInstance: vi.fn(),
  exitSubgraph: vi.fn(),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  ),
}));

vi.mock('@/components/modals/SubgraphTypeInfoModal', () => ({
  SubgraphTypeInfoModal: () => <div data-testid="type-info" />,
}));

const SG = 'sg-styler';

function placeholder(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    type: SG,
    itemKey: `root/node:${id}`,
    pos: [0, 0],
    size: [10, 10],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: { mobileInstanceNumber: id === 10 ? 1 : 2 },
    widgets_values: [],
    ...overrides,
  } as WorkflowNode;
}

function makeWorkflow(instanceCount = 2): Workflow {
  const nodes = [placeholder(10, { title: 'Positive styler' })];
  if (instanceCount > 1) nodes.push(placeholder(11));
  return {
    nodes,
    links: [],
    groups: [],
    config: {},
    definitions: {
      subgraphs: [
        { id: SG, name: 'Styler {n}', inputs: [], outputs: [], nodes: [], links: [] },
      ],
    },
  } as unknown as Workflow;
}

describe('SubgraphScopeHeader', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.state = {
      workflow: makeWorkflow(),
      scopeStack: [{ type: 'root' }, { type: 'subgraph', id: SG, placeholderNodeId: 10 }],
      mobileLayout: { root: [], groups: {}, subgraphs: {}, hiddenBlocks: {} },
      nodeTypes: null,
      renameSubgraphType: mocks.renameSubgraphType,
      updateNodeTitle: mocks.updateNodeTitle,
      setScopeInstance: mocks.setScopeInstance,
      exitSubgraph: mocks.exitSubgraph,
    };
    mocks.renameSubgraphType.mockClear();
    mocks.updateNodeTitle.mockClear();
    mocks.exitSubgraph.mockClear();
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
      root.render(<SubgraphScopeHeader subgraphId={SG} />);
    });
  };

  const byLabel = (label: string) =>
    container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

  it('titles the scope with the type name, template token and all', async () => {
    await render();

    // The token is what the edit button is about to edit, so it is not hidden.
    expect(container.querySelector('.subgraph-scope-title')?.textContent).toContain(
      'Subgraph Styler {n}',
    );
  });

  it('leaves the scope from a button pinned to the left of the title', async () => {
    await render();

    const exit = byLabel('Exit subgraph');
    // Out of the flow, so centring the title on the row centres it on the
    // column rather than pushing it off to make room.
    expect(exit.className).toContain('absolute');
    expect(exit.className).toMatch(/\bleft-/);

    await act(async () => exit.click());
    expect(mocks.exitSubgraph).toHaveBeenCalledTimes(1);
  });

  it('subtitles it with the instance number and the instance name', async () => {
    await render();

    const subtitle = container.querySelector('.subgraph-scope-subtitle')!;
    expect(subtitle.textContent).toContain('Instance #1');
    expect(subtitle.textContent).toContain('Positive styler');
  });

  it('renders the type template for an instance with no name of its own', async () => {
    mocks.state.scopeStack = [
      { type: 'root' },
      { type: 'subgraph', id: SG, placeholderNodeId: 11 },
    ];
    await render();

    // Instance 11 is instance 2, so the name it inherits reads "Styler 2" — the
    // title line above still shows the template, since that is what it edits.
    const trigger = container.querySelector('.subgraph-instance-trigger')!;
    expect(trigger.textContent).toContain('Styler 2');
    expect(trigger.textContent).not.toContain('{n}');
    expect(container.querySelector('.subgraph-scope-title')?.textContent).toContain('{n}');
  });

  it('renames the type from the title', async () => {
    await render();
    await act(async () => byLabel('Rename subgraph type').click());

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Subgraph name"]')!;
    expect(input.value).toBe('Styler {n}');
    await act(async () => {
      input.value = 'Prompt {n}';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // React delegates blur as a bubbling `focusout`; a plain `blur` never
      // reaches its handler.
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

    expect(mocks.renameSubgraphType).toHaveBeenCalledWith(SG, 'Prompt {n}');
  });

  it('renames this instance alone from the subtitle', async () => {
    await render();
    await act(async () => byLabel('Rename this instance').click());

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Instance name"]')!;
    await act(async () => {
      input.value = 'Negative styler';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // React delegates blur as a bubbling `focusout`; a plain `blur` never
      // reaches its handler.
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

    expect(mocks.updateNodeTitle).toHaveBeenCalledWith('root/node:10', 'Negative styler');
  });

  it('clears the instance name to fall back on the type name', async () => {
    await render();
    await act(async () => byLabel('Rename this instance').click());

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Instance name"]')!;
    await act(async () => {
      input.value = '   ';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // React delegates blur as a bubbling `focusout`; a plain `blur` never
      // reaches its handler.
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });

    // null, not '', so the placeholder carries no title at all.
    expect(mocks.updateNodeTitle).toHaveBeenCalledWith('root/node:10', null);
  });

  it('warns that edits reach every instance, and offers the explanation', async () => {
    await render();

    expect(container.querySelector('.subgraph-shared-notice')?.textContent).toContain(
      'Edits here affect all 2 instances',
    );
    // The banner states the problem; the button beside it is the way out.
    const fork = byLabel('About subgraph types and instances');
    expect(fork.textContent).toContain('Fork subgraph');
    // Pushed to the banner's right edge rather than trailing the text.
    expect(fork.className).toContain('ml-auto');

    await act(async () => fork.click());
    expect(document.querySelector('[data-testid="type-info"]')).toBeTruthy();
  });

  it('says nothing about sharing when the type has one instance', async () => {
    mocks.state.workflow = makeWorkflow(1);
    await render();

    expect(container.querySelector('.subgraph-shared-notice')).toBeNull();
  });
});
