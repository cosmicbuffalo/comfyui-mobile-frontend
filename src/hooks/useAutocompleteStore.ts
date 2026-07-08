import { create } from 'zustand';
import {
  fetchDanbooruTags,
  fetchEmbeddingNames,
  fetchLoraNames,
  isAutocompletePlusAvailable,
} from '@/api/autocompletePlusClient';
import { getAppPreferences, setAppPreferences } from '@/api/client/preferences';
import {
  getActiveToken,
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
  /** Whether the Autocomplete-Plus node is installed with usable data. */
  available: boolean;
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
      const [available, prefs] = await Promise.all([
        isAutocompletePlusAvailable(),
        getAppPreferences().catch(() => ({ autocompleteEnabled: false })),
      ]);
      set({ available, enabled: Boolean(prefs.autocompleteEnabled), initStatus: 'ready' });
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
    const { dataStatus } = get();
    if (dataStatus === 'loading' || dataStatus === 'ready') return;
    set({ dataStatus: 'loading' });
    try {
      const [tags, loras, embeddings] = await Promise.all([
        fetchDanbooruTags(),
        fetchLoraNames(),
        fetchEmbeddingNames(),
      ]);
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
