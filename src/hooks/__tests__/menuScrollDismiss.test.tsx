import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { useQueueMenuDismiss } from '@/hooks/useQueueMenuDismiss';

interface Props { open: boolean; onDismiss: () => void }

function OutsideMenu({ open, onDismiss }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useDismissOnOutsideClick({
    open, onDismiss: () => onDismiss(), triggerRef, contentRef,
  });
  return <><button ref={triggerRef}>Open</button><div ref={contentRef}>Menu</div></>;
}

function QueueMenu({ open, onDismiss }: Props) {
  useQueueMenuDismiss(open, () => onDismiss(), 'test-queue-menu');
  return <div id="test-queue-menu">Menu</div>;
}

describe.each([OutsideMenu, QueueMenu])('%s scroll dismissal', (Menu) => {
  let container: HTMLDivElement;
  let root: Root;
  let time: number;
  const onDismiss = vi.fn();

  beforeEach(() => {
    time = 10_000;
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    onDismiss.mockClear();
    // Reset the shared input timestamp to before this menu opens.
    window.dispatchEvent(new Event('touchmove'));
    time += 100;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = async (open = true) => {
    await act(async () => root.render(<Menu open={open} onDismiss={onDismiss} />));
  };
  const scroll = async () => {
    await act(async () => document.dispatchEvent(new Event('scroll')));
  };

  it('survives uninterrupted momentum across rerenders, then closes on a new swipe', async () => {
    await render();
    time += 1000;
    await scroll();
    await render();
    await scroll();
    expect(onDismiss).not.toHaveBeenCalled();

    // A second swipe arrives while scroll frames from the old fling continue.
    time += 10;
    window.dispatchEvent(new Event('touchstart'));
    window.dispatchEvent(new Event('touchmove'));
    time += 1;
    // Queue/store updates recreate the inline dismissal callback before the
    // browser delivers the next scroll event.
    await render();
    await scroll();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not repeatedly restart the grace period during a new scroll', async () => {
    await render();
    time += 1000;
    await render();
    time += 10;
    window.dispatchEvent(new Event('touchmove'));
    await scroll();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('records a fresh opening after closing and reopening during momentum', async () => {
    await render();
    time += 1000;
    window.dispatchEvent(new Event('touchmove'));
    await render(false);
    time += 10;
    await render();
    time += 1000;
    await scroll();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
