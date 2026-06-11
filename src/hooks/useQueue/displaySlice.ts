import type { StateCreator } from 'zustand';
import type { QueueState } from '../useQueue';

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
  | 'previewVisibility'
  | 'previewVisibilityDefault'
  | 'setQueueItemExpanded'
  | 'setQueueItemUserToggled'
  | 'setQueueItemHideImages'
  | 'toggleQueueItemHideImages'
  | 'setShowQueueMetadata'
  | 'toggleShowQueueMetadata'
  | 'setShowQueueTimestamps'
  | 'toggleShowQueueTimestamps'
  | 'setShowPromptPreview'
  | 'toggleShowPromptPreview'
  | 'setPreviewVisibility'
  | 'togglePreviewVisibility'
  | 'setPreviewVisibilityDefault'
>;

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
  previewVisibility: {},
  previewVisibilityDefault: false,

  setQueueItemExpanded: (promptId, expanded) => {
    set((state) => ({
      queueItemExpanded: { ...state.queueItemExpanded, [promptId]: expanded }
    }));
  },

  setQueueItemUserToggled: (promptId, toggled) => {
    set((state) => ({
      queueItemUserToggled: { ...state.queueItemUserToggled, [promptId]: toggled }
    }));
  },

  setQueueItemHideImages: (promptId, hidden) => {
    set((state) => ({
      queueItemHideImages: { ...state.queueItemHideImages, [promptId]: hidden }
    }));
  },

  toggleQueueItemHideImages: (promptId) => {
    set((state) => ({
      queueItemHideImages: {
        ...state.queueItemHideImages,
        [promptId]: !state.queueItemHideImages[promptId]
      }
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

  setPreviewVisibility: (promptId, visible) => {
    set((state) => ({
      previewVisibility: { ...state.previewVisibility, [promptId]: visible }
    }));
  },

  togglePreviewVisibility: (promptId) => {
    set((state) => ({
      previewVisibility: {
        ...state.previewVisibility,
        [promptId]: !state.previewVisibility[promptId]
      }
    }));
  },

  setPreviewVisibilityDefault: (visible) => {
    set({ previewVisibilityDefault: visible });
  },
});
