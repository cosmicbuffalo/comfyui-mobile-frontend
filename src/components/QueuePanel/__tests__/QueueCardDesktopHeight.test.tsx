import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedItem } from '../types';

const mocks = vi.hoisted(() => ({
  isDesktop: true,
  queueState: {
    previewVisibility: {},
    previewVisibilityDefault: true,
    showQueueMetadata: false,
    showQueueTimestamps: false,
    showPromptPreview: false,
    queueItemExpanded: { 'run-1': true },
    queueItemUserToggled: {},
    queueItemHideImages: {},
    completionDurations: {},
    completing: [],
    autoRestoredPromptIds: {},
    queueMetadata: {},
    setQueueItemExpanded: vi.fn(),
    setQueueItemUserToggled: vi.fn(),
  },
  outputsState: { favorites: [] },
  workflowState: {
    promptToSession: {},
    sessions: [],
    activeSessionId: null,
    parkedSessions: {},
    currentFilename: null,
    workflowSource: null,
    latentPreviewByPrompt: {},
  },
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (state: typeof mocks.queueState) => unknown) =>
    selector(mocks.queueState),
}));

vi.mock('@/hooks/useOutputs', () => ({
  useOutputsStore: (selector: (state: typeof mocks.outputsState) => unknown) =>
    selector(mocks.outputsState),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (state: typeof mocks.workflowState) => unknown) =>
    selector(mocks.workflowState),
}));

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mocks.isDesktop,
  isDesktopViewport: () => mocks.isDesktop,
  DESKTOP_MIN_WIDTH: 1024,
}));

import { QueueCard } from '../QueueCard';

const runningItem: UnifiedItem = {
  id: 'run-1',
  status: 'running',
  data: {
    number: 1,
    prompt_id: 'run-1',
    prompt: {},
    extra: {},
    outputs_to_execute: [],
  },
};

// A tall portrait output at full card width is what used to run off the page.
const portraitPreview = [{ filename: 'tall.png', subfolder: '', type: 'temp' }];

describe('QueueCard media height on desktop', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.isDesktop = true;
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

  const render = () =>
    act(async () => {
      root.render(
        <QueueCard
          item={runningItem}
          isActuallyRunning
          progress={50}
          viewerImages={[]}
          runningImages={portraitPreview as never}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });

  it('caps the media at the one-page budget and contains it', async () => {
    await render();
    const media = container.querySelector('img');
    expect(media?.style.maxHeight).toBe('var(--queue-media-max-height)');
    // `contain` shrinks an oversized picture to fit rather than cropping it.
    expect(media?.style.objectFit).toBe('contain');
  });

  it('leaves mobile scrolling as it was', async () => {
    mocks.isDesktop = false;
    await render();
    const media = container.querySelector('img');
    expect(media?.style.maxHeight).toBe('');
    expect(media?.style.objectFit).toBe('');
  });
});
