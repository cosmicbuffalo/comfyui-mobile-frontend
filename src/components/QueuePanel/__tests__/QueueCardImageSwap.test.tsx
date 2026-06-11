import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedItem } from '../types';

const mocks = vi.hoisted(() => ({
  queueState: {
    previewVisibility: {},
    previewVisibilityDefault: true,
    showQueueMetadata: false,
    showQueueTimestamps: false,
    showPromptPreview: false,
    queueItemExpanded: { 'swap-prompt': true },
    queueItemUserToggled: {},
    queueItemHideImages: {},
    completionDurations: {},
    completing: [],
    autoRestoredPromptIds: {},
    queueMetadata: {},
    setQueueItemExpanded: vi.fn(),
    setQueueItemUserToggled: vi.fn(),
  },
  outputsState: {
    favorites: [],
  },
  workflowState: {
    promptToSession: {},
    sessions: [],
    activeSessionId: null,
    parkedSessions: {},
    currentFilename: null,
    workflowSource: null,
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

const imageA = { filename: 'a.png', subfolder: 'images', type: 'output' };
const imageB = { filename: 'b.png', subfolder: 'images', type: 'output' };

const doneItem: UnifiedItem = {
  id: 'swap-prompt',
  status: 'done',
  data: {
    prompt_id: 'swap-prompt',
    timestamp: 1,
    outputs: { images: [imageA, imageB] },
    prompt: {},
  },
};

describe('QueueCard image-slot tab swap', () => {
  let container: HTMLDivElement;
  let root: Root;
  const preloads: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    preloads.length = 0;
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
      complete = false;
      naturalWidth = 0;
      constructor() {
        preloads.push(this);
      }
      decode() {
        return Promise.resolve();
      }
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it('holds the current image (with a spinner) until the selected one preloads, then swaps', async () => {
    await act(async () => {
      root.render(
        <QueueCard
          item={doneItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          downloaded={{}}
          isTopDoneItem
        />,
      );
    });

    // Auto-selects the newest output (b.png); two tabs are present.
    const tabs = Array.from(container.querySelectorAll('.queue-media-tabs button'));
    expect(tabs).toHaveLength(2);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('b.png');

    // Select the other image: the slot keeps showing b.png with a spinner while
    // a.png preloads in the background — no collapse to empty.
    await act(async () => {
      (tabs[0] as HTMLButtonElement).click();
    });
    expect(container.querySelector('img')?.getAttribute('src')).toContain('b.png');
    expect(container.querySelector('.animate-spin')).not.toBeNull();

    // Once the preload resolves, the slot swaps to a.png and the spinner clears.
    await act(async () => {
      preloads.at(-1)?.onload?.();
    });
    expect(container.querySelector('img')?.getAttribute('src')).toContain('a.png');
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});
