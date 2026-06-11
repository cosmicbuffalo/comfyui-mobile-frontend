import { useEffect, useMemo } from "react";
import { create } from "zustand";
import {
  fetchAllModels,
  fetchStandaloneModels,
  getPopulateStatus,
  resolveModelProvider,
  triggerPopulate,
  type LoraManagerModel,
  type LoraManagerPrefix,
  type ModelLookup,
} from "@/api/loraManagerClient";

type PrefixStatus = "idle" | "loading" | "ready" | "error";

interface PrefixState {
  status: PrefixStatus;
  byPath: Map<string, LoraManagerModel>;
  byFileName: Map<string, LoraManagerModel>;
}

interface LoraManagerMetadataState {
  // null = not yet probed, true/false = a metadata provider is available or not.
  available: boolean | null;
  // True when the active provider is our built-in standalone backend (which
  // populates Civitai metadata in the background); false for Lora Manager.
  standalone: boolean;
  prefixes: Record<LoraManagerPrefix, PrefixState>;
  // True while a manual "refresh model metadata" pass is running (standalone).
  refreshing: boolean;
  // Set when a metadata refresh aborts partway (network failure etc.) so the
  // menu can say so instead of silently flipping back to idle.
  refreshError: string | null;
  setRefreshError: (message: string | null) => void;
  // Human-readable progress label for the manual refresh, or null when idle.
  refreshLabel: string | null;
  ensureAvailable: () => void;
  ensurePrefixLoaded: (prefix: LoraManagerPrefix) => void;
  lookup: (prefix: LoraManagerPrefix, value: unknown) => LoraManagerModel | null;
  // Force a Civitai re-fetch across all model kinds (standalone only); reloads
  // catalogs live as metadata lands. No-op under Lora Manager.
  refreshAllMetadata: () => void;
}

const ALL_PREFIXES: LoraManagerPrefix[] = [
  "checkpoints",
  "loras",
  "embeddings",
];

function emptyPrefixState(): PrefixState {
  return { status: "idle", byPath: new Map(), byFileName: new Map() };
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

// Build the path/filename lookup indexes from a flat model list.
function buildMaps(models: LoraManagerModel[]): {
  byPath: Map<string, LoraManagerModel>;
  byFileName: Map<string, LoraManagerModel>;
} {
  const byPath = new Map<string, LoraManagerModel>();
  const byFileName = new Map<string, LoraManagerModel>();
  // Stems shared by models in different folders are ambiguous; we drop them from
  // the filename-only index rather than resolve to a wrong guess.
  const ambiguousStems = new Set<string>();
  for (const model of models) {
    // file_path is absolute; ComfyUI widget values are paths relative to the
    // model root, i.e. `<folder>/<basename>`. Key byPath on that relative path
    // (plus the absolute path as a harmless secondary key).
    const basename =
      (model.file_path || "").replace(/\\/g, "/").split("/").pop() ?? "";
    if (basename) {
      const folder = (model.folder || "")
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "");
      const relative = folder ? `${folder}/${basename}` : basename;
      byPath.set(relative.toLowerCase(), model);
    }
    if (model.file_path) byPath.set(normalizePath(model.file_path), model);
    // Filename-only fallback. A stem seen more than once is ambiguous across
    // folders, so remove it entirely — exact paths still resolve via byPath, and
    // an ambiguous bare filename returns no metadata instead of a wrong match.
    const stem = (model.file_name ?? "").toLowerCase();
    if (stem) {
      if (byFileName.has(stem) || ambiguousStems.has(stem)) {
        byFileName.delete(stem);
        ambiguousStems.add(stem);
      } else {
        byFileName.set(stem, model);
      }
    }
  }
  return { byPath, byFileName };
}

// Guards against duplicate concurrent fetches across multiple components.
let availabilityProbe: Promise<void> | null = null;
const prefixProbes: Partial<Record<LoraManagerPrefix, Promise<void>>> = {};
// Ensures the background population loop runs at most once per prefix.
const populateStarted: Partial<Record<LoraManagerPrefix, boolean>> = {};

export const useLoraManagerMetadataStore = create<LoraManagerMetadataState>(
  (set, get) => {
    // Re-fetch a prefix and swap in fresh lookup maps (used after population
    // makes progress). Keeps status "ready" so the picker stays usable. When
    // fromStandalone is set, reads our standalone backend directly so an
    // on-demand refresh shows up even when Lora Manager is the display provider.
    const reloadPrefix = async (
      prefix: LoraManagerPrefix,
      fromStandalone = false,
    ) => {
      const models = fromStandalone
        ? await fetchStandaloneModels(prefix)
        : await fetchAllModels(prefix);
      const { byPath, byFileName } = buildMaps(models);
      set((state) => ({
        prefixes: {
          ...state.prefixes,
          [prefix]: { status: "ready", byPath, byFileName },
        },
      }));
    };

    // Poll a population pass to completion, reloading the catalog whenever it
    // makes progress so the picker fills in live. Optional onProgress reports
    // counts for UI. Assumes the pass has already been triggered.
    const drainPopulate = async (
      prefix: LoraManagerPrefix,
      onProgress?: (processed: number, total: number) => void,
      fromStandalone = false,
    ) => {
      // Bound the poll loop so a backend that never stops reporting
      // `running: true` (a wedged pass) can't spin every 2s for the rest of the
      // session. Bail on a hard cap, or after a stretch of no forward progress.
      const POLL_INTERVAL_MS = 2000;
      const MAX_POLLS = 900; // hard backstop: ~30 min
      const MAX_STALLED_POLLS = 30; // give up after ~60s of no progress
      // Each reloadPrefix swaps the prefix catalog object, which re-renders every
      // model combo of that kind (and rebuilds its option list). Reloading on
      // every 2s progress tick made large libraries thrash for the whole pass, so
      // only paint freshly-populated metadata periodically. Progress (onProgress)
      // still updates every poll — it's cheap and doesn't swap the catalog — and
      // the guaranteed reload after the loop flushes the final state.
      const RELOAD_EVERY_N_PROGRESS = 5; // ~10s at the 2s poll interval
      let lastProcessed = -1;
      let stalledPolls = 0;
      let progressSincePaint = 0;
      for (let poll = 0; poll < MAX_POLLS; poll++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const status = await getPopulateStatus(prefix);
        if (!status) break;
        onProgress?.(status.processed, status.total);
        if (status.processed !== lastProcessed) {
          lastProcessed = status.processed;
          stalledPolls = 0;
          if (++progressSincePaint >= RELOAD_EVERY_N_PROGRESS) {
            progressSincePaint = 0;
            await reloadPrefix(prefix, fromStandalone);
          }
        } else if (++stalledPolls >= MAX_STALLED_POLLS) {
          break;
        }
        if (!status.running) break;
      }
      await reloadPrefix(prefix, fromStandalone);
    };

    // Standalone only: trigger a background Civitai population pass for models
    // missing metadata. Runs once per prefix per session.
    const startBackgroundPopulate = (prefix: LoraManagerPrefix) => {
      if (!get().standalone || populateStarted[prefix]) return;
      populateStarted[prefix] = true;
      void (async () => {
        try {
          const initial = await triggerPopulate(prefix);
          if (!initial) return;
          await drainPopulate(prefix);
        } catch (err) {
          // A transient failure mid-populate must not become an unhandled
          // rejection or wedge the prefix as "started" forever — clear the flag
          // so a later ensurePrefixLoaded can retry this session.
          console.warn(`Background metadata populate for ${prefix} failed:`, err);
          populateStarted[prefix] = false;
        }
      })();
    };

    return {
      available: null,
      standalone: false,
      refreshing: false,
      refreshError: null,
      setRefreshError: (message) => set({ refreshError: message }),
      refreshLabel: null,
      prefixes: {
        loras: emptyPrefixState(),
        checkpoints: emptyPrefixState(),
        embeddings: emptyPrefixState(),
      },

      ensureAvailable: () => {
        // Re-probe while a provider hasn't been confirmed (available null or
        // false) as long as no probe is in flight — a failed/empty first probe
        // (e.g. backend not ready yet) must not permanently disable rich
        // metadata. resolveModelProvider() clears its own memo on transient
        // failures, so a later call genuinely retries.
        if (get().available === true || availabilityProbe) return;
        availabilityProbe = resolveModelProvider()
          .then((provider) =>
            set({
              available: provider !== null,
              standalone: provider?.standalone ?? false,
            }),
          )
          .catch(() => set({ available: false, standalone: false }))
          .finally(() => {
            availabilityProbe = null;
          });
      },

      ensurePrefixLoaded: (prefix) => {
        // Only meaningful once a provider is known to be present.
        if (get().available !== true) return;
        // Allow a retry after a transient failure ("error"), but never while a
        // probe is in flight or the catalog is already loaded.
        const status = get().prefixes[prefix].status;
        if ((status !== "idle" && status !== "error") || prefixProbes[prefix])
          return;

        set((state) => ({
          prefixes: {
            ...state.prefixes,
            [prefix]: { ...state.prefixes[prefix], status: "loading" },
          },
        }));

        prefixProbes[prefix] = fetchAllModels(prefix)
          .then((models) => {
            const { byPath, byFileName } = buildMaps(models);
            set((state) => ({
              prefixes: {
                ...state.prefixes,
                [prefix]: { status: "ready", byPath, byFileName },
              },
            }));
            // After the initial (sidecar-only) load, fill in missing Civitai
            // metadata in the background when running standalone.
            startBackgroundPopulate(prefix);
          })
          .catch(() => {
            set((state) => ({
              prefixes: {
                ...state.prefixes,
                [prefix]: { ...state.prefixes[prefix], status: "error" },
              },
            }));
          })
          .finally(() => {
            // Clear the in-flight marker so a later call can retry after an error
            // (the status guard above prevents redundant reloads once "ready").
            delete prefixProbes[prefix];
          });
      },

      lookup: (prefix, value) => {
        if (value === null || value === undefined) return null;
        const raw = String(value);
        if (!raw) return null;
        const { byPath, byFileName } = get().prefixes[prefix];

        const normalized = normalizePath(raw);
        const byPathMatch = byPath.get(normalized);
        if (byPathMatch) return byPathMatch;

        const basename = normalized.split("/").pop() ?? normalized;
        const stem = basename.replace(/\.[^.]+$/, "");
        return byFileName.get(stem) ?? null;
      },

      refreshAllMetadata: () => {
        // The standalone fetcher ships with the app, so it's always available —
        // including when Lora Manager is the display provider, since this runs
        // our own fetcher writing shared sidecars.
        if (get().refreshing) return;
        set({ refreshing: true, refreshLabel: "", refreshError: null });
        void (async () => {
          try {
            for (const prefix of ALL_PREFIXES) {
              // force=false: only hash/fetch models missing metadata. Cheap and
              // idempotent — won't re-hash an already-identified library or
              // re-download previews. (Models confirmed absent from Civitai are
              // recorded and skipped on subsequent runs.)
              const started = await triggerPopulate(prefix, false);
              if (!started) continue;
              // Reload from the standalone backend so freshly-written sidecars
              // show in the picker even under Lora Manager.
              await drainPopulate(
                prefix,
                (processed, total) => {
                  set({ refreshLabel: `${prefix}… ${processed}/${total}` });
                },
                true,
              );
            }
          } finally {
            set({ refreshing: false, refreshLabel: null });
          }
        })().catch(() => {
          // State is already reset in the finally above; record the abort so
          // the menu can say the refresh ended partway instead of silently
          // flipping back to idle.
          set({ refreshError: "Metadata refresh stopped partway — check the connection and run it again." });
        });
      },
    };
  },
);

// Returns a value→metadata lookup for the given model kind, or undefined when no
// metadata provider is available or kind is null. Lazily probes the provider and
// loads the relevant catalog. The returned function's identity changes when the
// catalog (re)loads so consumers re-render into rich rows. Pass null to no-op.
export function useModelMetadataLookup(
  kind: LoraManagerPrefix | null,
): ModelLookup | undefined {
  const available = useLoraManagerMetadataStore((s) => s.available);
  const ensureAvailable = useLoraManagerMetadataStore((s) => s.ensureAvailable);
  const ensurePrefixLoaded = useLoraManagerMetadataStore(
    (s) => s.ensurePrefixLoaded,
  );
  const lookup = useLoraManagerMetadataStore((s) => s.lookup);
  const prefixState = useLoraManagerMetadataStore((s) =>
    kind ? s.prefixes[kind] : undefined,
  );

  useEffect(() => {
    if (!kind) return;
    ensureAvailable();
    if (available === true) ensurePrefixLoaded(kind);
  }, [kind, available, ensureAvailable, ensurePrefixLoaded]);

  return useMemo(() => {
    if (!kind || available !== true) return undefined;
    // Recompute when the catalog object identity changes (initial load and each
    // background-population reload swap in fresh maps).
    void prefixState;
    return (v: string) => lookup(kind, v);
  }, [kind, available, lookup, prefixState]);
}
