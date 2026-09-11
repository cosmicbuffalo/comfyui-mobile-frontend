import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerImage } from '@/utils/viewerImages';
import type { UnifiedItem } from '../types';

const mocks = vi.hoisted(() => ({
  queueState: {
    previewVisibility: {},
    previewVisibilityDefault: true,
    showQueueMetadata: false,
    showQueueTimestamps: false,
    showPromptPreview: false,
    queueOutputLayout: 'tabbed' as const,
    queueItemExpanded: { 'live-prompt': true },
    queueItemUserToggled: { 'live-prompt': true },
    queueItemHideImages: {},
    completionDurations: {},
    completing: [],
    autoRestoredPromptIds: {},
    queueMetadata: {},
    workflowDiffs: {},
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

const runningImage = { filename: 'live_00001_.png', subfolder: '', type: 'temp' };

const item: UnifiedItem = {
  id: 'live-prompt',
  status: 'running',
  data: {
    number: 1,
    prompt_id: 'live-prompt',
    prompt: { '3': { class_type: 'KSampler', inputs: { seed: 12345 } } },
    extra: {},
    outputs_to_execute: [],
  },
};

/**
 * A card opens the viewer on its OWN media list whenever the panel-wide list
 * can't resolve the click — always while the run is still going. That list used
 * to carry only a URL, and everything the viewer keys off `file` (its title,
 * favourite, reject, download) silently died: the header read "Generation" and
 * the buttons did nothing.
 */
describe('QueueCard viewer identity', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('opens the viewer with a file the favourite and reject controls can act on', async () => {
    const onImageClick = vi.fn();

    await act(async () => {
      root.render(
        <QueueCard
          item={item}
          isActuallyRunning
          progress={50}
          viewerImages={[]}
          runningImages={[runningImage]}
          onOpenMenu={() => {}}
          onImageClick={onImageClick}
          isTopDoneItem={false}
        />,
      );
    });

    const img = [...container.querySelectorAll('img')].find((candidate) =>
      candidate.getAttribute('src')?.includes(runningImage.filename),
    );
    expect(img).toBeDefined();

    await act(async () => {
      img!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onImageClick).toHaveBeenCalled();
    const [images, index] = onImageClick.mock.calls[0] as [ViewerImage[], number];
    const opened = images[index];
    expect(opened.filename).toBe(runningImage.filename);
    // The viewer titles by filename and gates favourite/reject/download on file.
    expect(opened.file?.id).toBe('temp/live_00001_.png');
    expect(opened.file?.type).toBe('image');
    expect(opened.promptId).toBe('live-prompt');
  });
});

/**
 * A phone never hovers, so a control that only appears on `:hover` is a control
 * that does not exist there. Favourite and reject were hover-only on the queue
 * card, which left the queue — the surface where generations are actually
 * triaged — with no way to mark one without opening the viewer first.
 */
describe('QueueCard favourite/reject reachability', () => {
  let container: HTMLDivElement;
  let root: Root;

  const doneItem: UnifiedItem = {
    id: 'done-prompt',
    status: 'done',
    data: {
      prompt_id: 'done-prompt',
      timestamp: 1,
      outputs: { images: [{ filename: 'out_00001_.png', subfolder: '', type: 'output' }] },
      prompt: {},
    },
  } as unknown as UnifiedItem;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('leaves the controls visible and tappable without a hover, up to the desktop breakpoint', async () => {
    await act(async () => {
      root.render(
        <QueueCard
          item={doneItem}
          isActuallyRunning={false}
          progress={100}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          onImageClick={() => {}}
          isTopDoneItem
        />,
      );
    });

    const favourite = container.querySelector('.favorite-badge-container');
    const reject = container.querySelector('.rejected-badge-container');
    expect(favourite).toBeTruthy();
    expect(reject).toBeTruthy();
    for (const el of [favourite!, reject!]) {
      // Visible and hit-testable as rendered...
      expect(el.className).toContain('opacity-100');
      expect(el.className).toContain('pointer-events-auto');
      // ...and handed back to hover only where a pointer can hover.
      expect(el.className).toContain('lg:opacity-0');
      expect(el.className).toContain('lg:group-hover:opacity-100');
    }
  });
});
