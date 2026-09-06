import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connectionState: { isConnected: false, hasEverConnected: true },
  liveProgressState: {
    snapshot: null as null | Record<string, unknown>,
    isConnected: true,
    hasEverConnected: true,
  },
  overallProgress: 37 as number | null,
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    workflow: null,
    isExecuting: true,
    progress: 24,
    executingNodeId: null,
    executingNodePath: null,
    executingPromptId: 'prompt-1',
    workflowDurationStats: {},
    scrollToNode: vi.fn(),
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
    nodeErrors: {},
    nodeErrorsFromRun: false,
    errorsDismissed: false,
    setErrorsDismissed: vi.fn(),
    errorCycleIndex: 0,
    setErrorCycleIndex: vi.fn(),
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
    selector({ running: [{ prompt_id: 'prompt-1' }] }),
}));

vi.mock('@/hooks/useOverallProgress', () => ({
  useOverallProgress: () => mocks.overallProgress,
}));

vi.mock('@/hooks/useConnectionStatus', () => ({
  useConnectionStatusStore: (selector: (state: typeof mocks.connectionState) => unknown) =>
    selector(mocks.connectionState),
}));

vi.mock('@/hooks/useLiveProgress', () => ({
  useLiveProgressStore: (
    selector: (state: typeof mocks.liveProgressState) => unknown,
  ) => selector(mocks.liveProgressState),
}));

import { BottomStatusOverlay } from '../BottomStatusOverlay';

describe('BottomStatusOverlay reconnecting progress state', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.connectionState.isConnected = false;
    mocks.connectionState.hasEverConnected = true;
    mocks.overallProgress = 37;
    mocks.liveProgressState.snapshot = null;
    mocks.liveProgressState.isConnected = true;
    mocks.liveProgressState.hasEverConnected = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  // The overlay portals to document.body (a passive status layer must rank
  // below body-level popovers, see the component), so queries go through
  // `document` — the render container stays empty.

  it('replaces stale progress bars with a reconnecting spinner after losing the backend', () => {
    act(() => root.render(<BottomStatusOverlay />));

    const reconnecting = document.querySelector('.progress-reconnecting');
    expect(reconnecting?.textContent).toContain('Reconnecting');
    expect(reconnecting?.getAttribute('role')).toBe('status');
    expect(reconnecting?.querySelector('.animate-spin')).not.toBeNull();
    expect(document.querySelector('.node-progress-track')).toBeNull();
    expect(document.querySelector('.overall-progress-track')).toBeNull();

    mocks.connectionState.isConnected = true;
    act(() => root.render(<BottomStatusOverlay />));

    expect(document.querySelector('.progress-reconnecting')).toBeNull();
    expect(document.querySelector('.node-progress-track')).not.toBeNull();
    expect(document.querySelector('.overall-progress-track')).not.toBeNull();
  });

  it('shows reconnecting even when the estimate had not emitted its first value', () => {
    mocks.overallProgress = null;

    act(() => root.render(<BottomStatusOverlay />));

    expect(document.querySelector('#execution-progress-card')).not.toBeNull();
    expect(document.querySelector('.progress-reconnecting')?.textContent).toContain(
      'Reconnecting',
    );
  });

  it('shows backend node position, name, and per-node progress together', () => {
    mocks.connectionState.isConnected = true;
    mocks.overallProgress = 45;
    mocks.liveProgressState.snapshot = {
      promptId: 'prompt-1',
      nodesDone: 4,
      nodesTotal: 10,
      nodeName: 'KSampler',
      nodeIndex: 5,
      nodeProgressPercent: 50,
      overallProgressPercent: 45,
      finished: false,
    };

    act(() => root.render(<BottomStatusOverlay />));

    expect(document.querySelector('.executing-node-name')?.textContent).toContain(
      '5/10KSampler',
    );
    expect(document.querySelector('.node-progress-percent')?.textContent).toBe('50%');
    expect(document.querySelector('.overall-progress-info')?.textContent).toContain('45%');
  });

  it('uses an indeterminate state if only the dedicated progress stream drops', () => {
    mocks.connectionState.isConnected = true;
    mocks.liveProgressState.isConnected = false;

    act(() => root.render(<BottomStatusOverlay />));

    expect(document.querySelector('.progress-stream-unavailable')).not.toBeNull();
    expect(document.querySelector('.node-progress-track')).toBeNull();
    expect(document.querySelector('.overall-progress-track')).toBeNull();
  });
});
