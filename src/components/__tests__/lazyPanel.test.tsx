import { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lazyPanel } from '../lazyPanel';

/**
 * A panel whose chunk is gone must degrade to a reload prompt, not to a blank
 * app.
 *
 * Panels are code-split into content-hashed chunks, so updating the node
 * replaces every one of them. A tab that was open across the update holds an
 * index naming files that no longer exist, and nothing goes wrong until it
 * opens a panel it had not loaded yet: the import 404s, and an unhandled
 * rejection out of `lazy` takes down the whole app rather than the one panel.
 */
describe('lazyPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = async (Panel: React.ComponentType) => {
    await act(async () => {
      root.render(
        <Suspense fallback={<div data-testid="loading" />}>
          <Panel />
        </Suspense>,
      );
    });
  };

  it('renders the panel when its chunk loads', async () => {
    const Panel = lazyPanel(async () => ({
      default: () => <div className="real-panel">panel</div>,
    }));
    await render(Panel);
    expect(container.querySelector('.real-panel')).toBeTruthy();
    expect(container.querySelector('.stale-build-notice')).toBeNull();
  });

  it('retries once before giving up, for a merely flaky fetch', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValueOnce({ default: () => <div className="real-panel">panel</div> });
    const Panel = lazyPanel(load);
    await render(Panel);

    expect(load).toHaveBeenCalledTimes(2);
    // A phone changing cell is not a reason to tell someone their app is stale.
    expect(container.querySelector('.real-panel')).toBeTruthy();
    expect(container.querySelector('.stale-build-notice')).toBeNull();
  });

  it('offers a reload when the chunk is gone for good', async () => {
    const load = vi.fn().mockRejectedValue(
      new TypeError('Failed to fetch dynamically imported module'),
    );
    const Panel = lazyPanel(load);
    await render(Panel);

    expect(load).toHaveBeenCalledTimes(2);
    const notice = container.querySelector('.stale-build-notice');
    expect(notice, 'the panel degrades rather than throwing').toBeTruthy();
    expect(notice!.textContent).toContain('Reload');
  });

  it('hides the notice with the panel it stands in for', async () => {
    // Panels stay mounted behind the active one and draw nothing when their
    // `visible` prop is false; the notice inherits that prop and has to honor
    // it, or its absolute overlay sits on top of every other panel after
    // navigating away from the one that failed.
    const Panel = lazyPanel<React.ComponentType<{ visible: boolean }>>(
      vi.fn().mockRejectedValue(new Error('gone')),
    );
    await act(async () => {
      root.render(
        <Suspense fallback={<div data-testid="loading" />}>
          <Panel visible={false} />
        </Suspense>,
      );
    });
    expect(container.querySelector('.stale-build-notice')).toBeNull();

    await act(async () => {
      root.render(
        <Suspense fallback={<div data-testid="loading" />}>
          <Panel visible />
        </Suspense>,
      );
    });
    expect(container.querySelector('.stale-build-notice')).toBeTruthy();
  });

  it('reloads the page from the notice', async () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });

    const Panel = lazyPanel(vi.fn().mockRejectedValue(new Error('gone')));
    await render(Panel);
    const button = container.querySelector<HTMLButtonElement>('.stale-build-reload');
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    expect(reload).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, 'location', { configurable: true, value: original });
  });
});
