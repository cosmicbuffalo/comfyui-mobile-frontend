import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useRowMenuStore } from '@/hooks/useRowMenuStore';
import { ConnectionButton } from '../Connections/ConnectionButton';

const SG = 'sg-section';

function node(id: number, overrides?: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: `root/node:${id}`,
    type: 'CheckpointLoader',
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

/**
 * A fully-wired placeholder: every boundary slot is connected, so every row
 * draws as a connection rather than a widget. Before the menu reached these
 * rows, such a card offered no way to rename, reorder or remove a slot at all.
 */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 100,
    last_link_id: 10,
    nodes: [
      node(1, { outputs: [{ name: 'MODEL', type: 'MODEL', links: [5] }] }),
      node(2, { outputs: [{ name: 'CLIP', type: 'CLIP', links: [6] }] }),
      node(99, {
        type: SG,
        inputs: [
          { name: 'model', type: 'MODEL', link: 5 },
          { name: 'clip', type: 'CLIP', link: 6 },
        ],
        outputs: [],
      }),
    ],
    links: [
      [5, 1, 0, 99, 0, 'MODEL'],
      [6, 2, 0, 99, 1, 'CLIP'],
    ],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [
        {
          id: SG,
          name: 'Section',
          inputs: [
            { id: 'i0', name: 'model', type: 'MODEL', linkIds: [] },
            { id: 'i1', name: 'clip', type: 'CLIP', linkIds: [] },
          ],
          outputs: [],
          nodes: [],
          links: [],
          groups: [],
        },
      ],
    },
  } as unknown as Workflow;
}

describe('placeholder connection row menu', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useRowMenuStore.setState({ openKey: null });
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

  const renderSlot = async (slotIndex: number) => {
    const placeholder = useWorkflowStore.getState().workflow!.nodes.find((n) => n.id === 99)!;
    await act(async () => {
      root.render(
        <ConnectionButton
          slot={placeholder.inputs[slotIndex]}
          nodeId={99}
          direction="input"
          slotIndex={slotIndex}
        />,
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>('.row-actions-button');
    await act(async () => trigger?.click());
    return Array.from(document.querySelectorAll('.row-actions-menu button')).map(
      (button) => button.textContent,
    );
  };

  it('offers the slot actions on a connected placeholder row', async () => {
    const labels = await renderSlot(0);

    expect(labels).toContain('Rename');
    expect(labels).toContain('Remove input');
    // First of two slots: down only.
    expect(labels).toContain('Move down');
    expect(labels).not.toContain('Move up');
    expect(document.querySelector('.row-actions-type')?.textContent).toBe('MODEL');
  });

  it('moves the slot on the definition, from outside the subgraph', async () => {
    await renderSlot(0);
    const moveDown = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.row-actions-menu button'),
    ).find((button) => button.textContent === 'Move down');
    await act(async () => moveDown?.click());

    const definition = useWorkflowStore
      .getState()
      .workflow?.definitions?.subgraphs?.find((sg) => sg.id === SG);
    expect(definition?.inputs?.map((slot) => slot.name)).toEqual(['clip', 'model']);
  });

  it('leaves an ordinary node\'s connection rows without a slot menu', async () => {
    await act(async () => {
      root.render(
        <ConnectionButton
          slot={{ name: 'model', type: 'MODEL', link: null }}
          nodeId={1}
          direction="input"
          slotIndex={0}
        />,
      );
    });

    expect(container.querySelector('.row-actions-button')).toBeNull();
  });

  it('says when a reorder will rearrange every instance of the type', async () => {
    // A move from one card rewrites the TYPE, so every sibling instance
    // follows. That is correct, but it is the only card-level action that
    // visibly changes cards the user cannot see — so the menu says so before
    // the tap rather than leaving it to be discovered.
    const workflow = useWorkflowStore.getState().workflow!;
    useWorkflowStore.setState({
      workflow: {
        ...workflow,
        nodes: [
          ...workflow.nodes,
          node(100, { type: SG, inputs: [], outputs: [] }),
          node(101, { type: SG, inputs: [], outputs: [] }),
        ],
      },
    });

    await renderSlot(0);

    expect(document.querySelector('.row-actions-note')?.textContent).toBe(
      'Order is shared by all 3 instances',
    );
  });

  it('stays quiet for a type with a single instance', async () => {
    await renderSlot(0);
    expect(document.querySelector('.row-actions-note')).toBeNull();
  });
});
