import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedItem } from '../types';

const mocks = vi.hoisted(() => ({
  queueState: {
    previewVisibility: {},
    previewVisibilityDefault: true,
    showQueueMetadata: false,
    showQueueTimestamps: false,
    showPromptPreview: false,
    queueItemExpanded: { 'latent-prompt': true },
    queueItemUserToggled: {},
    queueItemHideImages: {},
    completionDurations: {},
    completing: [],
    autoRestoredPromptIds: {},
    queueMetadata: {},
    setQueueItemExpanded: vi.fn(),
    setQueueItemUserToggled: vi.fn(),
  },
  outputsState: {
    favorites: [],
  },
  workflowState: {
    promptToSession: {},
    sessions: [],
    activeSessionId: null,
    parkedSessions: {},
    currentFilename: null,
    workflowSource: null,
    latentPreviewByPrompt: {
      'latent-prompt': { url: 'blob:latent-frame', seq: 7 },
    },
  },
}));

vi.mock('@/hooks/useQueue', () => ({
  useQueueStore: (selector: (state: typeof mocks.queueState) => unknown) =>
    selector(mocks.queueState),
}));

vi.mock('@/hooks/useOutputs', () => ({
  useOutputsStore: (selector: (state: typeof mocks.outputsState) => unknown) =>
    selector(mocks.outputsState),
}));

vi.mock('@/hooks/useWorkflow', () => ({
  useWorkflowStore: (selector: (state: typeof mocks.workflowState) => unknown) =>
    selector(mocks.workflowState),
}));

import { QueueCard } from '../QueueCard';

const runningItem: UnifiedItem = {
  id: 'latent-prompt',
  status: 'running',
  data: {
    number: 1,
    prompt_id: 'latent-prompt',
    prompt: {},
    extra: {},
    outputs_to_execute: [],
  },
};

describe('QueueCard latent preview', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  const render = (runningImages: Array<{ filename: string; subfolder: string; type: string }>) =>
    act(async () => {
      root.render(
        <QueueCard
          item={runningItem}
          isActuallyRunning
          progress={50}
          viewerImages={[]}
          runningImages={runningImages as never}
          onOpenMenu={() => {}}
          isTopDoneItem={false}
        />,
      );
    });

  it('shows the live latent preview (blob URL + LATENT badge) while generating', async () => {
    await render([]);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('blob:latent-frame');
    expect(container.textContent).toContain('LATENT');
    // Latent-only: no thumbnail tab bar yet.
    expect(container.querySelector('.queue-media-tabs')).toBeNull();
  });

  it('shows a thumbnail picker when a real preview coexists with the latent', async () => {
    await render([{ filename: 'preview.png', subfolder: '', type: 'temp' }]);
    const tabs = Array.from(container.querySelectorAll('.queue-media-tabs button'));
    // One real preview tab + the latent tab.
    expect(tabs).toHaveLength(2);
    const labels = tabs.map((t) => t.getAttribute('title'));
    expect(labels).toContain('Latent');
    expect(labels).toContain('Preview #1');
    expect(container.querySelector('.favorite-badge-container')).toBeNull();
    expect(container.querySelector('.rejected-badge-container')).toBeNull();
  });
});
