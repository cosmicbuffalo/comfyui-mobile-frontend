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
});
