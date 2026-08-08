import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queueState: {
    queueItemExpanded: {
      'pending-prompt': true,
      'running-prompt': true,
      'done-prompt': true,
    },
    setQueueItemExpanded: vi.fn(),
    setQueueItemUserToggled: vi.fn(),
    showQueueMetadata: false,
    toggleShowQueueMetadata: vi.fn(),
    showQueueTimestamps: false,
    toggleShowQueueTimestamps: vi.fn(),
    showPromptPreview: true,
    toggleShowPromptPreview: vi.fn(),
    queueOutputLayout: 'tabbed',
    toggleQueueOutputLayout: vi.fn(),
    previewVisibility: {},
    setPreviewVisibility: vi.fn(),
    previewVisibilityDefault: false,
    setPreviewVisibilityDefault: vi.fn(),
    pending: [{ prompt_id: 'pending-prompt' }],
    running: [{ prompt_id: 'running-prompt' }],
    // Running→done hand-off: dropped from `running`, not yet in history.
    // QueuePanel renders it as a running card, so folding must reach it.
    completing: [{ prompt_id: 'completing-prompt' }],
  },
  historyState: {
    history: [{
      prompt_id: 'done-prompt',
      outputs: { images: [] },
    }],
    clearEmptyItems: vi.fn(),
  },
  outputsState: {
    rejected: [],
  },
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (state: typeof mocks.queueState) => unknown) =>
    selector(mocks.queueState),
}));

vi.mock('@/hooks/useHistory', () => ({
  useHistoryStore: (selector: (state: typeof mocks.historyState) => unknown) =>
    selector(mocks.historyState),
}));

vi.mock('@/hooks/useOutputs', () => ({
  useOutputsStore: (selector: (state: typeof mocks.outputsState) => unknown) =>
    selector(mocks.outputsState),
}));

import { QueueTopBarMenu } from '../QueueTopBarMenu';

describe('QueueTopBarMenu folding', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.queueState.setQueueItemExpanded.mockClear();
    mocks.queueState.setQueueItemUserToggled.mockClear();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('folds every card — including completing hand-offs — and records each fold as user intent', async () => {
    await act(async () => {
      root.render(
        <QueueTopBarMenu
          open
          buttonRef={createRef<HTMLButtonElement>()}
          menuRef={createRef<HTMLDivElement>()}
          onToggle={() => {}}
          onClose={() => {}}
          onGoToWorkflow={() => {}}
          onOpenClearHistoryConfirm={() => {}}
          onOpenCancelPendingConfirm={() => {}}
          onOpenDeleteRejectedConfirm={() => {}}
        />,
      );
    });

    const foldAll = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Fold All'),
    );
    expect(foldAll).toBeDefined();
    await act(async () => {
      foldAll?.click();
    });

    // Every card folds, and every fold is recorded as user intent — a card in
    // the completion window (or one auto-opening later) must not pop back open.
    const foldedIds = ['pending-prompt', 'running-prompt', 'completing-prompt', 'done-prompt'];
    expect(mocks.queueState.setQueueItemExpanded.mock.calls).toEqual(
      foldedIds.map((id) => [id, false]),
    );
    expect(mocks.queueState.setQueueItemUserToggled.mock.calls).toEqual(
      foldedIds.map((id) => [id, true]),
    );
  });
});
