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
  collapsedItems?: Record<string, boolean>;
  hiddenItems?: Record<string, boolean>;
  bookmarkedItems?: string[];
}

interface BookmarksState {
  bookmarkedItems: string[];
  bookmarkBarSide: 'left' | 'right';
  bookmarkBarTop: number | null;
  bookmarkRepositioningActive: boolean;
  toggleBookmark: (itemKey: string) => void;
  clearBookmarks: () => void;
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
  collapsedItems: Record<string, boolean>,
  hiddenItems: Record<string, boolean>
): SavedWorkflowState {
  return {
    nodes: buildSavedNodeStates(workflow.nodes),
    seedModes: { ...seedModes },
    collapsedItems: { ...collapsedItems },
    hiddenItems: { ...hiddenItems },
  };
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getValidStableBookmarks(items: string[]): string[] {
  const { workflow } = useWorkflowStore.getState();
  if (!workflow) return [];
  const validHierarchicalKeys = new Set<string>();
  for (const node of workflow.nodes ?? []) {
    if (node.itemKey) validHierarchicalKeys.add(node.itemKey);
  }
  for (const group of workflow.groups ?? []) {
    if (group.itemKey) validHierarchicalKeys.add(group.itemKey);
  }
  for (const subgraph of workflow.definitions?.subgraphs ?? []) {
    if (subgraph.itemKey) validHierarchicalKeys.add(subgraph.itemKey);
    for (const node of subgraph.nodes ?? []) {
      if (node.itemKey) validHierarchicalKeys.add(node.itemKey);
    }
    for (const group of subgraph.groups ?? []) {
      if (group.itemKey) validHierarchicalKeys.add(group.itemKey);
    }
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const itemKey of items) {
    if (!itemKey || seen.has(itemKey)) continue;
    if (!validHierarchicalKeys.has(itemKey)) continue;
    seen.add(itemKey);
    result.push(itemKey);
  }
  return result;
}

export const useBookmarksStore = create<BookmarksState>()(
  persist(
    (set, get) => ({
      bookmarkedItems: [],
      bookmarkBarSide: 'right',
      bookmarkBarTop: null,
      bookmarkRepositioningActive: false,
      toggleBookmark: (itemKey) => {
        if (!itemKey) return;
        const { bookmarkedItems } = get();
        const {
          currentWorkflowKey,
          savedWorkflowStates,
          workflow,
          collapsedItems,
          hiddenItems,
        } = useWorkflowStore.getState();
        const seedModes = useSeedStore.getState().seedModes;

        const exists = bookmarkedItems.includes(itemKey);
        const nextBookmarkedItems = exists
          ? bookmarkedItems.filter((key) => key !== itemKey)
          : bookmarkedItems.length >= MAX_BOOKMARKS
            ? bookmarkedItems
            : [...bookmarkedItems, itemKey];

        if (nextBookmarkedItems === bookmarkedItems) return;

        if (currentWorkflowKey) {
          const savedState = savedWorkflowStates[currentWorkflowKey] as SavedWorkflowState | undefined;
          let nextSavedState = savedState;
          if (!nextSavedState && workflow) {
            nextSavedState = createSavedWorkflowState(
              workflow,
              seedModes,
              collapsedItems,
              hiddenItems
            );
          }
          if (nextSavedState) {
            useWorkflowStore.setState({
              savedWorkflowStates: {
                ...savedWorkflowStates,
                [currentWorkflowKey]: {
                  ...nextSavedState,
                  bookmarkedItems: [...nextBookmarkedItems],
                }
              }
            });
          }
        }

        set({ bookmarkedItems: nextBookmarkedItems });
      },
      clearBookmarks: () => {
        const { currentWorkflowKey, savedWorkflowStates } = useWorkflowStore.getState();
        if (currentWorkflowKey && savedWorkflowStates[currentWorkflowKey]) {
          const savedState = savedWorkflowStates[currentWorkflowKey] as SavedWorkflowState;
          useWorkflowStore.setState({
            savedWorkflowStates: {
              ...savedWorkflowStates,
              [currentWorkflowKey]: {
                ...savedState,
                bookmarkedItems: [],
              }
            }
          });
        }
        set({ bookmarkedItems: [] });
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
  const { bookmarkedItems } = useBookmarksStore.getState();

  if (!workflow) {
    if (bookmarkedItems.length > 0) {
      useBookmarksStore.setState({ bookmarkedItems: [] });
    }
    return;
  }

  if (!currentWorkflowKey) {
    const validBookmarks = getValidStableBookmarks(bookmarkedItems);
    if (!areStringArraysEqual(bookmarkedItems, validBookmarks)) {
      useBookmarksStore.setState({ bookmarkedItems: validBookmarks });
    }
    return;
  }

  const savedState = savedWorkflowStates[currentWorkflowKey] as SavedWorkflowState | undefined;
  const validBookmarks = getValidStableBookmarks(savedState?.bookmarkedItems ?? []);
  if (!areStringArraysEqual(bookmarkedItems, validBookmarks)) {
    useBookmarksStore.setState({ bookmarkedItems: validBookmarks });
  }
}

useWorkflowStore.subscribe(() => {
  syncBookmarksFromWorkflowState();
});
