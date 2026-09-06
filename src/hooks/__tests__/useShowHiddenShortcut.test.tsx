import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShowHiddenShortcut } from '@/hooks/useShowHiddenShortcut';

function Harness({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  useShowHiddenShortcut({ enabled, onToggle });
  return null;
}

function dispatchShortcut(init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: '>',
    code: 'Period',
    metaKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}

describe('useShowHiddenShortcut', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onToggle = vi.fn();

  beforeEach(async () => {
    onToggle.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness enabled onToggle={onToggle} />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('toggles hidden items with Command+Shift+Period', () => {
    const event = dispatchShortcut();

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not claim similar shortcuts', () => {
    const controlShortcut = dispatchShortcut({ metaKey: false, ctrlKey: true });
    const unshiftedShortcut = dispatchShortcut({ shiftKey: false, key: '.' });
    const repeatedShortcut = dispatchShortcut({ repeat: true });

    expect(onToggle).not.toHaveBeenCalled();
    expect(controlShortcut.defaultPrevented).toBe(false);
    expect(unshiftedShortcut.defaultPrevented).toBe(false);
    expect(repeatedShortcut.defaultPrevented).toBe(false);
  });

  it('does nothing when its browser is not visible', async () => {
    await act(async () => {
      root.render(<Harness enabled={false} onToggle={onToggle} />);
    });

    const event = dispatchShortcut();
    expect(onToggle).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
