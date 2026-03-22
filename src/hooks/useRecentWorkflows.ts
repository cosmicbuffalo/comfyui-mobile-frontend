import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { WorkflowSource } from "@/hooks/useWorkflow";
import {
  loadRecentWorkflowsFromServer,
  saveRecentWorkflowsToServer,
} from "@/api/client";

export interface RecentWorkflowEntry {
  /** Display name shown to user */
  filename: string;
  /** Source metadata for reloading */
  source: WorkflowSource | null;
  /** Unix timestamp of when it was opened */
  timestamp: number;
}

const MAX_RECENT = 10;

interface RecentWorkflowsState {
  entries: RecentWorkflowEntry[];
  /** Whether an initial sync from the server has been performed */
  serverSynced: boolean;
  addEntry: (filename: string, source: WorkflowSource | null) => void;
  clearEntries: () => void;
  /** Merge server entries with local, keeping the most recent per dedupe key */
  syncFromServer: () => Promise<void>;
  /** Push current entries to the server */
  syncToServer: () => Promise<void>;
}

function dedupeKey(entry: {
  filename: string;
  source: WorkflowSource | null;
}): string {
  if (!entry.source) return `other:${entry.filename}`;
  switch (entry.source.type) {
    case "user":
      return `user:${entry.source.filename}`;
    case "template":
      return `template:${entry.source.moduleName}/${entry.source.templateName}`;
    case "history":
      return `history:${entry.source.promptId}`;
    case "file":
      return `file:${entry.source.assetSource}:${entry.source.filePath}`;
    case "other":
      return `other:${entry.filename}`;
    default:
      return `other:${entry.filename}`;
  }
}

function isValidEntry(entry: unknown): entry is RecentWorkflowEntry {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.filename === "string" &&
    typeof e.timestamp === "number" &&
    (e.source === null || typeof e.source === "object")
  );
}

/** Merge two entry lists, keeping the newest per dedupe key, sorted by most recent first, capped at MAX_RECENT */
function mergeEntries(
  local: RecentWorkflowEntry[],
  remote: RecentWorkflowEntry[],
): RecentWorkflowEntry[] {
  const byKey = new Map<string, RecentWorkflowEntry>();

  // Add remote first, then local overrides if newer
  for (const entry of remote) {
    byKey.set(dedupeKey(entry), entry);
  }
  for (const entry of local) {
    const key = dedupeKey(entry);
    const existing = byKey.get(key);
    if (!existing || entry.timestamp > existing.timestamp) {
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_RECENT);
}

export const useRecentWorkflowsStore = create<RecentWorkflowsState>()(
  persist(
    (set, get) => ({
      entries: [],
      serverSynced: false,

      addEntry: (filename: string, source: WorkflowSource | null) => {
        set((state) => {
          const newEntry: RecentWorkflowEntry = {
            filename,
            source,
            timestamp: Date.now(),
          };
          const key = dedupeKey(newEntry);
          const filtered = state.entries.filter((e) => dedupeKey(e) !== key);
          return { entries: [newEntry, ...filtered].slice(0, MAX_RECENT) };
        });

        // Debounced sync to server after adding an entry
        scheduleServerSync();
      },

      clearEntries: () => {
        set({ entries: [] });
        saveRecentWorkflowsToServer([]);
      },

      syncFromServer: async () => {
        const remote = await loadRecentWorkflowsFromServer();
        const validRemote = remote.filter(isValidEntry);
        if (validRemote.length === 0) {
          set({ serverSynced: true });
          return;
        }
        set((state) => ({
          entries: mergeEntries(state.entries, validRemote),
          serverSynced: true,
        }));
        // Push merged result back so any local-only entries reach the server
        scheduleServerSync();
      },

      syncToServer: async () => {
        const { entries } = get();
        await saveRecentWorkflowsToServer(entries);
      },
    }),
    {
      name: "recent-workflows-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ entries: state.entries }),
    },
  ),
);

// Debounce server sync — wait 5s after last addEntry before pushing
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleServerSync() {
  if (!useRecentWorkflowsStore.getState().serverSynced) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    useRecentWorkflowsStore.getState().syncToServer();
  }, 5000);
}

// Pull from server once on startup after hydration
const unsub = useRecentWorkflowsStore.persist.onFinishHydration(() => {
  unsub();
  useRecentWorkflowsStore.getState().syncFromServer();
});
