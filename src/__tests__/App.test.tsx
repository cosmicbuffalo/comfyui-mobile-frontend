import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { useShowHiddenStore } from '@/hooks/useShowHidden';

const workflowState = {
  followQueue: false,
  setFollowQueue: vi.fn(),
  setNodeTypes: vi.fn(),
  ensureHierarchicalKeysAndRepair: vi.fn(),
  workflowLoadedAt: 0,
  scopeStack: [{ type: 'root' }] as Array<
    | { type: 'root' }
    | { type: 'subgraph'; id: string; placeholderNodeId: number }
  >,
  exitToRoot: vi.fn(),
};

const queueState = {
  fetchQueue: vi.fn(),
  running: [] as unknown[],
};

const outputsState = {
  outputsViewerOpen: false,
  selectionMode: false,
  filterModalOpen: false,
  selectionActionOpen: false,
  currentFolder: '',
  navigateUp: vi.fn(),
};

const navigationState = {
  currentPanel: 'workflow',
  setCurrentPanel: vi.fn(),
};

let swipeNavigationOptions: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
} | null = null;

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (state: typeof workflowState) => unknown) =>
    selector(workflowState),
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (state: typeof queueState) => unknown) =>
    selector(queueState),
}));

vi.mock('@/hooks/useOutputs', () => ({
  useOutputsStore: (selector: (state: typeof outputsState) => unknown) =>
    selector(outputsState),
}));

vi.mock('@/hooks/useNavigation', () => ({
  useNavigationStore: (selector: (state: { currentPanel: string; setCurrentPanel: () => void }) => unknown) =>
    selector(navigationState),
}));

vi.mock('@/hooks/useAppMenu', () => ({
  useAppMenuStore: (selector: (state: { appMenuOpen: boolean }) => unknown) =>
    selector({ appMenuOpen: false }),
}));

vi.mock('@/hooks/useImageViewer', () => ({
  useImageViewerStore: (
    selector: (state: {
      viewerOpen: boolean;
      setViewerState: () => void;
    }) => unknown,
  ) => selector({ viewerOpen: false, setViewerState: vi.fn() }),
}));

vi.mock('@/hooks/useHistory', () => ({
  useHistoryStore: (selector: (state: { history: unknown[] }) => unknown) =>
    selector({ history: [] }),
}));

vi.mock('@/hooks/useBookmarks', () => ({
  useBookmarksStore: (selector: (state: { bookmarkRepositioningActive: boolean }) => unknown) =>
    selector({ bookmarkRepositioningActive: false }),
}));

vi.mock('@/hooks/useSwipeNavigation', () => ({
  useSwipeNavigation: (options: typeof swipeNavigationOptions) => {
    swipeNavigationOptions = options;
    return {
      swipeOffset: 0,
      isSwiping: false,
      setSwipeEnabled: vi.fn(),
      resetSwipeState: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/useTextareaFocus', () => ({
  useTextareaFocus: () => ({ isInputFocused: false }),
}));

vi.mock('@/hooks/useWebSocket', () => ({
  useWebSocket: () => {},
}));

vi.mock('@/api/client', () => ({
  getNodeTypes: vi.fn(async () => ({})),
}));

vi.mock('@/components/TopBar', () => ({ TopBar: () => null }));
vi.mock('@/components/WorkflowPanel', () => ({ WorkflowPanel: () => null }));
vi.mock('@/components/BottomBar', () => ({ BottomBar: () => null }));
vi.mock('@/components/QueuePanel', () => ({
  QueuePanel: ({ visible }: { visible: boolean }) => (
    <div data-queue-panel data-visible={String(visible)} />
  ),
}));
vi.mock('@/components/ImageViewer', () => ({ ImageViewer: () => null }));
vi.mock('@/components/OutputsPanel', () => ({
  OutputsPanel: ({ visible }: { visible: boolean }) => (
    <div data-outputs-panel data-visible={String(visible)} />
  ),
}));

describe('App item-key repair effect', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    workflowState.followQueue = false;
    workflowState.workflowLoadedAt = 0;
    workflowState.setFollowQueue.mockReset();
    workflowState.setNodeTypes.mockReset();
    workflowState.ensureHierarchicalKeysAndRepair.mockReset();
    workflowState.scopeStack = [{ type: 'root' }];
    workflowState.exitToRoot.mockReset();
    queueState.fetchQueue.mockReset();
    outputsState.navigateUp.mockReset();
    navigationState.currentPanel = 'workflow';
    navigationState.setCurrentPanel.mockReset();
    useShowHiddenStore.setState({ showHidden: false });
    swipeNavigationOptions = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('invokes ensureHierarchicalKeysAndRepair when workflowLoadedAt changes to a loaded value', async () => {
    await act(async () => {
      root.render(<App />);
    });
    expect(workflowState.ensureHierarchicalKeysAndRepair).not.toHaveBeenCalled();

    workflowState.workflowLoadedAt = Date.now();
    await act(async () => {
      root.render(<App />);
    });
    expect(workflowState.ensureHierarchicalKeysAndRepair).toHaveBeenCalledTimes(1);
  });

  it('uses a backward workflow swipe to exit a nested subgraph to root', async () => {
    workflowState.scopeStack = [
      { type: 'root' },
      { type: 'subgraph', id: 'outer', placeholderNodeId: 10 },
      { type: 'subgraph', id: 'inner', placeholderNodeId: 20 },
    ];
    await act(async () => {
      root.render(<App />);
    });

    act(() => swipeNavigationOptions?.onSwipeRight?.());

    expect(workflowState.exitToRoot).toHaveBeenCalledOnce();
    expect(navigationState.setCurrentPanel).not.toHaveBeenCalled();
  });

  it('keeps backward workflow swipe navigation to outputs at root', async () => {
    await act(async () => {
      root.render(<App />);
    });

    act(() => swipeNavigationOptions?.onSwipeRight?.());

    expect(workflowState.exitToRoot).not.toHaveBeenCalled();
    expect(navigationState.setCurrentPanel).toHaveBeenCalledWith('outputs');
  });

  it('defers secondary panels until first visit and keeps them mounted afterward', async () => {
    await act(async () => {
      root.render(<App />);
    });
    expect(container.querySelector('[data-queue-panel]')).toBeNull();
    expect(container.querySelector('[data-outputs-panel]')).toBeNull();

    navigationState.currentPanel = 'queue';
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(container.querySelector('[data-queue-panel]')?.getAttribute('data-visible')).toBe('true');
    expect(container.querySelector('[data-outputs-panel]')).toBeNull();

    navigationState.currentPanel = 'workflow';
    await act(async () => {
      root.render(<App />);
    });
    expect(container.querySelector('[data-queue-panel]')?.getAttribute('data-visible')).toBe('false');
  });

  it('toggles the global hidden-item preference with Command+Shift+Period', async () => {
    await act(async () => {
      root.render(<App />);
    });

    const shortcut = new KeyboardEvent('keydown', {
      key: '>',
      code: 'Period',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => document.dispatchEvent(shortcut));

    expect(useShowHiddenStore.getState().showHidden).toBe(true);
    expect(shortcut.defaultPrevented).toBe(true);
  });
});
