import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppUpdateCheck } from '@/hooks/useAppUpdateCheck';

/**
 * The primary update trigger is visibilitychange — but a tab that never
 * backgrounds (a wall-mounted dashboard, a desktop that stays focused) never
 * fires it, and used to never learn of an update at all. A slow interval
 * backstops that tab; these tests drive it with fake timers.
 */

function Harness() {
  const { updateAvailable } = useAppUpdateCheck();
  return <div data-testid="update-state">{updateAvailable ? 'available' : 'none'}</div>;
}

describe('useAppUpdateCheck interval fallback', () => {
  let container: HTMLDivElement;
  let root: Root;
  let entryScript: HTMLScriptElement;
  let dialog: HTMLDivElement;

  const state = () =>
    container.querySelector('[data-testid="update-state"]')!.textContent;

  const render = () =>
    act(async () => {
      root.render(<Harness />);
    });

  beforeEach(() => {
    vi.useFakeTimers();
    // The build this tab runs, named by its entry-chunk script tag.
    entryScript = document.createElement('script');
    entryScript.setAttribute('src', '/mobile/assets/index-OldChunk1.js');
    document.head.appendChild(entryScript);
    // A dialog keeps canReloadSilently false, so a detected update surfaces
    // as the banner instead of a window.location.reload jsdom can't do.
    dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    sessionStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    entryScript.remove();
    dialog.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('learns of an update without ever backgrounding', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<script type="module" src="/mobile/assets/index-NewChunk2.js"></script>',
    })));
    await render();
    expect(state()).toBe('none');

    // Nothing before the interval elapses — the poll is deliberately slow.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(state()).toBe('none');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40 * 60_000);
    });
    expect(state()).toBe('available');
  });

  it('stays quiet when the server still runs this build', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<script type="module" src="/mobile/assets/index-OldChunk1.js"></script>',
    })));
    await render();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50 * 60_000);
    });
    expect(state()).toBe('none');
  });

  it('does not poll while the tab is hidden', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () =>
        '<script type="module" src="/mobile/assets/index-NewChunk2.js"></script>',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    try {
      await render();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50 * 60_000);
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(state()).toBe('none');
    } finally {
      visibility.mockRestore();
    }
  });
});
