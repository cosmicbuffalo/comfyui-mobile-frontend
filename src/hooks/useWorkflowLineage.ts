import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Workflow } from '@/api/types';
import {
  loadLineageRegistryFromServer,
  saveLineageRegistryToServer,
} from '@/api/client';
import {
  buildStructuralFingerprint,
  collectNodeIdentities,
  createEmptyRegistry,
  findLineageById,
  findLineageMatch,
  findMemberByFingerprint,
  generateLineageId,
  mergeRegistries,
  normalizeRegistry,
  readLineageStamp,
  type LineageRegistry,
  type LineageStamp,
} from '@/utils/workflowLineage';

/**
 * A resolved lineage, plus whether this call founded the family. Only a
 * brand-new lineage may be seeded from pre-lineage local bookmarks: seeding
 * an existing one would resurrect bookmarks another device had deliberately
 * cleared, since the local mirror there is still holding the old set.
 */
export type ResolvedLineage = LineageStamp & { createdLineage: boolean };

/**
 * The lineage registry: which workflow families exist, the structural variants
 * (members) within each, and the state hanging off them.
 *
 * Server-backed via ComfyUI's userdata API so a lineage — and the bookmarks on
 * it — follow the user between browsers and devices, which browser-local
 * storage could never do. The local copy is authoritative for reads so a
 * bookmark tap stays instant; writes are optimistic and flushed behind the
 * `serverDirty` flag, matching `useWorkflowHidden`.
 */
interface WorkflowLineageState {
  registry: LineageRegistry;
  serverSynced: boolean;
  serverDirty: boolean;
  /**
   * Whether the first sync attempt has finished — succeeded, 404'd, or failed.
   * Minting a *new* family is gated on this: a workflow opened in the window
   * before the registry arrives would otherwise found a second lineage for a
   * family the server already knows, and the stamp would pin it there. Set on
   * every exit path, failures included, so an offline or server-less session
   * still mints rather than silently losing the feature.
   */
  registryReady: boolean;
  /**
   * Resolve (and if necessary mint) the lineage + member for a loaded
   * workflow. Returns the stamp to carry on that workflow.
   */
  resolveLineage: (workflow: Workflow, options?: { mint?: boolean }) => ResolvedLineage | null;
  getBookmarks: (lineageId: string) => string[];
  setBookmarks: (lineageId: string, bookmarks: string[]) => void;
  syncFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;
}

let serverSyncPromise: Promise<void> | null = null;

export const useWorkflowLineageStore = create<WorkflowLineageState>()(
  persist(
    (set, get) => ({
      registry: createEmptyRegistry(),
      serverSynced: false,
      serverDirty: false,
      registryReady: false,

      resolveLineage: (workflow, options) => {
        // Joining a family this device already knows, and recording a new
        // member inside one, are both safe before the registry lands — only
        // founding a brand-new family is gated (handled at the mint site).
        const mint = options?.mint ?? true;
        const mayFound = options?.mint ?? get().registryReady;
        const fingerprint = buildStructuralFingerprint(workflow);
        const stamp = readLineageStamp(workflow);
        const registry = get().registry;
        const now = Date.now();

        // ── Stamped: trust the id, but the structure may have moved on ──
        if (stamp) {
          const lineage = findLineageById(registry, stamp.lineage);
          if (lineage) {
            const byFingerprint = findMemberByFingerprint(lineage, fingerprint);
            // Structure already known — a repeat open of the same variant.
            if (byFingerprint) {
              return { lineage: lineage.id, member: byFingerprint.id, createdLineage: false };
            }
            if (!mint) {
              return { lineage: lineage.id, member: stamp.member, createdLineage: false };
            }
            // Never-before-seen structure: mint a member under the stamped
            // parent. This is also what retroactively records a structural
            // change that was queued but never saved — the output carried the
            // parent's stamp, and opening it is what mints the real member.
            const parent = lineage.members.some((member) => member.id === stamp.member)
              ? stamp.member
              : null;
            const memberId = generateLineageId();
            set({
              registry: {
                ...registry,
                lineages: registry.lineages.map((entry) =>
                  entry.id !== lineage.id
                    ? entry
                    : {
                        ...entry,
                        updatedAt: now,
                        members: [
                          ...entry.members,
                          {
                            id: memberId,
                            parent,
                            fingerprint,
                            identity: collectNodeIdentities(workflow),
                            createdAt: now,
                          },
                        ],
                      },
                ),
              },
              serverDirty: true,
            });
            void get().syncToServer();
            return { lineage: lineage.id, member: memberId, createdLineage: false };
          }
          // Stamped for a lineage this device has never seen — a workflow
          // shared by someone else, or a registry that was reset. Adopt the
          // ids rather than minting new ones so the family stays intact if the
          // real registry shows up later.
          if (!mint) return { ...stamp, createdLineage: false };
          const memberId = stamp.member;
          set({
            registry: {
              ...registry,
              lineages: [
                ...registry.lineages,
                {
                  id: stamp.lineage,
                  members: [
                    {
                      id: memberId,
                      parent: null,
                      fingerprint,
                      identity: collectNodeIdentities(workflow),
                      createdAt: now,
                    },
                  ],
                  bookmarks: [],
                  createdAt: now,
                  updatedAt: now,
                },
              ],
            },
            serverDirty: true,
          });
          void get().syncToServer();
          // Adopted, not founded: the family exists elsewhere, so its
          // bookmarks are whatever the real registry holds.
          return { ...stamp, createdLineage: false };
        }

        // ── Unstamped: fuzzy-match into a family, or found a new one ──
        const identity = collectNodeIdentities(workflow);
        if (identity.length === 0) return null;
        const match = findLineageMatch(registry, identity);
        if (!mint) {
          return match
            ? { lineage: match.lineageId, member: match.memberId, createdLineage: false }
            : null;
        }

        if (match) {
          const lineage = findLineageById(registry, match.lineageId);
          const existing = lineage ? findMemberByFingerprint(lineage, fingerprint) : null;
          if (existing) {
            return { lineage: match.lineageId, member: existing.id, createdLineage: false };
          }
          const memberId = generateLineageId();
          set({
            registry: {
              ...registry,
              lineages: registry.lineages.map((entry) =>
                entry.id !== match.lineageId
                  ? entry
                  : {
                      ...entry,
                      updatedAt: now,
                      members: [
                        ...entry.members,
                        {
                          id: memberId,
                          // Hang off the closest member, not the lineage root.
                          parent: match.memberId,
                          fingerprint,
                          identity,
                          createdAt: now,
                        },
                      ],
                    },
              ),
            },
            serverDirty: true,
          });
          void get().syncToServer();
          return { lineage: match.lineageId, member: memberId, createdLineage: false };
        }

        if (!mayFound) return null;

        const lineageId = generateLineageId();
        const memberId = generateLineageId();
        set({
          registry: {
            ...registry,
            lineages: [
              ...registry.lineages,
              {
                id: lineageId,
                members: [
                  { id: memberId, parent: null, fingerprint, identity, createdAt: now },
                ],
                bookmarks: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          serverDirty: true,
        });
        void get().syncToServer();
        return { lineage: lineageId, member: memberId, createdLineage: true };
      },

      getBookmarks: (lineageId) => {
        const lineage = findLineageById(get().registry, lineageId);
        return lineage ? lineage.bookmarks : [];
      },

      setBookmarks: (lineageId, bookmarks) => {
        const registry = get().registry;
        const lineage = findLineageById(registry, lineageId);
        if (!lineage) return;
        const next = [...new Set(bookmarks)];
        if (
          next.length === lineage.bookmarks.length &&
          next.every((entry, index) => entry === lineage.bookmarks[index])
        ) {
          return;
        }
        set({
          registry: {
            ...registry,
            lineages: registry.lineages.map((entry) =>
              entry.id === lineageId
                ? { ...entry, bookmarks: next, updatedAt: Date.now() }
                : entry,
            ),
          },
          serverDirty: true,
        });
        void get().syncToServer();
      },

      syncFromServer: async () => {
        const remote = await loadLineageRegistryFromServer();
        if (remote === undefined) {
          // Unreachable. Stay usable offline: mint locally and flush later.
          set({ registryReady: true });
          return;
        }
        if (remote === null) {
          // Nothing on the server yet. Push whatever this device already
          // minted rather than dropping it.
          set({ serverSynced: true, registryReady: true });
          if (get().registry.lineages.length > 0) {
            set({ serverDirty: true });
            await get().syncToServer();
          }
          return;
        }
        // Merge rather than replace: this device may have minted while the
        // request was in flight, and the server copy may hold families this
        // device has never opened. Neither side may erase the other.
        const merged = mergeRegistries(get().registry, normalizeRegistry(remote));
        const localHadUnsent = get().serverDirty || get().registry.lineages.length > 0;
        set({
          registry: merged,
          serverSynced: true,
          registryReady: true,
          serverDirty: localHadUnsent,
        });
        if (localHadUnsent) await get().syncToServer();
      },

      syncToServer: async () => {
        if (!get().serverSynced) return;
        if (serverSyncPromise) return serverSyncPromise;

        serverSyncPromise = (async () => {
          while (get().serverSynced && get().serverDirty) {
            const registry = get().registry;
            try {
              await saveLineageRegistryToServer(registry);
            } catch {
              // Keep the dirty flag so a later load/toggle retries.
              return;
            }
            if (get().registry === registry) set({ serverDirty: false });
          }
        })().finally(() => {
          serverSyncPromise = null;
        });
        return serverSyncPromise;
      },
    }),
    {
      name: 'workflow-lineage-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        registry: state.registry,
        serverDirty: state.serverDirty,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<WorkflowLineageState> | undefined;
        return {
          ...current,
          ...saved,
          registry: normalizeRegistry(saved?.registry),
        };
      },
    },
  ),
);

function syncAfterHydration() {
  void useWorkflowLineageStore.getState().syncFromServer();
}

// Unit tests drive synchronization explicitly and mock the API barrel narrowly,
// so avoid startup network side effects there (mirrors useWorkflowHidden).
if (import.meta.env.MODE !== 'test') {
  if (useWorkflowLineageStore.persist.hasHydrated()) {
    syncAfterHydration();
  } else {
    const unsubscribe = useWorkflowLineageStore.persist.onFinishHydration(() => {
      unsubscribe();
      syncAfterHydration();
    });
  }
}
