import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedItem } from '../types';

const mocks = vi.hoisted(() => ({
  queueState: {
    previewVisibility: {},
    previewVisibilityDefault: false,
    showQueueMetadata: false,
    showQueueTimestamps: false,
    showPromptPreview: true,
    queueOutputLayout: 'tabbed' as const,
    queueItemExpanded: {} as Record<string, boolean>,
    queueItemUserToggled: {} as Record<string, boolean>,
    queueItemHideImages: {},
    completionDurations: {},
    completing: [],
    autoRestoredPromptIds: {},
    queueMetadata: {},
    workflowDiffs: {
      'active-prompt': {
        prompts: [{
          nodeId: '2',
          label: 'Positive prompt',
          order: 0,
          segments: [{ type: 'equal' as const, text: 'a bright red fox' }],
          changed: false,
        }],
        nodeChanges: [],
      },
    },
    setQueueItemExpanded: vi.fn(),
    setQueueItemUserToggled: vi.fn(),
  },
  outputsState: {
    favorites: [],
    rejected: [],
    toggleFavorite: vi.fn(),
    toggleRejected: vi.fn(),
  },
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

import { QueueCard } from '../QueueCard';

const prompt = {
  '1': {
    class_type: 'LoadImage',
    inputs: { image: 'references/source image.png' },
  },
};

function makeItem(status: 'pending' | 'running'): UnifiedItem {
  return {
    id: 'active-prompt',
    status,
    data: {
      number: 1,
      prompt_id: 'active-prompt',
      prompt,
      extra: {},
      outputs_to_execute: [],
    },
  };
}

describe('QueueCard active prompt preview', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.queueState.showPromptPreview = true;
    mocks.queueState.queueItemExpanded = {};
    mocks.queueState.queueItemUserToggled = {};
    mocks.queueState.setQueueItemExpanded.mockClear();
    mocks.queueState.setQueueItemUserToggled.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it.each(['pending', 'running'] as const)(
    'defaults a new %s item open so its prompt preview is visible',
    async (status) => {
      await act(async () => {
        root.render(
          <QueueCard
            item={makeItem(status)}
            isActuallyRunning={status === 'running'}
            progress={0}
            viewerImages={[]}
            runningImages={[]}
            onOpenMenu={() => {}}
            isTopDoneItem={false}
          />,
        );
      });

      expect(mocks.queueState.setQueueItemExpanded).toHaveBeenCalledWith(
        'active-prompt',
        true,
      );
    },
  );

  it('keeps the compact default when prompt previews are disabled', async () => {
    mocks.queueState.showPromptPreview = false;
    await act(async () => {
      root.render(
        <QueueCard
          item={makeItem('pending')}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });

    expect(mocks.queueState.setQueueItemExpanded).toHaveBeenCalledWith(
      'active-prompt',
      false,
    );
  });

  it('preserves an explicit collapsed state when prompt previews are enabled', async () => {
    mocks.queueState.queueItemExpanded = { 'active-prompt': false };
    mocks.queueState.queueItemUserToggled = { 'active-prompt': true };
    await act(async () => {
      root.render(
        <QueueCard
          item={makeItem('pending')}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });

    expect(mocks.queueState.setQueueItemExpanded).not.toHaveBeenCalled();
  });

  it('opens an automatically compact pending item when prompt previews turn on', async () => {
    mocks.queueState.showPromptPreview = false;
    mocks.queueState.queueItemExpanded = { 'active-prompt': false };
    const item = makeItem('pending');

    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });
    expect(mocks.queueState.setQueueItemExpanded).not.toHaveBeenCalled();

    mocks.queueState.showPromptPreview = true;
    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });

    expect(mocks.queueState.setQueueItemExpanded).toHaveBeenCalledWith(
      'active-prompt',
      true,
    );
  });

  it.each(['pending', 'running'] as const)(
    'shows prompt text and queued input images for an expanded %s item',
    async (status) => {
      mocks.queueState.queueItemExpanded = { 'active-prompt': true };
      await act(async () => {
        root.render(
          <QueueCard
            item={makeItem(status)}
            isActuallyRunning={status === 'running'}
            progress={0}
            viewerImages={[]}
            runningImages={[]}
            onOpenMenu={() => {}}
            isTopDoneItem={false}
          />,
        );
      });

      const promptPreviewButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('提示词预览'),
      );
      expect(promptPreviewButton).toBeDefined();

      await act(async () => {
        promptPreviewButton?.click();
      });

      expect(container.textContent).toContain('a bright red fox');
      expect(container.querySelector<HTMLImageElement>('img[alt="输入图片"]')
        ?.getAttribute('src')).toBe(
        '/mobile/api/preview?filename=source%20image.png&subfolder=references&type=input&maxedge=1280',
      );
    },
  );
});
