import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGenerationSettingsStore } from '../useGenerationSettings';
import { useInfiniteLoop } from '../useInfiniteLoop';
import { useWorkflowStore } from '../useWorkflow';
import { useWorkflowErrorsStore } from '../useWorkflowErrors';

function InfiniteLoopHarness() {
  useInfiniteLoop();
  return null;
}

describe('useInfiniteLoop', () => {
  let container: HTMLDivElement;
  let root: Root;
  let queueWorkflow: ReturnType<typeof vi.fn<(count: number) => Promise<void>>>;
  let originalQueueWorkflow: ReturnType<typeof useWorkflowStore.getState>['queueWorkflow'];

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    queueWorkflow = vi.fn<(count: number) => Promise<void>>().mockResolvedValue(undefined);
    originalQueueWorkflow = useWorkflowStore.getState().queueWorkflow;

    useGenerationSettingsStore.setState({ infiniteModeEnabled: false });
    useWorkflowErrorsStore.setState({ error: null });
    useWorkflowStore.setState({
      infiniteLoop: true,
      isExecuting: true,
      queueWorkflow,
    });

    await act(async () => {
      root.render(<InfiniteLoopHarness />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    useWorkflowStore.setState({ queueWorkflow: originalQueueWorkflow });
    container.remove();
    vi.clearAllMocks();
  });

  it('does not queue the next run when infinite mode is disabled', async () => {
    await act(async () => {
      useWorkflowStore.setState({ isExecuting: false });
    });

    expect(queueWorkflow).not.toHaveBeenCalled();
  });

  it('queues the next run when infinite mode is enabled and execution finishes', async () => {
    await act(async () => {
      useGenerationSettingsStore.setState({ infiniteModeEnabled: true });
    });

    await act(async () => {
      useWorkflowStore.setState({ isExecuting: false });
    });

    expect(queueWorkflow).toHaveBeenCalledTimes(1);
    expect(queueWorkflow).toHaveBeenCalledWith(1);
  });

  it('does not queue the next run when execution finishes with an error', async () => {
    await act(async () => {
      useGenerationSettingsStore.setState({ infiniteModeEnabled: true });
      useWorkflowErrorsStore.setState({ error: 'Generation failed' });
    });

    await act(async () => {
      useWorkflowStore.setState({ isExecuting: false });
    });

    expect(queueWorkflow).not.toHaveBeenCalled();
  });
});
