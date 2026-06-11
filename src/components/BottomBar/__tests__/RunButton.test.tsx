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

describe('RunButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.workflowState.isLoading = false;
    mocks.workflowState.queueWorkflow.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
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
  });
});
