import { beforeEach, describe, expect, it } from 'vitest';
import { useQueueStore } from '@/hooks/useQueue';
import type { HistoryOutputImage } from '@/api/types';

const image = (filename: string): HistoryOutputImage => ({
  filename,
  subfolder: '',
  type: 'output',
});

beforeEach(() => {
  useQueueStore.setState({
    running: [],
    pending: [],
    completing: [],
    completingStartedAt: {},
    completionDurations: {},
    shadowQueueJobs: {},
    isLoading: false,
    lastExecutedId: null,
    localPromptOrder: {},
    nextLocalPromptOrder: 1,
    livePromptOutputs: {},
  });
});

describe('queue live prompt outputs', () => {
  it('stores live outputs for prompts enqueued by this app', () => {
    const store = useQueueStore.getState();

    store.registerLocalPrompt('promptA');
    store.addLivePromptOutputs('promptA', [image('a.png')]);
    store.addLivePromptOutputs('promptA', [image('b.png')]);

    expect(useQueueStore.getState().livePromptOutputs.promptA).toEqual([
      image('a.png'),
      image('b.png'),
    ]);
  });

  it('stores websocket outputs for prompts enqueued by another client', () => {
    useQueueStore.getState().addLivePromptOutputs('externalPrompt', [image('external.png')]);

    const state = useQueueStore.getState();
    expect(state.livePromptOutputs.externalPrompt).toEqual([image('external.png')]);
    expect(state.localPromptOrder.externalPrompt).toBe(1);
    expect(state.nextLocalPromptOrder).toBe(2);
  });

  it('can clear one prompt without clearing other local prompt outputs', () => {
    const store = useQueueStore.getState();
    store.registerLocalPrompt('promptA');
    store.registerLocalPrompt('promptB');
    store.addLivePromptOutputs('promptA', [image('a.png')]);
    store.addLivePromptOutputs('promptB', [image('b.png')]);

    store.clearLivePromptOutputs('promptA');

    const state = useQueueStore.getState();
    expect(state.livePromptOutputs.promptA).toBeUndefined();
    expect(state.localPromptOrder.promptA).toBeUndefined();
    expect(state.livePromptOutputs.promptB).toEqual([image('b.png')]);
    expect(state.localPromptOrder.promptB).toBe(2);
  });

  it('records prompt registration order for follow queue sorting', () => {
    const store = useQueueStore.getState();
    store.registerLocalPrompt('promptA');
    store.registerLocalPrompt('promptB');
    store.registerLocalPrompt('promptA');

    const state = useQueueStore.getState();
    expect(state.localPromptOrder.promptA).toBe(1);
    expect(state.localPromptOrder.promptB).toBe(2);
    expect(state.nextLocalPromptOrder).toBe(3);
  });

  it('retains a completing item and its media until history confirms it', () => {
    const runningItem = {
      number: 1,
      prompt_id: 'promptA',
      prompt: {},
      extra: {},
      outputs_to_execute: [],
    };
    useQueueStore.setState({ running: [runningItem] });
    const store = useQueueStore.getState();
    store.addLivePromptOutputs('promptA', [image('final.png')]);
    store.markPromptCompleting('promptA', 1.75);

    expect(useQueueStore.getState().completing).toEqual([runningItem]);
    expect(useQueueStore.getState().completionDurations.promptA).toBe(1.75);
    expect(useQueueStore.getState().livePromptOutputs.promptA).toEqual([image('final.png')]);

    useQueueStore.getState().markPromptCompleted('promptA');

    expect(useQueueStore.getState().completing).toEqual([]);
    expect(useQueueStore.getState().completionDurations.promptA).toBeUndefined();
    expect(useQueueStore.getState().livePromptOutputs.promptA).toBeUndefined();
  });

  it('does not synthesize a completing card for a foreign prompt', () => {
    // ComfyUI broadcasts executing(null) to every connected socket, so a prompt
    // run from another client reaches markPromptCompleting with no local
    // running/pending entry and no shadow job. It must not create a blank card.
    const store = useQueueStore.getState();
    store.markPromptCompleting('foreignPrompt', 2.0);

    const state = useQueueStore.getState();
    expect(state.completing).toEqual([]);
    expect(state.completingStartedAt.foreignPrompt).toBeUndefined();
    // Duration is still recorded (harmless if the prompt is never shown).
    expect(state.completionDurations.foreignPrompt).toBe(2.0);
  });

  it('synthesizes a completing card from a shadow-tracked job', () => {
    // A job we queued whose running/pending entry already left the local queue
    // should still surface a card, reconstructed from its shadow snapshot.
    useQueueStore.setState({
      shadowQueueJobs: {
        shadowPrompt: {
          originalPromptId: 'shadowPrompt',
          number: 7,
          prompt: { 1: { class_type: 'X', inputs: {} } },
          extraData: { foo: 'bar' },
          outputsToExecute: ['9'],
          status: 'running',
          queuedAt: 1000,
        },
      },
    });
    const store = useQueueStore.getState();
    store.markPromptCompleting('shadowPrompt', 3.0);

    const state = useQueueStore.getState();
    expect(state.completing).toHaveLength(1);
    expect(state.completing[0]).toMatchObject({
      prompt_id: 'shadowPrompt',
      number: 7,
      outputs_to_execute: ['9'],
    });
    expect(state.completingStartedAt.shadowPrompt).toBeDefined();
    expect(state.completionDurations.shadowPrompt).toBe(3.0);
  });
});
