import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useGenerationSettings', () => ({
  useGenerationSettingsStore: { getState: () => ({ webpPreviewEnabled: true }) },
}));

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('client identity when browser storage is unavailable', () => {
  it.each(['getItem', 'setItem'] as const)('loads the API client when %s throws', async (method) => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    storage[method].mockImplementation(() => {
      throw new DOMException('Browser storage is unavailable', 'SecurityError');
    });
    vi.stubGlobal('localStorage', storage);

    const { clientId } = await import('../client/base');

    expect(clientId).toMatch(/^mobile-[a-z0-9]+$/);
    expect((await import('../client/base')).clientId).toBe(clientId);
  });

  it('reuses a saved client identity without writing a replacement', async () => {
    const storage = { getItem: vi.fn(() => 'mobile-existing'), setItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);

    expect((await import('../client/base')).clientId).toBe('mobile-existing');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
