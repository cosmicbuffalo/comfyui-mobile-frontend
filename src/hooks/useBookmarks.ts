import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore, type SeedMode } from '@/hooks/useWorkflow';
import { useSeedStore } from '@/hooks/useSeed';
import { useWorkflowLineageStore } from '@/hooks/useWorkflowLineage';

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
  /** Shrunk to a single button, so the gutter is out of the way of the list. */
  bookmarkBarCollapsed: boolean;
  /**
   * Where the collapsed button sits, kept apart from the expanded bar's offset.
   * A full-height bar often cannot open where a 40px button was parked, so
   * expanding moves it — and the button must still come back to where it was
   * left. The SIDE stays shared: the two are one gutter, on one edge.
   */
  bookmarkBarCollapsedTop: number | null;
  bookmarkRepositioningActive: boolean;
  toggleBookmark: (itemKey: string) => void;
  clearBookmarks: () => void;
  setBookmarkBarPosition: (position: {
    side?: 'left' | 'right';
    top?: number | null;
    collapsedTop?: number | null;
  }) => void;
  setBookmarkBarCollapsed: (collapsed: boolean) => void;
  setBookmarkRepositioningActive: (active: boolean) => void;
}

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
      bookmarkBarCollapsed: false,
      bookmarkBarCollapsedTop: null,
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

        // The lineage is the durable, roaming copy; savedWorkflowStates above
        // stays as the local mirror so bookmarks still work offline and before
        // the registry has synced.
        const lineageId = useWorkflowStore.getState().currentLineageId;
        if (lineageId) {
          const lineageStore = useWorkflowLineageStore.getState();
          // Apply the toggle to the family's own set rather than overwriting
          // it with `nextBookmarkedItems`. That is the *display* set —
          // filtered to nodes this variant has — so a full rewrite would drop
          // a mark another variant carries: invisible here, it could never be
          // re-added. (`display ⊆ lineage`, so the add/remove both hold.)
          const familySet = lineageStore.getBookmarks(lineageId);
          lineageStore.setBookmarks(
            lineageId,
            exists
              ? familySet.filter((key) => key !== itemKey)
              : Array.from(new Set([...familySet, itemKey])),
          );
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
        const lineageId = useWorkflowStore.getState().currentLineageId;
        if (lineageId) {
          useWorkflowLineageStore.getState().setBookmarks(lineageId, []);
        }
        set({ bookmarkedItems: [] });
      },
      setBookmarkBarPosition: (position) => {
        set((state) => ({
          bookmarkBarSide: position.side ?? state.bookmarkBarSide,
          bookmarkBarTop: position.top ?? state.bookmarkBarTop,
          bookmarkBarCollapsedTop:
            position.collapsedTop ?? state.bookmarkBarCollapsedTop,
        }));
      },
      setBookmarkBarCollapsed: (collapsed) => {
        set({ bookmarkBarCollapsed: collapsed });
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
        bookmarkBarCollapsed: state.bookmarkBarCollapsed,
        bookmarkBarCollapsedTop: state.bookmarkBarCollapsedTop,
      }),
    }
  )
);

/**
 * Where this workflow's bookmarks come from.
 *
 * The lineage — the workflow *family*, shared by every descendant — is the
 * source of truth when one is resolved, which is what lets bookmarks survive
 * the tweak-and-save-as-a-new-name loop that changes the structural cache key
 * and orphans everything attached to it. `savedWorkflowStates` remains the
 * local mirror, used before the registry has resolved and when it is
 * unreachable.
 */
function resolveBookmarkSource(): string[] {
  const { currentWorkflowKey, currentLineageId, savedWorkflowStates } =
    useWorkflowStore.getState();
  if (currentLineageId) {
    const lineageStore = useWorkflowLineageStore.getState();
    const lineage = lineageStore.registry.lineages.find(
      (entry) => entry.id === currentLineageId,
    );
    if (lineage) return lineage.bookmarks;
  }
  if (!currentWorkflowKey) return [];
  const savedState = savedWorkflowStates[currentWorkflowKey] as
    | SavedWorkflowState
    | undefined;
  return savedState?.bookmarkedItems ?? [];
}

function syncBookmarksFromWorkflowState(): void {
  const { workflow, currentWorkflowKey, currentLineageId } = useWorkflowStore.getState();
  const { bookmarkedItems } = useBookmarksStore.getState();

  if (!workflow) {
    if (bookmarkedItems.length > 0) {
      useBookmarksStore.setState({ bookmarkedItems: [] });
    }
    return;
  }

  if (!currentWorkflowKey && !currentLineageId) {
    const validBookmarks = getValidStableBookmarks(bookmarkedItems);
    if (!areStringArraysEqual(bookmarkedItems, validBookmarks)) {
      useBookmarksStore.setState({ bookmarkedItems: validBookmarks });
    }
    return;
  }

  // Marks on nodes this variant does not have are filtered for display but
  // left on the lineage: a sibling further along the family may still have
  // that node, and dropping them here would delete them for everyone.
  const validBookmarks = getValidStableBookmarks(resolveBookmarkSource());
  if (!areStringArraysEqual(bookmarkedItems, validBookmarks)) {
    useBookmarksStore.setState({ bookmarkedItems: validBookmarks });
  }
}

useWorkflowStore.subscribe(() => {
  syncBookmarksFromWorkflowState();
});

// A bookmark added on another tab or device lands in the registry, not the
// workflow store, so the lineage needs its own subscription to surface it.
useWorkflowLineageStore.subscribe(() => {
  syncBookmarksFromWorkflowState();
});
