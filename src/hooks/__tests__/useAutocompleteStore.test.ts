import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutocompleteStore } from '../useAutocompleteStore';
import type { TagEntry } from '@/utils/autocompleteSearch';

vi.mock('@/api/autocompletePlusClient', () => ({
  isAutocompletePlusAvailable: vi.fn(),
  fetchDanbooruTags: vi.fn(),
  fetchLoraNames: vi.fn(),
  fetchEmbeddingNames: vi.fn(),
}));

vi.mock('@/api/customScriptsClient', () => ({
  isCustomScriptsAvailable: vi.fn(),
  fetchCustomWords: vi.fn(),
  fetchCustomScriptsLoraNames: vi.fn(),
  fetchCoreEmbeddingNames: vi.fn(),
}));

vi.mock('@/api/client/preferences', () => ({
  getAppPreferences: vi.fn(),
  setAppPreferences: vi.fn(),
}));

import {
  fetchDanbooruTags,
  fetchEmbeddingNames,
  fetchLoraNames,
  isAutocompletePlusAvailable,
} from '@/api/autocompletePlusClient';
import {
  fetchCoreEmbeddingNames,
  fetchCustomScriptsLoraNames,
  fetchCustomWords,
  isCustomScriptsAvailable,
} from '@/api/customScriptsClient';
import { getAppPreferences } from '@/api/client/preferences';

const DANBOORU: TagEntry[] = [
  { tag: 'long_hair', category: 0, count: 1200, aliases: [] },
];
const CUSTOM: TagEntry[] = [
  { tag: 'my_style', category: -1, count: 10, aliases: [] },
];

function resetStore() {
  useAutocompleteStore.setState({
    available: false,
    plusAvailable: false,
    customScriptsAvailable: false,
    enabled: false,
    initStatus: 'idle',
    dataStatus: 'idle',
    tags: [],
    loras: [],
    embeddings: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  vi.mocked(getAppPreferences).mockResolvedValue({ autocompleteEnabled: true });
  vi.mocked(fetchDanbooruTags).mockResolvedValue(DANBOORU);
  vi.mocked(fetchCustomWords).mockResolvedValue(CUSTOM);
  vi.mocked(fetchLoraNames).mockResolvedValue(['plus-lora']);
  vi.mocked(fetchEmbeddingNames).mockResolvedValue(['plus-emb']);
  vi.mocked(fetchCustomScriptsLoraNames).mockResolvedValue(['cs-lora']);
  vi.mocked(fetchCoreEmbeddingNames).mockResolvedValue(['core-emb']);
});

describe('useAutocompleteStore source detection', () => {
  it('is available when only Custom-Scripts is detected', async () => {
    vi.mocked(isAutocompletePlusAvailable).mockResolvedValue(false);
    vi.mocked(isCustomScriptsAvailable).mockResolvedValue(true);

    await useAutocompleteStore.getState().ensureInitialized();

    const state = useAutocompleteStore.getState();
    expect(state.available).toBe(true);
    expect(state.plusAvailable).toBe(false);
    expect(state.customScriptsAvailable).toBe(true);
  });

  it('stays dark when neither source is detected', async () => {
    vi.mocked(isAutocompletePlusAvailable).mockResolvedValue(false);
    vi.mocked(isCustomScriptsAvailable).mockResolvedValue(false);

    await useAutocompleteStore.getState().ensureInitialized();

    expect(useAutocompleteStore.getState().available).toBe(false);
  });
});

describe('useAutocompleteStore data loading', () => {
  it('with only Custom-Scripts: custom words + its loras + core embeddings', async () => {
    useAutocompleteStore.setState({ customScriptsAvailable: true });

    await useAutocompleteStore.getState().ensureData();

    const state = useAutocompleteStore.getState();
    expect(state.dataStatus).toBe('ready');
    expect(state.tags).toEqual(CUSTOM);
    expect(state.loras).toEqual(['cs-lora']);
    expect(state.embeddings).toEqual(['core-emb']);
    expect(fetchDanbooruTags).not.toHaveBeenCalled();
  });

  it('with only Autocomplete-Plus: danbooru table + its name lists', async () => {
    useAutocompleteStore.setState({ plusAvailable: true });

    await useAutocompleteStore.getState().ensureData();

    const state = useAutocompleteStore.getState();
    expect(state.tags).toEqual(DANBOORU);
    expect(state.loras).toEqual(['plus-lora']);
    expect(state.embeddings).toEqual(['plus-emb']);
    expect(fetchCustomWords).not.toHaveBeenCalled();
    expect(fetchCustomScriptsLoraNames).not.toHaveBeenCalled();
  });

  it('with both sources: merged tag table, Plus name lists win', async () => {
    useAutocompleteStore.setState({ plusAvailable: true, customScriptsAvailable: true });

    await useAutocompleteStore.getState().ensureData();

    const state = useAutocompleteStore.getState();
    expect(state.tags.map((t) => t.tag)).toEqual(['long_hair', 'my_style']);
    expect(state.loras).toEqual(['plus-lora']);
    expect(state.embeddings).toEqual(['plus-emb']);
  });
});
