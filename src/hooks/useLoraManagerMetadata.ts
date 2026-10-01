import { useEffect, useMemo } from "react";
import { create } from "zustand";
import {
  fetchAllModels,
  fetchLoraManagerModel,
  fetchMissingStandalone,
  getCivitaiStatus,
  getPopulateStatus,
  refreshLoraManagerModels,
  resolveModelProvider,
  scanLoraManagerModels,
  scanStandaloneModels,
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
  // Whether this app may ask for CivitAI lookups (the server-wide "Fetch model
  // details from CivitAI" switch). null until the server has said.
  civitaiEnabled: boolean | null;
  setCivitaiEnabled: (enabled: boolean) => void;
  // True while a manual "refresh model metadata" pass is running.
  refreshing: boolean;
  // Brief success state shown by the Server-menu button after a completed pass.
  refreshDone: boolean;
  // Set when a metadata refresh aborts partway (network failure etc.) so the
  // menu can say so instead of silently flipping back to idle.
  refreshError: string | null;
  setRefreshError: (message: string | null) => void;
  // Human-readable progress label for the manual refresh, or null when idle.
  refreshLabel: string | null;
  ensureAvailable: () => void;
  ensurePrefixLoaded: (prefix: LoraManagerPrefix) => void;
  lookup: (prefix: LoraManagerPrefix, value: unknown) => LoraManagerModel | null;
  // Automatic lookups must identify the actual file, without the display
  // lookup's filename fallback binding a new path to an older model.
  lookupExact: (prefix: LoraManagerPrefix, value: unknown) => LoraManagerModel | null;
  // Rescan and fetch missing Civitai metadata across all model kinds. Uses Lora
  // Manager when installed and the built-in standalone provider otherwise.
  refreshAllMetadata: () => void;
  // A model widget shows a model the catalog has no metadata for: look it up.
  // Batched per kind, and each value is asked about once per session.
  requestMissingMetadata: (prefix: LoraManagerPrefix, value: string) => void;
}

const ALL_PREFIXES: LoraManagerPrefix[] = [
  "checkpoints",
  "loras",
  "embeddings",
];

function emptyPrefixState(): PrefixState {
  return { status: "idle", byPath: new Map(), byFileName: new Map() };
}

// Mirrors MODEL_EXTENSIONS in model_metadata.py. Combo values without one
// ("None", a placeholder) aren't model files and are never looked up.
const MODEL_EXTENSIONS = [
  ".safetensors", ".ckpt", ".pt", ".pt2", ".pth",
  ".bin", ".sft", ".gguf", ".pkl",
];

export function isModelFileName(value: string): boolean {
  const lower = value.toLowerCase();
  return MODEL_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// True when a catalog entry (or its absence) means there is nothing on this
// model yet: not in the catalog at all, or in it without CivitAI data and not
// already known to be missing from CivitAI.
export function needsMetadata(model: LoraManagerModel | null): boolean {
  if (!model) return true;
  if (model.civitai && model.civitai.id) return false;
  return model.from_civitai !== false;
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
const REFRESH_DONE_DURATION_MS = 5_000;
let refreshDoneTimer: ReturnType<typeof setTimeout> | null = null;
let civitaiProbe: Promise<void> | null = null;

// Automatic lookups. Values seen this session (per kind, lower-cased), values
// waiting for the batch timer, and one chain per kind so batches never overlap.
const AUTO_FETCH_DEBOUNCE_MS = 1_000;
const autoRequested = new Set<string>();
const autoPending: Partial<Record<LoraManagerPrefix, Set<string>>> = {};
const autoTimers: Partial<Record<LoraManagerPrefix, ReturnType<typeof setTimeout>>> = {};
const autoChains: Partial<Record<LoraManagerPrefix, Promise<void>>> = {};

// Test hook: forget what has been asked about and drop queued batches.
export function resetAutoFetchForTests(): void {
  autoRequested.clear();
  for (const prefix of ALL_PREFIXES) {
    delete autoPending[prefix];
    const timer = autoTimers[prefix];
    if (timer) clearTimeout(timer);
    delete autoTimers[prefix];
    delete autoChains[prefix];
  }
  civitaiProbe = null;
}

export const useLoraManagerMetadataStore = create<LoraManagerMetadataState>(
  (set, get) => {
    // Re-fetch a prefix and swap in fresh lookup maps (used after population
    // makes progress). Keeps status "ready" so the picker stays usable.
    const reloadPrefix = async (prefix: LoraManagerPrefix) => {
      const models = await fetchAllModels(prefix);
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
            await reloadPrefix(prefix);
          }
        } else if (++stalledPolls >= MAX_STALLED_POLLS) {
          break;
        }
        if (!status.running) break;
      }
      await reloadPrefix(prefix);
    };

    // Values asked about while lookups were off were skipped, not looked up.
    // Forget them on the way back on, so the mounted controls (whose effect
    // re-runs on the switch) can ask again instead of waiting for a reload.
    const applyCivitaiEnabled = (enabled: boolean) => {
      if (enabled && get().civitaiEnabled === false) autoRequested.clear();
      set({ civitaiEnabled: enabled });
    };

    // Look up the batched values for one kind. Lora Manager first rescans so a
    // file added since its last scan is in its catalog, then is asked about each
    // value still missing metadata; our backend resolves the values itself.
    const runAutoFetch = async (prefix: LoraManagerPrefix, values: string[]) => {
      if (get().civitaiEnabled !== true) return;
      const provider = await resolveModelProvider();
      if (!provider) return;
      if (provider.standalone) {
        if (await fetchMissingStandalone(prefix, values)) await reloadPrefix(prefix);
        return;
      }
      // Our backend refuses its own lookups when the switch is off, but Lora
      // Manager knows nothing about it: this page is the only gate. A value
      // cached here can outlive an admin turning lookups off elsewhere, so ask
      // again before every batch, and treat an unanswered check as off.
      const enabled = await getCivitaiStatus()
        .then((status) => status.enabled)
        .catch(() => false);
      applyCivitaiEnabled(enabled);
      if (!enabled) return;
      await scanLoraManagerModels(prefix);
      await reloadPrefix(prefix);
      let fetched = false;
      for (const value of values) {
        // The switch can be turned off while a batch is working through.
        if (get().civitaiEnabled !== true) break;
        const model = get().lookupExact(prefix, value);
        // Not in LM's catalog even after a scan: no such file here.
        if (!model || !needsMetadata(model) || !model.file_path) continue;
        if (await fetchLoraManagerModel(prefix, model.file_path)) fetched = true;
      }
      if (fetched) await reloadPrefix(prefix);
    };

    const flushAutoFetch = (prefix: LoraManagerPrefix) => {
      delete autoTimers[prefix];
      const values = [...(autoPending[prefix] ?? [])];
      delete autoPending[prefix];
      if (values.length === 0) return;
      const previous = autoChains[prefix] ?? Promise.resolve();
      const next = previous
        .then(() => runAutoFetch(prefix, values))
        .catch((err) => {
          console.warn(`Automatic metadata lookup for ${prefix} failed:`, err);
        });
      autoChains[prefix] = next;
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
      civitaiEnabled: null,
      setCivitaiEnabled: applyCivitaiEnabled,
      refreshing: false,
      refreshDone: false,
      refreshError: null,
      setRefreshError: (message) => set({ refreshError: message }),
      refreshLabel: null,
      prefixes: {
        loras: emptyPrefixState(),
        checkpoints: emptyPrefixState(),
        embeddings: emptyPrefixState(),
      },

      ensureAvailable: () => {
        // Ask once whether CivitAI lookups are on; a failure leaves it unknown
        // (so nothing is looked up automatically) and is retried next call.
        if (get().civitaiEnabled === null && !civitaiProbe) {
          civitaiProbe = getCivitaiStatus()
            .then((status) => {
              // A Settings change may have landed while this was in flight.
              if (get().civitaiEnabled === null) {
                applyCivitaiEnabled(status.enabled);
              }
            })
            .catch(() => {
              civitaiProbe = null;
            });
        }
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

      lookupExact: (prefix, value) => {
        if (typeof value !== "string" || !value) return null;
        return get().prefixes[prefix].byPath.get(normalizePath(value)) ?? null;
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
        if (get().refreshing) return;
        if (refreshDoneTimer !== null) {
          clearTimeout(refreshDoneTimer);
          refreshDoneTimer = null;
        }
        set({
          refreshing: true,
          refreshDone: false,
          refreshLabel: "",
          refreshError: null,
        });
        void (async () => {
          try {
            const provider = await resolveModelProvider();
            if (!provider) {
              throw new Error("Model metadata provider is unavailable");
            }
            // With CivitAI lookups off, the refresh only picks up new files.
            const civitaiEnabled = await getCivitaiStatus()
              .then((status) => status.enabled)
              .catch(() => get().civitaiEnabled === true);
            applyCivitaiEnabled(civitaiEnabled);

            // One bad prefix (an unconfigured checkpoints dir, a transient
            // 500) must not cost the others their refresh: record the
            // failure, move on, and report it once the rest have run.
            const failedPrefixes: string[] = [];
            for (const prefix of ALL_PREFIXES) {
              set({ refreshLabel: `${prefix}…` });

              // force=false: only hash/fetch models missing metadata. Cheap and
              // idempotent — won't re-hash an already-identified library or
              // re-download previews. (Models confirmed absent from Civitai are
              // recorded and skipped on subsequent runs.)
              const runStandalonePopulate = async () => {
                const started = await triggerPopulate(prefix, false);
                if (!started) {
                  throw new Error(`Metadata refresh failed to start for ${prefix}`);
                }
                await drainPopulate(
                  prefix,
                  (processed, total) => {
                    set({ refreshLabel: `${prefix}… ${processed}/${total}` });
                  },
                );
              };

              try {
                if (!civitaiEnabled) {
                  const scanned = provider.standalone
                    ? await scanStandaloneModels(prefix)
                    : await scanLoraManagerModels(prefix);
                  if (!scanned) throw new Error(`Model scan failed for ${prefix}`);
                  await reloadPrefix(prefix);
                  continue;
                }
                if (!provider.standalone) {
                  // LM's metadata pass reads its own cached catalog, so scan first
                  // to include files copied or downloaded since its last refresh.
                  // The bundled fetcher ships with this app and writes the same
                  // shared sidecars, so an LM build without these endpoints — or
                  // a scan another run already holds — falls back to it rather
                  // than costing the prefix its refresh.
                  const refreshed = await refreshLoraManagerModels(prefix).catch(() => false);
                  if (!refreshed) await runStandalonePopulate();
                  await reloadPrefix(prefix);
                  continue;
                }

                await runStandalonePopulate();
              } catch {
                failedPrefixes.push(prefix);
              }
            }
            if (failedPrefixes.length === ALL_PREFIXES.length) {
              throw new Error("Metadata refresh failed for every prefix");
            }
            if (failedPrefixes.length > 0) {
              set({
                refreshing: false,
                refreshDone: false,
                refreshLabel: null,
                refreshError: `Metadata refresh skipped ${failedPrefixes.join(", ")} — check the connection and run it again.`,
              });
              return;
            }
            set({
              refreshing: false,
              refreshDone: true,
              refreshLabel: null,
            });
            refreshDoneTimer = setTimeout(() => {
              refreshDoneTimer = null;
              set({ refreshDone: false });
            }, REFRESH_DONE_DURATION_MS);
          } catch {
            set({
              refreshing: false,
              refreshDone: false,
              refreshLabel: null,
              refreshError: "Metadata refresh stopped partway — check the connection and run it again.",
            });
          }
        })();
      },

      requestMissingMetadata: (prefix, value) => {
        if (get().civitaiEnabled !== true || !isModelFileName(value)) return;
        const key = `${prefix}\u0000${normalizePath(value)}`;
        if (autoRequested.has(key)) return;
        autoRequested.add(key);
        (autoPending[prefix] ??= new Set()).add(value);
        if (autoTimers[prefix]) clearTimeout(autoTimers[prefix]);
        autoTimers[prefix] = setTimeout(
          () => flushAutoFetch(prefix),
          AUTO_FETCH_DEBOUNCE_MS,
        );
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

// Watches one model widget's value and asks for a lookup when the loaded
// catalog has no metadata for it — a model added since the catalog was built,
// or one never looked up. Does nothing while CivitAI lookups are off.
export function useAutoFetchModelMetadata(
  kind: LoraManagerPrefix | null,
  value: unknown,
): void {
  const civitaiEnabled = useLoraManagerMetadataStore((s) => s.civitaiEnabled);
  const prefixState = useLoraManagerMetadataStore((s) =>
    kind ? s.prefixes[kind] : undefined,
  );
  const lookup = useLoraManagerMetadataStore((s) => s.lookupExact);
  const requestMissingMetadata = useLoraManagerMetadataStore(
    (s) => s.requestMissingMetadata,
  );

  useEffect(() => {
    if (!kind || civitaiEnabled !== true || prefixState?.status !== "ready") return;
    if (typeof value !== "string" || !isModelFileName(value)) return;
    if (!needsMetadata(lookup(kind, value))) return;
    requestMissingMetadata(kind, value);
  }, [kind, value, civitaiEnabled, prefixState, lookup, requestMissingMetadata]);
}
