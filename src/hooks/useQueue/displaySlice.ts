import type { StateCreator } from 'zustand';
import type { QueueState } from '../useQueue';
import { touchBoundedMap } from './queueHelpers';

/**
 * Per-item display state and queue-display preferences (expand/collapse, hide
 * images, metadata/timestamp/preview toggles). All pure setters — they only
 * touch their own fields, so they slice cleanly out of the main store.
 */
export type QueueDisplaySlice = Pick<
  QueueState,
  | 'queueItemExpanded'
  | 'queueItemUserToggled'
  | 'queueItemHideImages'
  | 'showQueueMetadata'
  | 'showQueueTimestamps'
  | 'showPromptPreview'
  | 'queueOutputLayout'
  | 'previewVisibility'
  | 'previewVisibilityDefault'
  | 'setQueueItemExpanded'
  | 'setQueueItemUserToggled'
  | 'pruneQueueItemUiState'
  | 'setQueueItemHideImages'
  | 'toggleQueueItemHideImages'
  | 'setShowQueueMetadata'
  | 'toggleShowQueueMetadata'
  | 'setShowQueueTimestamps'
  | 'toggleShowQueueTimestamps'
  | 'setShowPromptPreview'
  | 'toggleShowPromptPreview'
  | 'setQueueOutputLayout'
  | 'toggleQueueOutputLayout'
  | 'setPreviewVisibility'
  | 'togglePreviewVisibility'
  | 'setPreviewVisibilityDefault'
>;

// Hard ceiling on each persisted per-prompt map. Well above any realistic
// on-screen queue, so a user never loses state for a card they can see.
const MAX_PERSISTED_CARD_STATES = 500;

const touchEntry = (map: Record<string, boolean>, promptId: string, value: boolean) =>
  touchBoundedMap(map, promptId, value, MAX_PERSISTED_CARD_STATES);

export const createQueueDisplaySlice: StateCreator<
  QueueState,
  [['zustand/persist', unknown]],
  [],
  QueueDisplaySlice
> = (set) => ({
  queueItemExpanded: {},
  queueItemUserToggled: {},
  queueItemHideImages: {},
  showQueueMetadata: false,
  showQueueTimestamps: false,
  showPromptPreview: false,
  queueOutputLayout: 'tabbed',
  previewVisibility: {},
  previewVisibilityDefault: false,

  setQueueItemExpanded: (promptId, expanded) => {
    set((state) => ({
      queueItemExpanded: touchEntry(state.queueItemExpanded, promptId, expanded),
    }));
  },

  setQueueItemUserToggled: (promptId, toggled) => {
    set((state) => ({
      queueItemUserToggled: touchEntry(state.queueItemUserToggled, promptId, toggled),
    }));
  },

  pruneQueueItemUiState: (keepIds) => {
    // Exact cleanup: drop entries for prompts that no longer exist anywhere.
    // Only safe once the whole history is loaded, which the caller gates on —
    // and since that gate never opens for anyone who hasn't paged back to their
    // oldest run, the per-write cap in touchEntry is what actually bounds these
    // maps. This is the precise pass for when we do know the full set.
    const keep = keepIds instanceof Set ? keepIds : new Set(keepIds);
    const prune = (map: Record<string, boolean>) => {
      const kept = Object.entries(map).filter(([id]) => keep.has(id));
      return kept.length === Object.keys(map).length ? null : Object.fromEntries(kept);
    };
    set((state) => {
      const expanded = prune(state.queueItemExpanded);
      const toggled = prune(state.queueItemUserToggled);
      const hideImages = prune(state.queueItemHideImages);
      const previews = prune(state.previewVisibility);
      if (!expanded && !toggled && !hideImages && !previews) return state;
      return {
        ...(expanded ? { queueItemExpanded: expanded } : {}),
        ...(toggled ? { queueItemUserToggled: toggled } : {}),
        ...(hideImages ? { queueItemHideImages: hideImages } : {}),
        ...(previews ? { previewVisibility: previews } : {}),
      };
    });
  },

  setQueueItemHideImages: (promptId, hidden) => {
    set((state) => ({
      queueItemHideImages: touchEntry(state.queueItemHideImages, promptId, hidden),
    }));
  },

  toggleQueueItemHideImages: (promptId) => {
    set((state) => ({
      queueItemHideImages: touchEntry(
        state.queueItemHideImages,
        promptId,
        !state.queueItemHideImages[promptId],
      ),
    }));
  },

  setShowQueueMetadata: (show) => {
    set({ showQueueMetadata: show });
  },

  toggleShowQueueMetadata: () => {
    set((state) => ({ showQueueMetadata: !state.showQueueMetadata }));
  },

  setShowQueueTimestamps: (show) => {
    set({ showQueueTimestamps: show });
  },

  toggleShowQueueTimestamps: () => {
    set((state) => ({ showQueueTimestamps: !state.showQueueTimestamps }));
  },

  setShowPromptPreview: (show) => {
    set({ showPromptPreview: show });
  },

  toggleShowPromptPreview: () => {
    set((state) => ({ showPromptPreview: !state.showPromptPreview }));
  },

  setQueueOutputLayout: (layout) => {
    set({ queueOutputLayout: layout });
  },

  toggleQueueOutputLayout: () => {
    set((state) => ({
      queueOutputLayout: state.queueOutputLayout === 'tabbed' ? 'stacked' : 'tabbed',
    }));
  },

  setPreviewVisibility: (promptId, visible) => {
    set((state) => ({
      previewVisibility: touchEntry(state.previewVisibility, promptId, visible),
    }));
  },

  togglePreviewVisibility: (promptId) => {
    set((state) => ({
      previewVisibility: touchEntry(
        state.previewVisibility,
        promptId,
        !state.previewVisibility[promptId],
      ),
    }));
  },

  setPreviewVisibilityDefault: (visible) => {
    set({ previewVisibilityDefault: visible });
  },
});
