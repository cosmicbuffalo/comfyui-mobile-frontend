import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeError } from '@/hooks/useWorkflowErrors';

const SUBGRAPH_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const INNER_ITEM_KEY = `root/subgraph:${SUBGRAPH_ID}/node:3`;

const seedError: NodeError = {
  type: 'invalid_input_type',
  message: 'Failed to convert an input value to a INT value',
  details: 'seed, None',
  inputName: 'seed',
};

function makeNode(id: number, type: string, itemKey: string) {
  return {
    id,
    type,
    itemKey,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
  };
}

const mocks = vi.hoisted(() => ({
  scrollToNode: vi.fn(),
  setErrorCycleIndex: vi.fn(),
  // Root holds only a save node and a subgraph placeholder — the shape of the
  // stock image templates, where every node that runs is inside the definition.
  workflow: {
    nodes: [] as unknown[],
  } as Record<string, unknown>,
  errors: {
    nodeErrors: {} as Record<string, NodeError[]>,
    nodeErrorsByItemKey: {} as Record<string, NodeError[]>,
  },
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    workflow: mocks.workflow,
    isExecuting: false,
    progress: 0,
    executingNodeId: null,
    executingNodePath: null,
    executingPromptId: null,
    workflowDurationStats: {},
    scrollToNode: mocks.scrollToNode,
    revealNodeWithParents: vi.fn(),
    nodeTypes: null,
  }),
}));

vi.mock('@/hooks/useNavigation', () => ({
  useNavigationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ currentPanel: 'workflow' }),
}));

vi.mock('@/hooks/useWorkflowErrors', () => ({
  useWorkflowErrorsStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    error: null,
    errorKind: null,
    nodeErrors: mocks.errors.nodeErrors,
    nodeErrorsByItemKey: mocks.errors.nodeErrorsByItemKey,
    nodeErrorsFromRun: true,
    errorsDismissed: false,
    setErrorsDismissed: vi.fn(),
    errorCycleIndex: 0,
    setErrorCycleIndex: mocks.setErrorCycleIndex,
  }),
}));

vi.mock('@/hooks/useImageViewer', () => ({
  useImageViewerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ viewerOpen: false }),
}));

vi.mock('@/hooks/useWidgetModalOpen', () => ({
  useWidgetModalOpenStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ openCount: 0 }),
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ running: [] }),
}));

vi.mock('@/hooks/useOverallProgress', () => ({ useOverallProgress: () => null }));

vi.mock('@/hooks/useConnectionStatus', () => ({
  useConnectionStatusStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ isConnected: true, hasEverConnected: true }),
}));

vi.mock('@/hooks/useLiveProgress', () => ({
  useLiveProgressStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ snapshot: null, isConnected: true, hasEverConnected: true }),
}));

import { BottomStatusOverlay } from '../BottomStatusOverlay';

describe('BottomStatusOverlay error toast jump', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.scrollToNode.mockClear();
    mocks.setErrorCycleIndex.mockClear();
    mocks.workflow = {
      nodes: [
        makeNode(9, 'SaveImage', 'root/node:9'),
        makeNode(57, SUBGRAPH_ID, `root/subgraph:${SUBGRAPH_ID}`),
      ],
    };
    mocks.errors.nodeErrors = {};
    mocks.errors.nodeErrorsByItemKey = {};
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const clickToast = () => {
    const toast = document.querySelector<HTMLElement>('#error-notification-toast');
    expect(toast).not.toBeNull();
    act(() => {
      toast!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };

  it('jumps to a failing node that lives inside a subgraph', () => {
    // The failure ComfyUI reported against `57:3` — a node that is NOT in
    // `workflow.nodes`. Walking root nodes found nothing, so the toast said
    // "tap to view" and then did nothing at all.
    mocks.errors.nodeErrors = { '57:3': [seedError] };
    mocks.errors.nodeErrorsByItemKey = { [INNER_ITEM_KEY]: [seedError] };

    act(() => root.render(<BottomStatusOverlay />));
    clickToast();

    expect(mocks.scrollToNode).toHaveBeenCalledTimes(1);
    // scrollToNode travels to the item's own scope, so this enters the subgraph.
    expect(mocks.scrollToNode.mock.calls[0][0]).toBe(INNER_ITEM_KEY);
    expect(mocks.setErrorCycleIndex).toHaveBeenCalled();
  });

  it('still jumps to a failing root node', () => {
    mocks.errors.nodeErrors = { '9': [seedError] };
    mocks.errors.nodeErrorsByItemKey = { 'root/node:9': [seedError] };

    act(() => root.render(<BottomStatusOverlay />));
    clickToast();

    expect(mocks.scrollToNode).toHaveBeenCalledTimes(1);
    expect(mocks.scrollToNode.mock.calls[0][0]).toBe('root/node:9');
  });

  it('reports how many nodes were skipped', () => {
    mocks.errors.nodeErrors = { '57:3': [seedError] };
    mocks.errors.nodeErrorsByItemKey = { [INNER_ITEM_KEY]: [seedError] };

    act(() => root.render(<BottomStatusOverlay />));

    expect(document.querySelector('.error-message')?.textContent).toContain(
      '1 node had invalid inputs',
    );
  });
});
