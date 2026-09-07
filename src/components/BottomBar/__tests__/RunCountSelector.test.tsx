import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowState: {
    runCount: 1,
    setRunCount: vi.fn(),
  },
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (state: typeof mocks.workflowState) => unknown) =>
    selector(mocks.workflowState),
}));

import { RunCountSelector } from '../RunCountSelector';

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

describe('RunCountSelector', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = async (runCount: number) => {
    mocks.workflowState.runCount = runCount;
    await act(async () => {
      root.render(<RunCountSelector />);
    });
  };
  const increment = () => container.querySelector('.run-count-increment') as HTMLButtonElement;
  const decrement = () => container.querySelector('.run-count-decrement') as HTMLButtonElement;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.workflowState.setRunCount.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('steps by one on a tap', async () => {
    await render(3);

    await act(async () => { increment().click(); });
    expect(mocks.workflowState.setRunCount).toHaveBeenLastCalledWith(4);

    await act(async () => { decrement().click(); });
    expect(mocks.workflowState.setRunCount).toHaveBeenLastCalledWith(2);
  });

  it('doubles on a hold and does not also step on the release', async () => {
    await render(3);

    await act(async () => {
      dispatchPointer(increment(), 'pointerdown');
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(mocks.workflowState.setRunCount).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.workflowState.setRunCount).toHaveBeenCalledExactlyOnceWith(6);

    // The click that trails pointerup must be eaten, or the hold and the
    // release both move the count. jsdom's .click() reports detail 0, which is
    // the keyboard shape, so spell out the pointer one.
    await act(async () => {
      dispatchPointer(increment(), 'pointerup');
      increment().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    expect(mocks.workflowState.setRunCount).toHaveBeenCalledExactlyOnceWith(6);
  });

  it('halves on a hold', async () => {
    await render(9);

    await act(async () => {
      dispatchPointer(decrement(), 'pointerdown');
      await vi.advanceTimersByTimeAsync(500);
    });
    // The raw quotient goes to the store, which is where the floor and the
    // clamp to 1 live.
    expect(mocks.workflowState.setRunCount).toHaveBeenCalledExactlyOnceWith(4.5);
  });

  it('does not arm the halving hold at a count of one', async () => {
    await render(1);

    await act(async () => {
      dispatchPointer(decrement(), 'pointerdown');
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mocks.workflowState.setRunCount).not.toHaveBeenCalled();
  });

  it('leaves keyboard activation a single step even after a hold', async () => {
    await render(4);

    await act(async () => {
      dispatchPointer(increment(), 'pointerdown');
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(mocks.workflowState.setRunCount).toHaveBeenLastCalledWith(8);

    // detail 0 is a keyboard press, which never trails a pointer hold.
    await act(async () => {
      increment().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    });
    expect(mocks.workflowState.setRunCount).toHaveBeenLastCalledWith(5);
  });
});
