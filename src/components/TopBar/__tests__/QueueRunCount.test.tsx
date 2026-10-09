import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../../TopBar';
import { useHistoryStore } from '@/hooks/useHistory';
import { useQueueStore } from '@/hooks/useQueue';
import { useShowHiddenStore } from '@/hooks/useShowHidden';

describe('queue top bar run count', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    useHistoryStore.setState({ history: [], historyTotal: 5, historyHiddenTotal: 3 });
    useQueueStore.setState({
      pending: [
        { number: 1, prompt_id: 'p1', prompt: {}, extra: { mobile_hidden_workflow: true }, outputs_to_execute: [] },
        { number: 2, prompt_id: 'p2', prompt: {}, extra: {}, outputs_to_execute: [] },
      ],
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useShowHiddenStore.setState({ showHidden: false });
    vi.unstubAllGlobals();
  });

  const subtitle = () => container.querySelector('.top-bar-subtitle')?.textContent;

  it('leaves hidden runs out of the count while hidden items are hidden', async () => {
    useShowHiddenStore.setState({ showHidden: false });
    await act(async () => root.render(<TopBar mode="queue" />));
    expect(subtitle()).toBe('2 runs (1 pending)');
  });

  it('counts hidden runs while hidden items are shown', async () => {
    useShowHiddenStore.setState({ showHidden: true });
    await act(async () => root.render(<TopBar mode="queue" />));
    expect(subtitle()).toBe('5 runs (2 pending)');
  });
});
