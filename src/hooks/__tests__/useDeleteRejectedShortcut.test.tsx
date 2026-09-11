import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteRejectedShortcut } from '@/hooks/useDeleteRejectedShortcut';

function Harness({ enabled, onTrigger }: { enabled: boolean; onTrigger: () => void }) {
  useDeleteRejectedShortcut({ enabled, onTrigger });
  return null;
}

function dispatchShortcut(
  init: KeyboardEventInit = {},
  target: EventTarget = document,
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Backspace',
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe('useDeleteRejectedShortcut', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onTrigger = vi.fn();

  const render = async (enabled = true) => {
    await act(async () => {
      root.render(<Harness enabled={enabled} onTrigger={onTrigger} />);
    });
  };

  beforeEach(() => {
    onTrigger.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('opens the confirmation on Command+Delete', async () => {
    await render();

    const event = dispatchShortcut();

    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('accepts the forward-delete key too', async () => {
    // A Mac keyboard's Delete key reports `Backspace`; a full-size keyboard's
    // forward-delete reports `Delete`, and means the same thing here.
    await render();

    dispatchShortcut({ key: 'Delete', metaKey: false, ctrlKey: true });

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('still answers the shifted chord, for a browser that passes it through', async () => {
    // Chrome swallows Shift+Command+Delete for Clear Browsing Data, which is
    // why Shift stopped being required — but where it does arrive it means the
    // same thing.
    await render();

    dispatchShortcut({ shiftKey: true });

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('leaves an unmodified delete alone', async () => {
    // Backspace on its own is Back in some browsers and a plain edit in every
    // text field; claiming it would delete files on a near miss.
    await render();

    const bare = dispatchShortcut({ metaKey: false });
    const optioned = dispatchShortcut({ altKey: true });
    const repeated = dispatchShortcut({ repeat: true });

    expect(onTrigger).not.toHaveBeenCalled();
    expect(bare.defaultPrevented).toBe(false);
    expect(optioned.defaultPrevented).toBe(false);
    expect(repeated.defaultPrevented).toBe(false);
  });

  it('stays out of the way while text is being edited', async () => {
    await render();
    const input = document.createElement('input');
    document.body.appendChild(input);

    dispatchShortcut({}, input);

    expect(onTrigger).not.toHaveBeenCalled();
    input.remove();
  });

  it('does nothing when there is nothing rejected to delete', async () => {
    await render(false);

    const event = dispatchShortcut();

    expect(onTrigger).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
