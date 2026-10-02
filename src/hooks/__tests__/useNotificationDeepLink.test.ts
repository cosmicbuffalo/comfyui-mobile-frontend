import { afterEach, describe, expect, it } from 'vitest';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useNotificationDeepLinkStore } from '@/hooks/useNotificationDeepLink';

describe('notification deep link store', () => {
  afterEach(() => {
    useNotificationDeepLinkStore.setState({ pendingPromptId: null });
    useNavigationStore.setState({ currentPanel: 'workflow' });
  });

  it('arming switches to the queue', () => {
    useNotificationDeepLinkStore.getState().arm('a');
    expect(useNotificationDeepLinkStore.getState().pendingPromptId).toBe('a');
    expect(useNavigationStore.getState().currentPanel).toBe('queue');
  });

  it('a guarded disarm leaves a newer link armed', () => {
    // The race QueuePanel guards against: its effect, rendered for prompt a,
    // finishes after a second notification has already armed prompt b.
    const store = useNotificationDeepLinkStore.getState();
    store.arm('a');
    store.arm('b');
    store.disarm('a');
    expect(useNotificationDeepLinkStore.getState().pendingPromptId).toBe('b');
  });

  it('a guarded disarm clears the link it names', () => {
    const store = useNotificationDeepLinkStore.getState();
    store.arm('a');
    store.disarm('a');
    expect(useNotificationDeepLinkStore.getState().pendingPromptId).toBeNull();
  });
});
