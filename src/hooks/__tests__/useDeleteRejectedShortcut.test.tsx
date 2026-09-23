import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteRejectedShortcut } from '@/hooks/useDeleteRejectedShortcut';
import { useImageViewerStore } from '@/hooks/useImageViewer';

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

describe('useDeleteRejectedShortcut guards against a hidden confirmation', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onTrigger = vi.fn();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    onTrigger.mockClear();
    useImageViewerStore.setState({ viewerOpen: false });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useImageViewerStore.setState({ viewerOpen: false });
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  });

  it('does not fire while the full-screen viewer is open', () => {
    // The panel's TopBar stays mounted underneath the viewer, so without this
    // the chord opened a confirmation below the overlay: invisible,
    // unclickable, and already focused on its Delete button.
    act(() => root.render(<Harness enabled onTrigger={onTrigger} />));
    useImageViewerStore.setState({ viewerOpen: true });

    const event = dispatchShortcut();
    expect(onTrigger).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not fire while another dialog is already open', () => {
    act(() => root.render(<Harness enabled onTrigger={onTrigger} />));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    dispatchShortcut();
    expect(onTrigger).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('still fires with the viewer closed and no dialog up', () => {
    act(() => root.render(<Harness enabled onTrigger={onTrigger} />));
    dispatchShortcut();
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });
});
