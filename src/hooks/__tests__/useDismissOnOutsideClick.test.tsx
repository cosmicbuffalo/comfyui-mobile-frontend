import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { useNavigationStore } from '@/hooks/useNavigation';
import { markProgrammaticScroll } from '@/utils/scrollInterrupt';

function Harness({ onDismiss }: { onDismiss: () => void }) {
  const [open] = useState(true);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useDismissOnOutsideClick({ open, onDismiss, triggerRef, contentRef });
  return (
    <>
      <button type="button" ref={triggerRef}>trigger</button>
      <div ref={contentRef}>menu</div>
      <div data-testid="elsewhere">elsewhere</div>
    </>
  );
}

describe('useDismissOnOutsideClick', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = async (onDismiss: () => void) => {
    await act(async () => {
      root.render(<Harness onDismiss={onDismiss} />);
    });
  };

  it('ignores a scroll that lands in the same breath as opening', async () => {
    // The open can provoke its own scroll — the browser bringing the trigger
    // into view, or momentum still settling. Dismissing on that makes the menu
    // flash and vanish, which reads as a swallowed tap.
    const onDismiss = vi.fn();
    await render(onDismiss);

    await act(async () => {
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('still dismisses on a deliberate scroll once the grace window has passed', async () => {
    const onDismiss = vi.fn();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);
    await render(onDismiss);

    now.mockReturnValue(1000);
    await act(async () => {
      // The gesture, then the scroll it caused. Both are needed: the wheel is
      // what marks this as the user's own doing.
      window.dispatchEvent(new Event('wheel'));
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('survives momentum from the fling the opening tap interrupted', async () => {
    // The case the grace window alone could never cover: a fling keeps firing
    // `scroll` for seconds after the finger has left the glass, so a menu
    // opened mid-coast was killed by the first momentum frame past the grace.
    // The gesture happened BEFORE the open, so it is not a dismissal.
    const onDismiss = vi.fn();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);
    window.dispatchEvent(new Event('touchmove'));

    now.mockReturnValue(100);
    await render(onDismiss);

    now.mockReturnValue(1200);
    await act(async () => {
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('ignores the scroll the app performs to steady a list under it', async () => {
    // The queue panel compensates for an arriving image by writing scrollTop,
    // which nobody asked for. The gesture test alone cannot cover this: a
    // finger resting or drifting over the open menu marks a touchmove, and the
    // next compensation pass would then read as a dismissal. Only the code
    // doing the scrolling knows, so it says so.
    const onDismiss = vi.fn();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);
    await render(onDismiss);

    now.mockReturnValue(1000);
    window.dispatchEvent(new Event('touchmove'));
    await act(async () => {
      markProgrammaticScroll();
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(onDismiss).not.toHaveBeenCalled();

    // A ceiling, not a lock: the gesture already made still dismisses once the
    // app's own scroll has settled.
    now.mockReturnValue(1000 + 500);
    await act(async () => {
      document.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses immediately on a click outside, with no grace at all', async () => {
    // A tap elsewhere is deliberate in a way a scroll is not.
    const onDismiss = vi.fn();
    await render(onDismiss);

    await act(async () => {
      container
        .querySelector('[data-testid="elsewhere"]')
        ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('leaves a click on the trigger or inside the menu alone', async () => {
    const onDismiss = vi.fn();
    await render(onDismiss);

    await act(async () => {
      container.querySelector('button')?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('a menu belongs to the panel it was opened on', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useNavigationStore.getState().setCurrentPanel('workflow');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useNavigationStore.getState().setCurrentPanel('workflow');
  });

  const render = async (onDismiss: () => void) => {
    await act(async () => {
      root.render(<Harness onDismiss={onDismiss} />);
    });
  };

  it('closes when the panel changes under it', async () => {
    // Panels stay mounted as you swipe between them, so an open menu used to
    // ride along and sit over the outputs with nothing beneath it to act on.
    const onDismiss = vi.fn();
    await render(onDismiss);
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      useNavigationStore.getState().setCurrentPanel('outputs');
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stays open while the panel does not change', async () => {
    const onDismiss = vi.fn();
    await render(onDismiss);
    await act(async () => {
      useNavigationStore.getState().setCurrentPanel('workflow');
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    // These menus are built from ContextMenuBuilder, which never handled the
    // key: a tap outside or a scroll were the only ways out.
    const onDismiss = vi.fn();
    await render(onDismiss);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
