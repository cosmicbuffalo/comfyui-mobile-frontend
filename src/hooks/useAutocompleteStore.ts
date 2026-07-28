import { create } from 'zustand';
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
import { getAppPreferences, setAppPreferences } from '@/api/client/preferences';
import {
  getActiveToken,
  mergeTagSources,
  parseToken,
  searchNames,
  searchTags,
  type ActiveToken,
  type Suggestion,
  type TagEntry,
} from '@/utils/autocompleteSearch';

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

const SUGGESTION_LIMIT = 20;

interface AutocompleteState {
  /** Whether any supported autocomplete source is installed (union of the
   * per-source flags below). */
  available: boolean;
  /** Autocomplete-Plus detected with usable tag data. */
  plusAvailable: boolean;
  /** ComfyUI-Custom-Scripts (pysssss) detected. */
  customScriptsAvailable: boolean;
  /** The server-side opt-in preference. */
  enabled: boolean;
  /** Status of the one-time availability + preference probe. */
  initStatus: LoadStatus;
  /** Status of the (lazy) tag/lora/embedding data load. */
  dataStatus: LoadStatus;
  tags: TagEntry[];
  loras: string[];
  embeddings: string[];

  /** Probe availability + read the server preference (runs once). */
  ensureInitialized: () => Promise<void>;
  /** Persist the opt-in to the server, loading data when turning on. */
  setEnabled: (value: boolean) => Promise<void>;
  /** Lazily load tag data; safe to call repeatedly. */
  ensureData: () => Promise<void>;
  /** Compute the token under the caret and its suggestions. */
  getSuggestions: (value: string, caret: number) => {
    token: ActiveToken;
    suggestions: Suggestion[];
  };
}

export const useAutocompleteStore = create<AutocompleteState>((set, get) => ({
  available: false,
  plusAvailable: false,
  customScriptsAvailable: false,
  enabled: false,
  initStatus: 'idle',
  dataStatus: 'idle',
  tags: [],
  loras: [],
  embeddings: [],

  ensureInitialized: async () => {
    if (get().initStatus !== 'idle') return;
    set({ initStatus: 'loading' });
    try {
      const [plusAvailable, customScriptsAvailable, prefs] = await Promise.all([
        isAutocompletePlusAvailable(),
        isCustomScriptsAvailable(),
        getAppPreferences().catch(() => ({ autocompleteEnabled: false })),
      ]);
      const available = plusAvailable || customScriptsAvailable;
      set({
        available,
        plusAvailable,
        customScriptsAvailable,
        enabled: Boolean(prefs.autocompleteEnabled),
        initStatus: 'ready',
      });
      if (available && prefs.autocompleteEnabled) {
        void get().ensureData();
      }
    } catch {
      set({ available: false, initStatus: 'error' });
    }
  },

  setEnabled: async (value) => {
    const previous = get().enabled;
    set({ enabled: value });
    try {
      const prefs = await setAppPreferences({ autocompleteEnabled: value });
      set({ enabled: Boolean(prefs.autocompleteEnabled) });
      if (prefs.autocompleteEnabled) void get().ensureData();
    } catch {
      set({ enabled: previous });
    }
  },

  ensureData: async () => {
    const { dataStatus, plusAvailable, customScriptsAvailable } = get();
    if (dataStatus === 'loading' || dataStatus === 'ready') return;
    set({ dataStatus: 'loading' });
    try {
      // Autocomplete-Plus provides the danbooru tag table plus lora/embedding
      // lists; Custom-Scripts contributes the user's custom word list. When
      // Plus is absent, its name lists are replaced by Custom-Scripts' lora
      // route and ComfyUI core's /embeddings (same folders, so no double-fetch
      // when Plus is present).
      const [danbooruTags, customWords, loras, embeddings] = await Promise.all([
        plusAvailable ? fetchDanbooruTags() : Promise.resolve([]),
        customScriptsAvailable ? fetchCustomWords() : Promise.resolve([]),
        plusAvailable ? fetchLoraNames() : fetchCustomScriptsLoraNames(),
        plusAvailable ? fetchEmbeddingNames() : fetchCoreEmbeddingNames(),
      ]);
      const tags = mergeTagSources(danbooruTags, customWords);
      set({ tags, loras, embeddings, dataStatus: 'ready' });
    } catch {
      set({ dataStatus: 'error' });
    }
  },

  getSuggestions: (value, caret) => {
    const token = getActiveToken(value, caret);
    const { tags, loras, embeddings } = get();
    const parsed = parseToken(token.text);
    let suggestions: Suggestion[] = [];
    if (parsed.kind === 'lora') {
      suggestions = searchNames(loras, parsed.query, 'lora', SUGGESTION_LIMIT);
    } else if (parsed.kind === 'embedding') {
      suggestions = searchNames(embeddings, parsed.query, 'embedding', SUGGESTION_LIMIT);
    } else {
      suggestions = searchTags(tags, parsed.query, SUGGESTION_LIMIT);
    }
    return { token, suggestions };
  },
}));

/** True when autocomplete should actually surface in the editors. */
export function selectAutocompleteActive(state: AutocompleteState): boolean {
  return state.available && state.enabled;
}
