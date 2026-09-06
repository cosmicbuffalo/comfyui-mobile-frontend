import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/api/types';
import { BoundaryConnectionModal } from '../BoundaryConnectionModal';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  connectBoundaryInput: vi.fn(),
  connectBoundaryOutput: vi.fn(),
  removeBoundarySlot: vi.fn(),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  ),
}));

const SUBGRAPH_ID = 'aaaaaaaa-0000-4000-8000-000000000000';

/** One subgraph holding a single node with a free STRING input to offer. */
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
          inputs: [{ name: 'text', type: 'STRING', linkIds: [] }],
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
              inputs: [{ name: 'text', type: 'STRING', link: null }],
              outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: null }],
              properties: {},
              widgets_values: [],
            },
          ],
          links: [],
        },
      ],
    },
  } as unknown as Workflow;
}

/** Dispatch Escape the way a browser does, and report whether it was handled. */
function pressEscape(): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
  document.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('BoundaryConnectionModal', () => {
  let container: HTMLDivElement;
  let root: Root;
  let onClose: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    mocks.state = {
      workflow: makeWorkflow(),
      scopeStack: [{ type: 'subgraph', id: SUBGRAPH_ID }],
      nodeTypes: null,
      connectBoundaryInput: mocks.connectBoundaryInput,
      connectBoundaryOutput: mocks.connectBoundaryOutput,
      removeBoundarySlot: mocks.removeBoundarySlot,
    };
    onClose = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (isOpen: boolean) => {
    await act(async () => {
      root.render(
        <BoundaryConnectionModal
          isOpen={isOpen}
          onClose={onClose}
          direction="input"
          slotIndex={0}
          slotName="text"
          slotType="STRING"
        />,
      );
    });
  };

  it('closes on Escape', async () => {
    await render(true);
    expect(document.querySelector('.boundary-connection-list')).not.toBeNull();

    await act(async () => {
      pressEscape();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('marks the Escape handled so the panel behind it stays as it was', async () => {
    // The workflow panel exits select mode on Escape unless the key was already
    // handled — closing the picker must not also do that.
    await render(true);

    let handled = false;
    await act(async () => {
      handled = pressEscape();
    });

    expect(handled).toBe(true);
  });

  it('leaves Escape alone while it is closed', async () => {
    await render(false);

    let handled = false;
    await act(async () => {
      handled = pressEscape();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(handled).toBe(false);
  });
});
