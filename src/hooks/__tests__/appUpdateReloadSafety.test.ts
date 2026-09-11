import { beforeEach, describe, expect, it } from 'vitest';
import { canReloadSilently } from '../useAppUpdateCheck';
import { useQueueStore } from '../useQueue';
import { useWorkflowStore } from '../useWorkflow';
import { useMaskEditorStore } from '../useMaskEditor';
import { useImageViewerStore } from '../useImageViewer';

/**
 * A silent reload is safe because persisted state (workflow edits, sessions)
 * rehydrates — but transient state does not. Each case here is a thing a
 * reload would visibly destroy or disturb; if any is live, the update check
 * must fall back to the dismissible banner instead of reloading over it.
 */

function makeQueueItem(promptId: string, status: 'pending' | 'running') {
  return { prompt_id: promptId, status } as never;
}

beforeEach(() => {
  useQueueStore.setState({ running: [], pending: [] });
  useWorkflowStore.setState({ isExecuting: false, infiniteLoop: false });
  useMaskEditorStore.setState({ target: null });
  useImageViewerStore.setState({ viewerOpen: false });
});

describe('canReloadSilently', () => {
  it('allows a reload when everything is idle', () => {
    expect(canReloadSilently()).toBe(true);
  });

  it('blocks while a prompt is running', () => {
    useQueueStore.setState({ running: [makeQueueItem('p1', 'running')] });
    expect(canReloadSilently()).toBe(false);
  });

  it('blocks while prompts are pending', () => {
    useQueueStore.setState({ pending: [makeQueueItem('p2', 'pending')] });
    expect(canReloadSilently()).toBe(false);
  });

  it('blocks while executing', () => {
    useWorkflowStore.setState({ isExecuting: true });
    expect(canReloadSilently()).toBe(false);
  });

  it('blocks while an infinite loop is armed', () => {
    useWorkflowStore.setState({ infiniteLoop: true });
    expect(canReloadSilently()).toBe(false);
  });

  it('blocks while the mask editor is open (unsaved strokes are transient)', () => {
    useMaskEditorStore.setState({ target: {} as never });
    expect(canReloadSilently()).toBe(false);
  });

  it('blocks while the image viewer is open', () => {
    useImageViewerStore.setState({ viewerOpen: true });
    expect(canReloadSilently()).toBe(false);
  });
});
