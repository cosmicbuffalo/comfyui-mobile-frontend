import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowState: {
    workflow: { nodes: [], links: [] },
    runCount: 1,
    infiniteLoop: false,
    setInfiniteLoop: vi.fn(),
    isStopping: false,
    setIsStopping: vi.fn(),
    isExecuting: false,
    isLoading: false,
    queueWorkflow: vi.fn(),
  },
  queueState: {
    interrupt: vi.fn(),
    running: [],
    pending: [],
  },
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (state: typeof mocks.workflowState) => unknown) =>
    selector(mocks.workflowState),
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (state: typeof mocks.queueState) => unknown) =>
    selector(mocks.queueState),
}));

import { RunButton } from '../RunButton';

function dispatchPointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  { x = 0, y = 0, pointerId = 1 } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    isPrimary: { value: true },
  });
  target.dispatchEvent(event);
}

describe('RunButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.workflowState.workflow = { nodes: [], links: [] };
    mocks.workflowState.runCount = 1;
    mocks.workflowState.infiniteLoop = false;
    mocks.workflowState.isStopping = false;
    mocks.workflowState.isExecuting = false;
    mocks.workflowState.isLoading = false;
    mocks.workflowState.setInfiniteLoop.mockReset();
    mocks.workflowState.setIsStopping.mockReset();
    mocks.workflowState.queueWorkflow.mockReset().mockResolvedValue(true);
    mocks.queueState.running = [];
    mocks.queueState.pending = [];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('appends an ordinary click to the queue', async () => {
    await act(async () => {
      root.render(<RunButton />);
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });

    expect(mocks.workflowState.queueWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.workflowState.queueWorkflow).toHaveBeenCalledWith(1);
  });

  it('queues the selected run count at the front after a hold without appending on release', async () => {
    mocks.workflowState.runCount = 3;
    await act(async () => {
      root.render(<RunButton />);
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      if (!button) return;
      dispatchPointer(button, 'pointerdown', { x: 20, y: 20 });
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(mocks.workflowState.queueWorkflow).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mocks.workflowState.queueWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.workflowState.queueWorkflow).toHaveBeenCalledWith(
      3,
      undefined,
      false,
      true,
    );
    expect(container.querySelector('[role="status"]')?.textContent)
      .toContain('Queued at front');

    await act(async () => {
      if (!button) return;
      dispatchPointer(button, 'pointerup', { x: 20, y: 20 });
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(mocks.workflowState.queueWorkflow).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1799);
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('does not confirm a front queue when submission fails', async () => {
    mocks.workflowState.queueWorkflow.mockResolvedValueOnce(false);
    await act(async () => {
      root.render(<RunButton />);
    });

    const button = container.querySelector('button');
    await act(async () => {
      if (!button) return;
      dispatchPointer(button, 'pointerdown');
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.workflowState.queueWorkflow).toHaveBeenCalledWith(
      1,
      undefined,
      false,
      true,
    );
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('cancels the hold when the pointer moves and keeps release as a normal click', async () => {
    await act(async () => {
      root.render(<RunButton />);
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    await act(async () => {
      if (!button) return;
      dispatchPointer(button, 'pointerdown', { x: 10, y: 10 });
      dispatchPointer(button, 'pointermove', { x: 30, y: 10 });
      await vi.advanceTimersByTimeAsync(500);
      dispatchPointer(button, 'pointerup', { x: 30, y: 10 });
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    expect(mocks.workflowState.queueWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.workflowState.queueWorkflow).toHaveBeenCalledWith(1);
  });

  it('shows immediate queueing feedback while submission is in flight', async () => {
    await act(async () => {
      root.render(<RunButton />);
    });

    const button = container.querySelector('button');
    expect(button?.textContent).toContain('Run');
    expect(button?.disabled).toBe(false);

    mocks.workflowState.isLoading = true;
    await act(async () => {
      root.render(<RunButton />);
    });

    expect(button?.textContent).toContain('Queueing...');
    expect(button?.disabled).toBe(true);
    expect(button?.getAttribute('aria-busy')).toBe('true');
    // The visible label is desktop-only, so on a phone this is the only
    // accessible name the button has while it is queueing.
    expect(button?.getAttribute('aria-label')).toBe('Queueing...');
  });
});
