import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowUndoToast } from '@/components/WorkflowPanel/WorkflowUndoToast';
import { useWorkflowUndoStore } from '@/hooks/useWorkflowUndo';

describe('WorkflowUndoToast', () => {
  let container: HTMLDivElement;
  let root: Root;

  const action = () => container.querySelector('.undo-toast-action')?.textContent;
  const target = () => container.querySelector('.undo-toast-target')?.textContent;

  beforeEach(async () => {
    vi.useFakeTimers();
    useWorkflowUndoStore.setState({ feedback: null });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<WorkflowUndoToast />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useWorkflowUndoStore.setState({ feedback: null });
    vi.useRealTimers();
  });

  it('briefly shows the direction and recorded action label', async () => {
    await act(async () => {
      useWorkflowUndoStore.setState({
        feedback: { id: 1, direction: 'undo', actionLabel: 'Create subgraph', target: null },
      });
    });

    expect(action()).toBe('Undo: Create subgraph');
    // Nothing to name: the step stays a single line rather than showing an
    // empty subtitle.
    expect(container.querySelector('.undo-toast-target')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1800);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('names the item the step changed, with its id, on a second line', async () => {
    await act(async () => {
      useWorkflowUndoStore.setState({
        feedback: {
          id: 2,
          direction: 'redo',
          actionLabel: 'Delete node',
          target: { name: 'KSampler', id: 12, extraCount: 0 },
        },
      });
    });

    expect(action()).toBe('Redo: Delete node');
    expect(target()).toBe('KSampler#12');
  });

  it('names the widget row a step changed, after the node', async () => {
    await act(async () => {
      useWorkflowUndoStore.setState({
        feedback: {
          id: 4,
          direction: 'undo',
          actionLabel: 'Edit value',
          target: { name: 'KSampler', id: 12, widgetLabel: 'steps', extraCount: 0 },
        },
      });
    });

    expect(target()).toBe('KSampler#12· steps');
    expect(container.querySelector('.undo-toast-widget')?.textContent).toBe('· steps');
  });

  it('says how many more items the step changed', async () => {
    await act(async () => {
      useWorkflowUndoStore.setState({
        feedback: {
          id: 3,
          direction: 'undo',
          actionLabel: 'Delete selection',
          target: { name: 'Load Checkpoint', id: 4, extraCount: 2 },
        },
      });
    });

    expect(target()).toBe('Load Checkpoint#4+2 more');
  });
});
