import { beforeEach, describe, expect, it } from 'vitest';
import { useQueueStore } from '@/hooks/useQueue';

describe('queue display preferences', () => {
  beforeEach(() => {
    useQueueStore.setState({ showQueueTimestamps: false });
  });

  it('hides timestamps by default and toggles them on demand', () => {
    expect(useQueueStore.getState().showQueueTimestamps).toBe(false);

    useQueueStore.getState().toggleShowQueueTimestamps();
    expect(useQueueStore.getState().showQueueTimestamps).toBe(true);

    useQueueStore.getState().setShowQueueTimestamps(false);
    expect(useQueueStore.getState().showQueueTimestamps).toBe(false);
  });

  it('records an explicit pending fold and forgets it on demand', () => {
    // null means "no choice on record", which is what lets the count-based
    // default apply again after the queue drains.
    useQueueStore.setState({ pendingCollapsedOverride: null });

    useQueueStore.getState().setPendingCollapsed(true);
    expect(useQueueStore.getState().pendingCollapsedOverride).toBe(true);

    useQueueStore.getState().setPendingCollapsed(false);
    expect(useQueueStore.getState().pendingCollapsedOverride).toBe(false);

    useQueueStore.getState().clearPendingCollapsedOverride();
    expect(useQueueStore.getState().pendingCollapsedOverride).toBeNull();
  });
});
