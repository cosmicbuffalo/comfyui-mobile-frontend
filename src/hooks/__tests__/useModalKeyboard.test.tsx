import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalKeyboard } from '../useModalKeyboard';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Harness({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalKeyboard(isOpen, onClose, ref);
  return (
    <div ref={ref} data-testid="modal">
      <button>first</button>
      <button>last</button>
    </div>
  );
}

function pressEscape(init?: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, ...init });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
}

describe('useModalKeyboard', () => {
  it('closes on Escape when open', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Harness, { isOpen: true, onClose })));
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing on Escape when closed', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Harness, { isOpen: false, onClose })));
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores Escape a child already handled (defaultPrevented)', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Harness, { isOpen: true, onClose })));
    // A child consumed the Escape first (e.g. a dropdown closing its menu).
    const consumed = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    consumed.preventDefault();
    act(() => document.dispatchEvent(consumed));
    expect(onClose).not.toHaveBeenCalled();
    // An unconsumed Escape still closes the modal.
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab (prevents default) when the modal has no focusable children', () => {
    function EmptyHarness({ onClose }: { onClose: () => void }) {
      const ref = useRef<HTMLDivElement>(null);
      useModalKeyboard(true, onClose, ref);
      return <div ref={ref}>no focusable content</div>;
    }
    act(() => root.render(createElement(EmptyHarness, { onClose: vi.fn() })));
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true });
    act(() => { document.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  });

  it('detaches the listener on unmount', () => {
    const onClose = vi.fn();
    act(() => root.render(createElement(Harness, { isOpen: true, onClose })));
    act(() => root.unmount());
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    // Re-create so afterEach's unmount/remove is safe.
    root = createRoot(container);
  });
});
