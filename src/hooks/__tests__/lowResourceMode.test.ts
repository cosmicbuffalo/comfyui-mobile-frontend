import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGenerationSettingsStore } from '../useGenerationSettings';
import { getScreenPreviewUrl, getQueueImagePreviewUrl } from '@/api/client/base';

describe('device-local low resource preset', () => {
  beforeEach(() => useGenerationSettingsStore.setState(useGenerationSettingsStore.getInitialState()));
  afterEach(() => useGenerationSettingsStore.setState(useGenerationSettingsStore.getInitialState()));

  it.each([true, false])('migrates the old blur preference (%s) without replacing other preferences', async (blur) => {
    localStorage.setItem('generation-settings-storage', JSON.stringify({ version: 0,
      state: { blurEffectsEnabled: blur, previewMethod: 'taesd', webpPreviewEnabled: false } }));
    await useGenerationSettingsStore.persist.rehydrate();
    expect(useGenerationSettingsStore.getState()).toMatchObject({
      lowResourceMode: !blur, previewMethod: 'taesd', webpPreviewEnabled: false,
    });
    expect(useGenerationSettingsStore.getState()).not.toHaveProperty('blurEffectsEnabled');
  });

  it('caps preview resolution and preserves the saved settings when switched off', () => {
    const store = useGenerationSettingsStore;
    store.setState({ previewMethod: 'taesd', webpPreviewEnabled: true });
    const original = getQueueImagePreviewUrl('large.png', '', 'output');
    store.getState().setLowResourceMode(true);
    expect(getScreenPreviewUrl('/view?filename=large.png&type=output')).toContain('maxedge=1024');
    expect(getQueueImagePreviewUrl('large.png', '', 'output')).toContain('maxedge=1024');
    expect(store.getState().previewMethod).toBe('taesd');
    store.setState({ webpPreviewEnabled: false });
    expect(getQueueImagePreviewUrl('large.png', '', 'output')).toContain('maxedge=1024');
    store.setState({ webpPreviewEnabled: true });
    store.getState().setLowResourceMode(false);
    expect(getQueueImagePreviewUrl('large.png', '', 'output')).toBe(original);
  });
});
