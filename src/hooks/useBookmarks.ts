import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore, type SeedMode } from '@/hooks/useWorkflow';
import { useSeedStore } from '@/hooks/useSeed';

interface SavedNodeState {
  mode?: number;
  flags?: { collapsed?: boolean };
  widgets_values?: unknown[] | Record<string, unknown>;
}

interface SavedWorkflowState {
  nodes: Record<number, SavedNodeState>;
  seedModes: Record<number, SeedMode>;
  collapsedGroups?: Record<number, boolean>;
  hiddenGroups?: Record<number, boolean>;
  collapsedSubgraphs?: Record<string, boolean>;
  hiddenSubgraphs?: Record<string, boolean>;
  bookmarkedNodeIds?: number[];
}

interface BookmarksState {
  bookmarkedNodeIds: number[];
  bookmarkBarSide: 'left' | 'right';
  bookmarkBarTop: number | null;
  bookmarkRepositioningActive: boolean;
  toggleNodeBookmark: (nodeId: number) => void;
  clearNodeBookmarks: () => void;
  setBookmarkBarPosition: (position: { side?: 'left' | 'right'; top?: number | null }) => void;
  setBookmarkRepositioningActive: (active: boolean) => void;
}

const MAX_BOOKMARKS = 5;

function buildSavedNodeStates(nodes: WorkflowNode[]): Record<number, SavedNodeState> {
  const nodeStates: Record<number, SavedNodeState> = {};
  for (const node of nodes) {
    nodeStates[node.id] = {
      mode: node.mode,
      flags: node.flags ? { collapsed: Boolean(node.flags.collapsed) } : undefined,
      widgets_values: node.widgets_values,
    };
  }
  return nodeStates;
}

function createSavedWorkflowState(
  workflow: Workflow,
  seedModes: Record<number, SeedMode>,
  collapsedGroups: Record<number, boolean>,
  hiddenGroups: Record<number, boolean>,
  collapsedSubgraphs: Record<string, boolean>,
  hiddenSubgraphs: Record<string, boolean>
): SavedWorkflowState {
  return {
    nodes: buildSavedNodeStates(workflow.nodes),
    seedModes: { ...seedModes },
    collapsedGroups: { ...collapsedGroups },
    hiddenGroups: { ...hiddenGroups },
    collapsedSubgraphs: { ...collapsedSubgraphs },
    hiddenSubgraphs: { ...hiddenSubgraphs },
  };
}

function getValidBookmarks(
  workflow: Workflow | null,
  savedBookmarks: number[]
): number[] {
  if (!workflow) return [];
  if (!savedBookmarks.length) return [];
  const validNodeIds = new Set(workflow.nodes.map((node) => node.id));
  return savedBookmarks.filter((id) => validNodeIds.has(id));
}

function areArraysEqual(a: number[], b: number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      bookmarkedNodeIds: [],
      bookmarkBarSide: 'right',
      bookmarkBarTop: null,
      bookmarkRepositioningActive: false,
      toggleNodeBookmark: (nodeId) => {
        const { bookmarkedNodeIds } = get();
        const {
          currentWorkflowKey,
          savedWorkflowStates,
          workflow,
          collapsedGroups,
          hiddenGroups,
          collapsedSubgraphs,
          hiddenSubgraphs,
        } = useWorkflowStore.getState();
        const seedModes = useSeedStore.getState().seedModes;

        const exists = bookmarkedNodeIds.includes(nodeId);
        const nextBookmarks = exists
          ? bookmarkedNodeIds.filter((id) => id !== nodeId)
          : bookmarkedNodeIds.length >= MAX_BOOKMARKS
            ? bookmarkedNodeIds
            : [...bookmarkedNodeIds, nodeId];

        if (nextBookmarks === bookmarkedNodeIds) return;

        if (currentWorkflowKey) {
          const savedState = savedWorkflowStates[currentWorkflowKey] as SavedWorkflowState | undefined;
          let nextSavedState = savedState;
          if (!nextSavedState && workflow) {
            nextSavedState = createSavedWorkflowState(
              workflow,
              seedModes,
              collapsedGroups,
              hiddenGroups,
              collapsedSubgraphs,
              hiddenSubgraphs
            );
          }
          if (nextSavedState) {
            useWorkflowStore.setState({
              savedWorkflowStates: {
                ...savedWorkflowStates,
                [currentWorkflowKey]: {
                  ...nextSavedState,
                  bookmarkedNodeIds: [...nextBookmarks],
                }
              }
            });
          }
        }

        set({ bookmarkedNodeIds: nextBookmarks });
      },
      clearNodeBookmarks: () => {
        const { currentWorkflowKey, savedWorkflowStates } = useWorkflowStore.getState();
        if (currentWorkflowKey && savedWorkflowStates[currentWorkflowKey]) {
          const savedState = savedWorkflowStates[currentWorkflowKey] as SavedWorkflowState;
          useWorkflowStore.setState({
            savedWorkflowStates: {
              ...savedWorkflowStates,
              [currentWorkflowKey]: {
                ...savedState,
                bookmarkedNodeIds: [],
              }
            }
          });
        }
        set({ bookmarkedNodeIds: [] });
      },
      setBookmarkBarPosition: (position) => {
        set((state) => ({
          bookmarkBarSide: position.side ?? state.bookmarkBarSide,
          bookmarkBarTop: position.top ?? state.bookmarkBarTop
        }));
      },
      setBookmarkRepositioningActive: (active) => {
        set({ bookmarkRepositioningActive: active });
      },
    }),
    {
      name: 'bookmark-bar-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        bookmarkBarSide: state.bookmarkBarSide,
        bookmarkBarTop: state.bookmarkBarTop,
      }),
    }
  )
);

function syncBookmarksFromWorkflowState(): void {
  const { workflow, currentWorkflowKey, savedWorkflowStates } = useWorkflowStore.getState();
  const { bookmarkedNodeIds } = useBookmarksStore.getState();

  if (!workflow) {
    if (bookmarkedNodeIds.length > 0) {
      useBookmarksStore.setState({ bookmarkedNodeIds: [] });
    }
    return;
  }

  if (!currentWorkflowKey) {
    const validBookmarks = getValidBookmarks(workflow, bookmarkedNodeIds);
    if (!areArraysEqual(bookmarkedNodeIds, validBookmarks)) {
      useBookmarksStore.setState({ bookmarkedNodeIds: validBookmarks });
    }
    return;
  }

  const savedState = savedWorkflowStates[currentWorkflowKey] as SavedWorkflowState | undefined;
  const savedBookmarks = savedState?.bookmarkedNodeIds ?? [];
  const validBookmarks = getValidBookmarks(workflow, savedBookmarks);
  if (!areArraysEqual(bookmarkedNodeIds, validBookmarks)) {
    useBookmarksStore.setState({ bookmarkedNodeIds: validBookmarks });
  }
}

useWorkflowStore.subscribe(() => {
  syncBookmarksFromWorkflowState();
});

syncBookmarksFromWorkflowState();
