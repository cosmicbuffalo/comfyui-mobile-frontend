import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { ConnectionModal } from '../ConnectionModal';

const SUBGRAPH_ID = 'aaaaaaaa-0000-4000-8000-000000000000';

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  connectBoundaryInput: vi.fn(),
  connectBoundaryOutput: vi.fn(),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  ),
}));

vi.mock('@/hooks/useConnectionSectionFolds', () => ({
  useConnectionSectionFoldsStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ expand: vi.fn() }),
}));

function node(id: number, overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id,
    itemKey: `${SUBGRAPH_ID}/node:${id}`,
    type: 'TestNode',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  };
}

function makeWorkflow(): Workflow {
  return {
    last_node_id: 2,
    last_link_id: 4,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [{
        id: SUBGRAPH_ID,
        name: 'Inner workflow',
        inputs: [
          { name: 'prompt', label: 'Prompt', type: 'STRING', linkIds: [1, 2] },
          { name: 'mask', label: 'Mask', type: 'MASK', linkIds: [] },
        ],
        outputs: [
          { name: 'result', label: 'Result', type: 'IMAGE', linkIds: [3] },
          { name: 'alternate', label: 'Alternate', type: 'IMAGE', linkIds: [4] },
          { name: 'caption', label: 'Caption', type: 'STRING', linkIds: [] },
        ],
        nodes: [
          node(1, {
            title: 'Current',
            inputs: [{ name: 'text', type: 'STRING', link: 1 }],
            outputs: [{ name: 'image', type: 'IMAGE', links: [3] }],
          }),
          node(2, {
            title: 'Other',
            inputs: [{ name: 'text', type: 'STRING', link: 2 }],
            outputs: [{ name: 'image', type: 'IMAGE', links: [4] }],
          }),
        ],
        links: [
          { id: 1, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'STRING' },
          { id: 2, origin_id: -10, origin_slot: 0, target_id: 2, target_slot: 0, type: 'STRING' },
          { id: 3, origin_id: 1, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
          { id: 4, origin_id: 2, origin_slot: 0, target_id: -20, target_slot: 1, type: 'IMAGE' },
        ],
      }],
    },
  };
}

function button(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`No button labelled "${label}"`);
  return match;
}

function boundaryCandidate(label: string): HTMLButtonElement {
  const match = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.connection-boundary-candidate'),
  ).find((candidate) => candidate.textContent?.includes(label));
  if (!match) throw new Error(`No boundary candidate containing "${label}"`);
  return match;
}

describe('ConnectionModal subgraph boundary slots', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.connectBoundaryInput.mockClear();
    mocks.connectBoundaryOutput.mockClear();
    mocks.state = {
      workflow: makeWorkflow(),
      scopeStack: [
        { type: 'root' },
        { type: 'subgraph', id: SUBGRAPH_ID, placeholderNodeId: 99 },
      ],
      nodeTypes: null,
      connectNodes: vi.fn(),
      disconnectInput: vi.fn(),
      updateNodeWidget: vi.fn(),
      ensureWidgetInputSlot: vi.fn(),
      addNode: vi.fn(),
      addNodeAndConnect: vi.fn(),
      addBoundaryInput: vi.fn(),
      addBoundaryOutput: vi.fn(),
      connectBoundaryInput: mocks.connectBoundaryInput,
      connectBoundaryOutput: mocks.connectBoundaryOutput,
      scrollToNode: vi.fn(),
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('lists compatible subgraph inputs first and preserves the rest of their fan-out', async () => {
    await act(async () => {
      root.render(
        <ConnectionModal
          isOpen
          onClose={() => {}}
          nodeId={1}
          mode="input"
          inputIndex={0}
          inputType="STRING"
          inputName="text"
          currentlyConnectedNodeId={-10}
          originHadConnection
        />,
      );
    });

    expect(document.body.textContent).toContain('Subgraph inputs');
    expect(boundaryCandidate('Prompt').textContent).toContain('Connected');
    expect(document.querySelectorAll('.connection-boundary-candidate')).toHaveLength(1);

    await act(async () => boundaryCandidate('Prompt').click());
    await act(async () => button('Apply').click());

    expect(mocks.connectBoundaryInput).toHaveBeenCalledWith(0, [
      { nodeKey: `${SUBGRAPH_ID}/node:2`, inputSlot: 0 },
    ]);
  });

  it('lists compatible subgraph outputs and confirms before replacing an occupied slot', async () => {
    await act(async () => {
      root.render(
        <ConnectionModal
          isOpen
          onClose={() => {}}
          nodeId={1}
          mode="output"
          outputIndex={0}
          outputType="IMAGE"
          outputName="image"
          originHadConnection
        />,
      );
    });

    expect(document.body.textContent).toContain('Subgraph outputs');
    expect(boundaryCandidate('Result').textContent).toContain('Connected');
    expect(boundaryCandidate('Alternate').textContent).toContain('Already linked');
    expect(document.querySelectorAll('.connection-boundary-candidate')).toHaveLength(2);

    await act(async () => boundaryCandidate('Alternate').click());
    await act(async () => button('Apply').click());
    expect(document.body.textContent).toContain('Overwrite existing connections?');
    expect(mocks.connectBoundaryOutput).not.toHaveBeenCalled();

    await act(async () => button('Overwrite').click());
    expect(mocks.connectBoundaryOutput).toHaveBeenCalledWith(1, {
      nodeKey: `${SUBGRAPH_ID}/node:1`,
      outputSlot: 0,
    });
  });

  it('disconnects a deselected subgraph output slot', async () => {
    await act(async () => {
      root.render(
        <ConnectionModal
          isOpen
          onClose={() => {}}
          nodeId={1}
          mode="output"
          outputIndex={0}
          outputType="IMAGE"
          outputName="image"
          originHadConnection
        />,
      );
    });

    await act(async () => boundaryCandidate('Result').click());
    await act(async () => button('Apply').click());
    expect(mocks.connectBoundaryOutput).toHaveBeenCalledWith(0, null);
  });
});
