import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAutocompletePlusAvailable } from '@/api/autocompletePlusClient';
import { getAppPreferences } from '@/api/client/preferences';
import { useAutocompleteStore } from '../useAutocompleteStore';

vi.mock('@/api/autocompletePlusClient', () => ({
  fetchDanbooruTags: vi.fn(async () => []),
  fetchEmbeddingNames: vi.fn(async () => []),
  fetchLoraNames: vi.fn(async () => []),
  isAutocompletePlusAvailable: vi.fn(async () => true),
}));

vi.mock('@/api/client/preferences', () => ({
  getAppPreferences: vi.fn(async () => ({ autocompleteEnabled: false })),
  setAppPreferences: vi.fn(async (prefs: { autocompleteEnabled?: boolean }) => prefs),
}));

const isAutocompletePlusAvailableMock = vi.mocked(isAutocompletePlusAvailable);
const getAppPreferencesMock = vi.mocked(getAppPreferences);

beforeEach(() => {
  vi.clearAllMocks();
  useAutocompleteStore.setState({
    available: false,
    enabled: false,
    initStatus: 'idle',
    dataStatus: 'idle',
    tags: [],
    loras: [],
    embeddings: [],
  });
});

describe('useAutocompleteStore', () => {
  it('retries initialization after a transient error', async () => {
    isAutocompletePlusAvailableMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(true);
    getAppPreferencesMock.mockResolvedValue({ autocompleteEnabled: false });

    await useAutocompleteStore.getState().ensureInitialized();
    expect(useAutocompleteStore.getState().initStatus).toBe('error');

    await useAutocompleteStore.getState().ensureInitialized();
    expect(useAutocompleteStore.getState()).toMatchObject({
      available: true,
      enabled: false,
      initStatus: 'ready',
    });
    expect(isAutocompletePlusAvailableMock).toHaveBeenCalledTimes(2);
  });
});
