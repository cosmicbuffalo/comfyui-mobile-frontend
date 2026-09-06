import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { MoveIntoSubgraphModal } from '@/components/modals/MoveIntoSubgraphModal';

const SHARED = 'sg-shared';
const LONE = 'sg-lone';

function node(id: number, type: string, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: `root/node:${id}`,
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

/** Two instances of one type, one lone subgraph, and a node to move. */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 20,
    last_link_id: 0,
    nodes: [
      node(1, SHARED, { properties: { mobileInstanceNumber: 1 } }),
      node(2, SHARED, { properties: { mobileInstanceNumber: 2 } }),
      node(3, LONE),
      node(4, 'INTConstant'),
    ],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [
        { id: SHARED, name: 'Section', inputs: [], outputs: [], nodes: [], links: [], groups: [] },
        { id: LONE, name: 'Solo', inputs: [], outputs: [], nodes: [], links: [], groups: [] },
      ],
    },
  } as unknown as Workflow;
}

const text = () => document.body.textContent ?? '';
const buttons = () => Array.from(document.querySelectorAll('button'));
const byText = (needle: string) => buttons().find((b) => b.textContent?.includes(needle));

describe('MoveIntoSubgraphModal', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      scopeStack: [{ type: 'root' }],
      nodeTypes: null,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const render = async (onConfirm = vi.fn(), itemKeys = ['root/node:4']) => {
    await act(async () => {
      root.render(
        <MoveIntoSubgraphModal
          itemKeys={itemKeys}
          onClose={() => {}}
          onConfirm={onConfirm}
        />,
      );
    });
    return onConfirm;
  };

  it('offers every subgraph in the scope as a destination', async () => {
    await render();
    expect(document.querySelectorAll('.move-into-subgraph-option')).toHaveLength(3);
  });

  it('says which destinations are shared, and by how many', async () => {
    await render();
    expect(text()).toContain('Shared by 2 instances');
  });

  it('does not offer a placeholder that is itself being moved', async () => {
    await render(vi.fn(), ['root/node:3']);
    const labels = Array.from(document.querySelectorAll('.move-into-subgraph-option'))
      .map((option) => option.textContent);
    expect(labels.some((label) => label?.includes('Solo'))).toBe(false);
  });

  it('does not offer a placeholder contained by a group being moved', async () => {
    const workflow = makeWorkflow();
    workflow.nodes = workflow.nodes.map((entry) =>
      entry.id === 3 || entry.id === 4
        ? { ...entry, pos: [100, entry.id * 40] as [number, number] }
        : { ...entry, pos: [1000, entry.id * 40] as [number, number] },
    );
    workflow.groups = [{
      id: 10,
      itemKey: 'root/group:10',
      title: 'Movers',
      color: '#ffffff',
      bounding: [50, 50, 400, 300],
    }];
    useWorkflowStore.setState({ workflow });

    await render(vi.fn(), ['root/group:10']);
    const labels = Array.from(document.querySelectorAll('.move-into-subgraph-option'))
      .map((option) => option.textContent);
    expect(labels.some((label) => label?.includes('Solo'))).toBe(false);
    expect(labels.filter((label) => label?.includes('Section'))).toHaveLength(2);
  });

  it('confirms straight away for a subgraph with one instance', async () => {
    const onConfirm = await render();
    await act(async () => {
      (document.querySelector('[data-node-id="3"]') as HTMLButtonElement).click();
    });
    expect(onConfirm).toHaveBeenCalledWith('root/node:3');
  });

  it('warns before changing a shared type, rather than confirming', async () => {
    const onConfirm = await render();
    await act(async () => {
      (document.querySelector('[data-node-id="1"]') as HTMLButtonElement).click();
    });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(text()).toContain('This subgraph is shared');
    // Both ways forward, because breaking the others is a legitimate choice as
    // long as it is made knowingly.
    expect(byText('Fork first')).toBeTruthy();
    expect(byText('Move anyway')).toBeTruthy();
  });

  it('goes ahead without forking when the user says so', async () => {
    const onConfirm = await render();
    await act(async () => {
      (document.querySelector('[data-node-id="1"]') as HTMLButtonElement).click();
    });
    await act(async () => byText('Move anyway')!.click());

    expect(onConfirm).toHaveBeenCalledWith('root/node:1');
    // The type is untouched: the other instance still points at it.
    const workflow = useWorkflowStore.getState().workflow!;
    expect(workflow.nodes.filter((n) => n.type === SHARED)).toHaveLength(2);
  });

  it('forks this instance onto a type of its own first', async () => {
    const onConfirm = await render();
    await act(async () => {
      (document.querySelector('[data-node-id="1"]') as HTMLButtonElement).click();
    });
    await act(async () => byText('Fork first')!.click());

    const workflow = useWorkflowStore.getState().workflow!;
    const forked = workflow.nodes.find((n) => n.id === 1)!;
    // Same node id — so the key the caller was handed still names it — but a
    // definition of its own, which is the whole point of forking.
    expect(forked.type).not.toBe(SHARED);
    expect(workflow.nodes.find((n) => n.id === 2)!.type).toBe(SHARED);
    expect(onConfirm).toHaveBeenCalledWith('root/node:1');
  });

  it('says so plainly when there is nowhere to move into', async () => {
    useWorkflowStore.setState({
      workflow: {
        ...makeWorkflow(),
        nodes: [node(4, 'INTConstant')],
      } as Workflow,
    });
    await render();
    expect(text()).toContain('no subgraph in this scope');
  });
});
