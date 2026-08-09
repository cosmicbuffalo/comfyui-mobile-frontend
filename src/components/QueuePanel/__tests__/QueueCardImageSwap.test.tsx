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
    favorites: [] as string[],
    rejected: [] as string[],
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
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    preloads.length = 0;
    mocks.outputsState.favorites = [];
    mocks.outputsState.rejected = [];
    mocks.outputsState.toggleFavorite.mockClear();
    mocks.outputsState.toggleRejected.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
    })));
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
    vi.useRealTimers();
  });

  // Drive the two-slot swap to completion: dispatch `load` on the back slot's
  // freshly-staged <img> (jsdom won't fire it on its own), then run the 200ms
  // promote timer that flips it to the front.
  const settleSwap = async (srcFragment: string) => {
    await act(async () => {
      const backImg = Array.from(container.querySelectorAll('img')).find((el) =>
        (el.getAttribute('src') ?? '').includes(srcFragment),
      );
      backImg?.dispatchEvent(new Event('load'));
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
  };

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
          isTopDoneItem
        />,
      );
    });

    // Auto-selects the newest output (b.png); two tabs are present.
    const tabs = Array.from(container.querySelectorAll('.queue-media-tabs button'));
    expect(tabs).toHaveLength(2);
    expect(container.querySelector('img')?.getAttribute('src')).toContain('b.png');

    // Slot images only (the tab bar has its own thumbnail <img>s).
    const slotSrcs = () =>
      Array.from(container.querySelectorAll('img'))
        .filter((el) => !el.closest('.queue-media-tabs'))
        .map((el) => el.getAttribute('src') ?? '');

    // Select the other image: the front slot keeps showing b.png while a.png
    // stages on the hidden back slot — no collapse to empty.
    await act(async () => {
      (tabs[0] as HTMLButtonElement).click();
    });
    // The HTTP preload resolves, mounting a.png on the back slot (still hidden).
    await act(async () => {
      preloads.at(-1)?.onload?.();
    });
    // Both are mounted (previous held on front, next staged on back) and the
    // swap-in-progress spinner is showing.
    expect(slotSrcs().some((s) => s.includes('b.png'))).toBe(true);
    expect(slotSrcs().some((s) => s.includes('a.png'))).toBe(true);
    const swapOverlay = container.querySelector('.queue-media-swap-spinner');
    expect(swapOverlay).not.toBeNull();
    expect(swapOverlay?.className).toContain('inset-0');
    expect(swapOverlay?.className).toContain('items-center');
    expect(swapOverlay?.className).toContain('justify-center');
    expect(swapOverlay?.querySelector('.animate-spin')?.className).toContain('h-[72px]');
    expect(swapOverlay?.querySelector('.animate-spin')?.className).toContain('w-[72px]');

    // The back slot's <img> finishes loading and the promote timer fires: the
    // slot swaps to a.png (b.png unmounts) and the spinner clears.
    await settleSwap('a.png');
    expect(slotSrcs()).toHaveLength(1);
    expect(slotSrcs()[0]).toContain('a.png');
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('keeps both hover actions available after an output is favorited', async () => {
    mocks.outputsState.favorites = ['output/images/b.png'];
    await act(async () => {
      root.render(
        <QueueCard
          item={doneItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem
        />,
      );
    });

    const favoriteAction = container.querySelector('.favorite-badge-container');
    const rejectAction = container.querySelector('.rejected-badge-container');
    expect(favoriteAction?.className).toContain('group-hover:opacity-100');
    expect(rejectAction?.className).toContain('group-hover:opacity-100');
    expect(container.querySelector('.favorite-state-indicator')).not.toBeNull();

    await act(async () => {
      favoriteAction?.querySelector('button')?.click();
    });
    expect(mocks.outputsState.toggleFavorite).not.toHaveBeenCalled();

    await act(async () => {
      rejectAction?.querySelector('button')?.click();
    });
    expect(mocks.outputsState.toggleFavorite).toHaveBeenCalledWith('output/images/b.png');
    expect(mocks.outputsState.toggleRejected).not.toHaveBeenCalled();
  });

  it('shows a temp-only comparer filename and its favorite/reject controls', async () => {
    const comparerItem: UnifiedItem = {
      ...doneItem,
      data: {
        ...doneItem.data,
        outputs: {
          images: [{ filename: 'comfy.compare.a_00001_.png', subfolder: '', type: 'temp' }],
        },
      },
    };

    await act(async () => {
      root.render(
        <QueueCard
          item={comparerItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem
        />,
      );
    });

    expect(container.textContent).toContain('comfy.compare.a_00001_.png');
    expect(container.querySelector('.favorite-badge-container')).not.toBeNull();
    expect(container.querySelector('.rejected-badge-container')).not.toBeNull();
  });

  it('does not show persistent actions for a temporary preview while running', async () => {
    const runningItem: UnifiedItem = {
      id: 'swap-prompt',
      status: 'running',
      data: {
        number: 1,
        prompt_id: 'swap-prompt',
        prompt: {},
        extra: {},
        outputs_to_execute: [],
      },
    };

    await act(async () => {
      root.render(
        <QueueCard
          item={runningItem}
          isActuallyRunning
          progress={50}
          viewerImages={[]}
          runningImages={[{ filename: 'live-preview.png', subfolder: '', type: 'temp' }]}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });

    expect(container.querySelector('.favorite-badge-container')).toBeNull();
    expect(container.querySelector('.rejected-badge-container')).toBeNull();
  });

  const renderCard = async () => {
    await act(async () => {
      root.render(
        <QueueCard
          item={doneItem}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem
        />,
      );
    });
    return {
      tabs: Array.from(container.querySelectorAll('.queue-media-tabs button')) as HTMLButtonElement[],
      slotSrcs: () =>
        Array.from(container.querySelectorAll('img'))
          .filter((el) => !el.closest('.queue-media-tabs'))
          .map((el) => el.getAttribute('src') ?? ''),
      slotImg: (fragment: string) =>
        Array.from(container.querySelectorAll('img'))
          .filter((el) => !el.closest('.queue-media-tabs'))
          .find((el) => (el.getAttribute('src') ?? '').includes(fragment)),
    };
  };

  it('re-tapping the front tab during the promote grace never blanks the slot', async () => {
    const { tabs, slotSrcs, slotImg } = await renderCard();

    // Stage a.png on the back slot and fire its load, but stop INSIDE the
    // 200ms grace window.
    await act(async () => {
      tabs[0].click();
    });
    await act(async () => {
      preloads.at(-1)?.onload?.();
    });
    await act(async () => {
      slotImg('a.png')?.dispatchEvent(new Event('load'));
    });

    // Snap back to the still-front b.png while the promote timer is pending.
    // This clears the staged back slot; the stale timer must NOT promote it.
    await act(async () => {
      tabs[1].click();
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    const srcs = slotSrcs();
    expect(srcs).toHaveLength(1);
    expect(srcs[0]).toContain('b.png');
  });

  it('a second tab tap during the grace window swaps to the LAST tap, not the first', async () => {
    const withThree: UnifiedItem = {
      ...doneItem,
      data: {
        ...doneItem.data,
        outputs: { images: [imageA, imageB, { filename: 'c.png', subfolder: 'images', type: 'output' }] },
      },
    };
    await act(async () => {
      root.render(
        <QueueCard
          item={withThree}
          isActuallyRunning={false}
          progress={0}
          viewerImages={[]}
          runningImages={[]}
          onOpenMenu={() => {}}
          isTopDoneItem
        />,
      );
    });
    const tabs = Array.from(container.querySelectorAll('.queue-media-tabs button')) as HTMLButtonElement[];
    const slotSrcs = () =>
      Array.from(container.querySelectorAll('img'))
        .filter((el) => !el.closest('.queue-media-tabs'))
        .map((el) => el.getAttribute('src') ?? '');
    const slotImg = (fragment: string) =>
      Array.from(container.querySelectorAll('img'))
        .filter((el) => !el.closest('.queue-media-tabs'))
        .find((el) => (el.getAttribute('src') ?? '').includes(fragment));

    // Tap a.png, let it stage + load, timer pending.
    await act(async () => {
      tabs[0].click();
    });
    await act(async () => {
      preloads.at(-1)?.onload?.();
    });
    await act(async () => {
      slotImg('a.png')?.dispatchEvent(new Event('load'));
    });

    // Within the grace window, tap b.png instead: it replaces the back stage.
    // a.png's stale timer must not promote b.png before it's ready.
    await act(async () => {
      tabs[1].click();
    });
    await act(async () => {
      preloads.at(-1)?.onload?.();
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    // Front is still the original c.png — b.png hasn't fired load yet.
    expect(slotSrcs().some((s) => s.includes('c.png'))).toBe(true);

    // b.png loads and ITS timer promotes it.
    await settleSwap('b.png');
    expect(slotSrcs()).toHaveLength(1);
    expect(slotSrcs()[0]).toContain('b.png');
  });

  it('retries a transient back-slot image error and completes the swap', async () => {
    const { tabs, slotImg } = await renderCard();

    await act(async () => {
      tabs[0].click();
    });
    await act(async () => {
      preloads.at(-1)?.onload?.();
    });
    // The staged <img> errors because its request was transiently canceled.
    await act(async () => {
      slotImg('a.png')?.dispatchEvent(new Event('error'));
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(slotImg('a.png')?.getAttribute('src')).toContain('mobile_retry=1');
    expect(container.querySelector('.queue-media-unavailable')).toBeNull();

    // The retry succeeds; the normal promotion path settles the swap.
    await act(async () => {
      slotImg('a.png')?.dispatchEvent(new Event('load'));
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.querySelector('.queue-media-unavailable')).toBeNull();
  });

  it('shows unavailable only after preview retries and the original fallback fail', async () => {
    const { tabs, slotImg } = await renderCard();

    await act(async () => {
      tabs[0].click();
    });
    await act(async () => {
      preloads.at(-1)?.onload?.();
    });

    const failCurrentImage = async (delay: number) => {
      await act(async () => {
        slotImg('a.png')?.dispatchEvent(new Event('error'));
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay);
      });
    };

    await failCurrentImage(300);
    expect(slotImg('a.png')?.getAttribute('src')).toContain('mobile_retry=1');
    await failCurrentImage(900);
    expect(slotImg('a.png')?.getAttribute('src')).toContain('mobile_retry=2');
    await failCurrentImage(0);
    expect(slotImg('a.png')?.getAttribute('src')).toContain('mobile_retry=original');

    // The raw original also fails. Only now does the card settle as unavailable.
    await failCurrentImage(250);
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.querySelector('.queue-media-unavailable')).not.toBeNull();
  });
});
