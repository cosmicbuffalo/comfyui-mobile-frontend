import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';

const workflowState = {
  followQueue: false,
  setFollowQueue: vi.fn(),
  setNodeTypes: vi.fn(),
  ensureStableKeysAndRepair: vi.fn(),
  workflowLoadedAt: 0,
};

const queueState = {
  fetchQueue: vi.fn(),
};

const outputsState = {
  outputsViewerOpen: false,
  selectionMode: false,
  filterModalOpen: false,
  selectionActionOpen: false,
  currentFolder: '',
  navigateUp: vi.fn(),
};

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
    selector({ currentPanel: 'workflow', setCurrentPanel: vi.fn() }),
}));

vi.mock('@/hooks/useTheme', () => ({
  useThemeStore: (selector: (state: { theme: 'light' | 'dark' }) => unknown) =>
    selector({ theme: 'light' }),
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
  useSwipeNavigation: () => ({
    swipeOffset: 0,
    isSwiping: false,
    setSwipeEnabled: vi.fn(),
    resetSwipeState: vi.fn(),
  }),
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
vi.mock('@/components/QueuePanel', () => ({ QueuePanel: () => null }));
vi.mock('@/components/ImageViewer', () => ({ ImageViewer: () => null }));
vi.mock('@/components/OutputsPanel', () => ({ OutputsPanel: () => null }));

describe('App stable key repair effect', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    workflowState.followQueue = false;
    workflowState.workflowLoadedAt = 0;
    workflowState.setFollowQueue.mockReset();
    workflowState.setNodeTypes.mockReset();
    workflowState.ensureStableKeysAndRepair.mockReset();
    queueState.fetchQueue.mockReset();
    outputsState.navigateUp.mockReset();
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

  it('invokes ensureStableKeysAndRepair when workflowLoadedAt changes to a loaded value', async () => {
    await act(async () => {
      root.render(<App />);
    });
    expect(workflowState.ensureStableKeysAndRepair).not.toHaveBeenCalled();

    workflowState.workflowLoadedAt = Date.now();
    await act(async () => {
      root.render(<App />);
    });
    expect(workflowState.ensureStableKeysAndRepair).toHaveBeenCalledTimes(1);
  });
});
