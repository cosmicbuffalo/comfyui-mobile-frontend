import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueuePanel } from '@/components/QueuePanel';
import { useHistoryStore } from '@/hooks/useHistory';
import { useNavigationStore } from '@/hooks/useNavigation';

// Exercise the ?prompt_id=<id> push-notification deep link end-to-end at the
// component level: the panel must switch navigation to the queue, strip the
// param from the URL, and — once the prompt's history entry is present — open
// the viewer (via onImageClick) at that prompt's first image. Errored prompts
// (no outputs) must NOT open the viewer.

const emptyJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function makeHistoryEntry(promptId: string, withOutputs: boolean) {
  return {
    prompt_id: promptId,
    timestamp: 100,
    outputs: withOutputs
      ? { images: [{ filename: `${promptId}.png`, subfolder: '', type: 'output' }] }
      : { images: [] },
    prompt: {},
    success: withOutputs,
  };
}

describe('QueuePanel prompt_id deep link', () => {
  let container: HTMLDivElement;
  let root: Root;
  let serviceWorkerMessages: EventTarget;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    serviceWorkerMessages = new EventTarget();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: serviceWorkerMessages.addEventListener.bind(serviceWorkerMessages),
        removeEventListener: serviceWorkerMessages.removeEventListener.bind(serviceWorkerMessages),
      },
    });
    // Backend endpoints the panel touches on mount (queue + history + metadata).
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/queue')) {
        return emptyJson({ queue_running: [], queue_pending: [] });
      }
      return emptyJson({});
    }));
    useHistoryStore.setState({ history: [] });
    useNavigationStore.setState({ currentPanel: 'workflow' });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.history.replaceState({}, '', '/');
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('keeps loading and retries when the initial history request is canceled', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let historyAttempts = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/history')) {
        historyAttempts += 1;
        if (historyAttempts === 1) throw new TypeError('Load failed');
        return emptyJson({});
      }
      if (url.includes('/queue')) {
        return emptyJson({ queue_running: [], queue_pending: [] });
      }
      return emptyJson({});
    }));

    await act(async () => {
      root.render(<QueuePanel visible />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Loading...');
    expect(container.textContent).not.toContain('Queue is empty');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(historyAttempts).toBe(2);
    expect(container.textContent).toContain('Queue is empty');
    errorSpy.mockRestore();
  });

  it('waits for the first completed card media before revealing the next card', async () => {
    const rawHistory = Object.fromEntries(['newer', 'older'].map((promptId, index) => [
      promptId,
      {
        prompt: [1, promptId, {}, {}, []],
        outputs: {
          '9': {
            images: [{ filename: `${promptId}.png`, subfolder: '', type: 'output' }],
          },
        },
        status: {
          status_str: 'success',
          completed: true,
          messages: [
            ['execution_start', { timestamp: 200 - index * 100 }],
            ['execution_success', { timestamp: 250 - index * 100 }],
          ],
        },
      },
    ]));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/history')) return emptyJson(rawHistory);
      if (url.includes('/queue')) {
        return emptyJson({ queue_running: [], queue_pending: [] });
      }
      return emptyJson({});
    }));

    await act(async () => {
      root.render(<QueuePanel visible />);
      await Promise.resolve();
    });

    expect(container.querySelectorAll('[data-queue-item-id]')).toHaveLength(1);
    const firstImage = container.querySelector<HTMLImageElement>('img[alt="Generation"]');
    expect(firstImage).not.toBeNull();

    await act(async () => {
      firstImage?.dispatchEvent(new Event('load'));
      await Promise.resolve();
    });

    expect(container.querySelectorAll('[data-queue-item-id]')).toHaveLength(2);
  });

  it('opens the viewer on the deep-linked prompt outputs and strips the param', async () => {
    window.history.replaceState({}, '', '/?prompt_id=notified');
    // Newer unrelated entry first: the deep-linked prompt must be found by id,
    // not by position.
    useHistoryStore.setState({
      history: [
        { ...makeHistoryEntry('other', true), timestamp: 200 },
        makeHistoryEntry('notified', true),
      ] as never,
    });
    const onImageClick = vi.fn();

    await act(async () => {
      root.render(<QueuePanel visible onImageClick={onImageClick} />);
    });

    // Param consumed so a manual reload doesn't replay the deep link.
    expect(window.location.search).not.toContain('prompt_id');
    // Navigation forced to the queue panel.
    expect(useNavigationStore.getState().currentPanel).toBe('queue');

    expect(onImageClick).toHaveBeenCalledTimes(1);
    const [images, index, enableFollowQueue] = onImageClick.mock.calls[0];
    expect(images[index].promptId).toBe('notified');
    // 'other' is newer, so 'notified' is not the top done item.
    expect(enableFollowQueue).toBe(false);
  });

  it('fetches history for a prompt that was not in the loaded window', async () => {
    // The real notification-click path: the app was on another panel when the
    // run finished, so its history poll (gated on `visible`) never fetched it.
    // The panel's initial load must be COMPLETE and the prompt absent at
    // dispatch — that is the state in which the old code concluded, from its own
    // load flag, that the prompt would never arrive and dropped the deep link.
    const onImageClick = vi.fn();
    const fetchHistory = vi
      .spyOn(useHistoryStore.getState(), 'fetchHistory')
      .mockResolvedValue(true);

    await act(async () => {
      root.render(<QueuePanel visible onImageClick={onImageClick} />);
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });
    fetchHistory.mockClear();

    // Only now does the run land server-side.
    fetchHistory.mockImplementation(async () => {
      useHistoryStore.setState({
        history: [makeHistoryEntry('late-arrival', true)] as never,
      });
      return true;
    });

    await act(async () => {
      serviceWorkerMessages.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'mobile-notification-click',
          url: `${window.location.origin}/mobile/?prompt_id=late-arrival`,
        },
      }));
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });

    expect(fetchHistory).toHaveBeenCalled();
    expect(onImageClick).toHaveBeenCalledTimes(1);
    expect(onImageClick.mock.calls[0][0][onImageClick.mock.calls[0][1]].promptId)
      .toBe('late-arrival');
  });

  it('re-arms for a second tap on the same notification', async () => {
    // The first tap gives up (the run has aged out of history). Tapping the same
    // still-present notification again must try again rather than silently
    // doing nothing for the rest of the session.
    const onImageClick = vi.fn();
    const fetchHistory = vi
      .spyOn(useHistoryStore.getState(), 'fetchHistory')
      .mockResolvedValue(true);

    await act(async () => {
      root.render(<QueuePanel visible onImageClick={onImageClick} />);
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });

    const tap = async () => {
      await act(async () => {
        serviceWorkerMessages.dispatchEvent(new MessageEvent('message', {
          data: {
            type: 'mobile-notification-click',
            url: `${window.location.origin}/mobile/?prompt_id=twice`,
          },
        }));
        await Promise.resolve();
      });
      await act(async () => { await Promise.resolve(); });
    };

    await tap();
    fetchHistory.mockClear();

    // Second tap: this time the run is there.
    fetchHistory.mockImplementation(async () => {
      useHistoryStore.setState({ history: [makeHistoryEntry('twice', true)] as never });
      return true;
    });
    await tap();

    expect(fetchHistory).toHaveBeenCalled();
    expect(onImageClick).toHaveBeenCalledTimes(1);
  });

  it('gives up when the fetch comes back without the prompt', async () => {
    // Cleared history, or a notification from another server: stop waiting
    // rather than leaving the deep link armed forever.
    const onImageClick = vi.fn();
    vi.spyOn(useHistoryStore.getState(), 'fetchHistory').mockResolvedValue(true);

    await act(async () => {
      root.render(<QueuePanel visible onImageClick={onImageClick} />);
      await Promise.resolve();
    });
    await act(async () => {
      serviceWorkerMessages.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'mobile-notification-click',
          url: `${window.location.origin}/mobile/?prompt_id=never-existed`,
        },
      }));
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });

    expect(onImageClick).not.toHaveBeenCalled();
  });

  it('handles a notification deep link posted to an already-open app window', async () => {
    const onImageClick = vi.fn();
    await act(async () => {
      root.render(<QueuePanel visible onImageClick={onImageClick} />);
      await Promise.resolve();
    });

    await act(async () => {
      useHistoryStore.setState({
        history: [makeHistoryEntry('posted-notification', true)] as never,
      });
      serviceWorkerMessages.dispatchEvent(new MessageEvent('message', {
        data: {
          type: 'mobile-notification-click',
          url: `${window.location.origin}/mobile/?prompt_id=posted-notification`,
        },
      }));
    });

    expect(useNavigationStore.getState().currentPanel).toBe('queue');
    expect(onImageClick).toHaveBeenCalledTimes(1);
    const [images, index] = onImageClick.mock.calls[0];
    expect(images[index].promptId).toBe('posted-notification');
  });

  it('falls back to just the queue panel when the prompt has no outputs', async () => {
    window.history.replaceState({}, '', '/?prompt_id=errored');
    useHistoryStore.setState({
      history: [makeHistoryEntry('errored', false)] as never,
    });
    const onImageClick = vi.fn();

    await act(async () => {
      root.render(<QueuePanel visible onImageClick={onImageClick} />);
    });

    expect(useNavigationStore.getState().currentPanel).toBe('queue');
    expect(onImageClick).not.toHaveBeenCalled();
  });

  it('does nothing without the query param', async () => {
    useHistoryStore.setState({
      history: [makeHistoryEntry('plain', true)] as never,
    });
    const onImageClick = vi.fn();

    await act(async () => {
      root.render(<QueuePanel visible onImageClick={onImageClick} />);
    });

    expect(useNavigationStore.getState().currentPanel).toBe('workflow');
    expect(onImageClick).not.toHaveBeenCalled();
  });
});
