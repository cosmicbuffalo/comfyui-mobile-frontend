import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowUndoShortcuts } from '@/hooks/useWorkflowUndoShortcuts';
import { useWorkflowUndoStore } from '@/hooks/useWorkflowUndo';

function Harness({ visible }: { visible: boolean }) {
  useWorkflowUndoShortcuts(visible);
  return <input aria-label="Workflow title" />;
}

function dispatchShortcut(init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(event);
  return event;
}

describe('useWorkflowUndoShortcuts', () => {
  let container: HTMLDivElement;
  let root: Root;
  let undo: ReturnType<typeof vi.spyOn>;
  let redo: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    undo = vi.spyOn(useWorkflowUndoStore.getState(), 'undo').mockImplementation(() => undefined);
    redo = vi.spyOn(useWorkflowUndoStore.getState(), 'redo').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness visible={true} />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('maps the standard Undo and Redo shortcuts', () => {
    const commandUndo = dispatchShortcut({ key: 'z', metaKey: true });
    const controlUndo = dispatchShortcut({ key: 'z', ctrlKey: true });
    const commandRedo = dispatchShortcut({ key: 'z', metaKey: true, shiftKey: true });
    const controlRedo = dispatchShortcut({ key: 'z', ctrlKey: true, shiftKey: true });
    const controlYRedo = dispatchShortcut({ key: 'y', ctrlKey: true });

    expect(undo).toHaveBeenCalledTimes(2);
    expect(redo).toHaveBeenCalledTimes(3);
    for (const event of [commandUndo, controlUndo, commandRedo, controlRedo, controlYRedo]) {
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('preserves native undo while typing', () => {
    const input = container.querySelector('input')!;
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });

  it('does not handle shortcuts when the Workflow panel is hidden', async () => {
    await act(async () => {
      root.render(<Harness visible={false} />);
    });

    const event = dispatchShortcut({ key: 'z', metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
  });
});
