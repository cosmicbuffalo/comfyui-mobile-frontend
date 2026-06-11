// HTTP access to model-metadata for the rich model picker.
//
// Two interchangeable providers expose the same response shape:
//   * Lora Manager (preferred when installed) under `/api/lm/...`
//   * Our built-in standalone provider under `/mobile/api/models/...`, which
//     reads/writes the same on-disk sidecars LM uses (see model_metadata.py).
//
// `preview_url` values are same-origin relative URLs usable directly as an
// <img>/<video> src. These are kept separate from src/api/client.ts (which holds
// the node-registration / trigger-word LM calls) so the display-metadata layer
// stays self-contained.

export type LoraManagerPrefix = "loras" | "checkpoints" | "embeddings";

// A resolved metadata provider. `standalone` is true for our built-in backend
// (which supports background population); false for Lora Manager.
export interface ModelMetadataProvider {
  base: string;
  standalone: boolean;
}

// Resolves a combo widget value (a model filename/path) to its Lora Manager
// metadata, or null when there's no match. Provided to ComboControl to enable
// rich model rows.
export type ModelLookup = (value: string) => LoraManagerModel | null;

export interface LoraManagerCivitai {
  id?: number;
  modelId?: number;
  name?: string; // version label (e.g. "v1.0")
  trainedWords?: string[];
}

export interface LoraManagerModel {
  model_name: string;
  file_name: string; // stem, no extension
  preview_url: string; // already a usable relative URL; may end .mp4/.webm
  base_model: string; // e.g. "Illustrious", "SDXL 1.0", "Flux.1 D"
  folder: string;
  sha256: string;
  file_path: string; // absolute, forward slashes, includes extension
  file_size: number;
  sub_type: string; // lora | locon | dora | checkpoint | diffusion_model | embedding
  favorite?: boolean;
  civitai?: LoraManagerCivitai | null;
}

interface ModelListResponse {
  items: LoraManagerModel[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Our built-in standalone backend. Always present (it ships with this app) and
// is both a display provider AND the engine behind on-demand metadata refresh —
// the refresh path uses this directly even when Lora Manager is the display
// provider, since it's our own Civitai fetcher writing shared sidecars.
const STANDALONE_BASE = "/mobile/api/models";

async function probeHealth(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/health-check`);
    if (!response.ok) return false;
    const data = (await response.json()) as { status?: string };
    return data?.status === "ok";
  } catch {
    return false;
  }
}

// Resolve which provider feeds the picker, memoized for the session. Prefers Lora
// Manager when installed; otherwise uses our built-in standalone backend. Returns
// null only if neither responds. Fails closed.
let providerProbe: Promise<ModelMetadataProvider | null> | null = null;
let lastNegativeProbeAt = 0;
// Cooldown after a failed/empty probe before we re-poke the health endpoints.
const NEGATIVE_PROBE_COOLDOWN_MS = 10_000;
export function resolveModelProvider(): Promise<ModelMetadataProvider | null> {
  if (!providerProbe) {
    // Within the cooldown after a failure, return the cached negative result so a
    // page full of model widgets doesn't re-poke both /health-check endpoints on
    // every mount while the backend is down. The cooldown still lets a backend
    // that comes up later be picked up on the next probe.
    if (lastNegativeProbeAt && Date.now() - lastNegativeProbeAt < NEGATIVE_PROBE_COOLDOWN_MS) {
      return Promise.resolve(null);
    }
    const probe = (async () => {
      if (await probeHealth("/api/lm")) {
        return { base: "/api/lm", standalone: false };
      }
      if (await probeHealth(STANDALONE_BASE)) {
        return { base: STANDALONE_BASE, standalone: true };
      }
      return null;
    })();
    providerProbe = probe;
    // Only memoize a *successful* provider. A null/failed probe (e.g. a
    // transient outage while the backend is still starting up) must not disable
    // the rich picker for the whole session — clear it (and start the cooldown)
    // so a later call retries.
    void probe
      .then((result) => {
        if (!result && providerProbe === probe) {
          providerProbe = null;
          lastNegativeProbeAt = Date.now();
        } else if (result) {
          lastNegativeProbeAt = 0;
        }
      })
      .catch(() => {
        if (providerProbe === probe) {
          providerProbe = null;
          lastNegativeProbeAt = Date.now();
        }
      });
  }
  return providerProbe;
}

const PAGE_SIZE = 500;

// Fetch every model of a given type from a specific base, walking all pages.
async function fetchModelsFrom(
  base: string,
  prefix: LoraManagerPrefix,
): Promise<LoraManagerModel[]> {
  const items: LoraManagerModel[] = [];
  let page = 1;
  let totalPages = 1;
  try {
    do {
      const response = await fetch(
        `${base}/${prefix}/list?page=${page}&page_size=${PAGE_SIZE}`,
      );
      if (!response.ok) break;
      const data = (await response.json()) as ModelListResponse;
      if (Array.isArray(data?.items)) items.push(...data.items);
      totalPages = Number(data?.total_pages) || 1;
      page += 1;
    } while (page <= totalPages);
  } catch {
    // Return whatever we collected; lookups for missing models fall back to filename.
  }
  return items;
}

// Fetch every model of a given type from the active display provider. Returns []
// on failure so a transient error degrades gracefully to plain-filename dropdowns.
export async function fetchAllModels(
  prefix: LoraManagerPrefix,
): Promise<LoraManagerModel[]> {
  const provider = await resolveModelProvider();
  if (!provider) return [];
  return fetchModelsFrom(provider.base, prefix);
}

// Fetch models from our standalone backend specifically (used after an on-demand
// refresh so the picker reflects the sidecars we just wrote, even under LM).
export async function fetchStandaloneModels(
  prefix: LoraManagerPrefix,
): Promise<LoraManagerModel[]> {
  return fetchModelsFrom(STANDALONE_BASE, prefix);
}

export interface PopulateStatus {
  running: boolean;
  total: number;
  processed: number;
  updated: number;
}

// Kick off a Civitai metadata population pass on our standalone backend. With
// `force`, re-fetches every model; otherwise only those missing metadata. Always
// targets the standalone engine (this is our fetcher), regardless of which
// provider feeds the picker. Returns null if the backend isn't reachable.
export async function triggerPopulate(
  prefix: LoraManagerPrefix,
  force = false,
): Promise<PopulateStatus | null> {
  try {
    const response = await fetch(
      `${STANDALONE_BASE}/${prefix}/fetch-all-civitai`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      },
    );
    if (!response.ok) return null;
    return (await response.json()) as PopulateStatus;
  } catch {
    return null;
  }
}

// Poll the population progress for a prefix on our standalone backend.
export async function getPopulateStatus(
  prefix: LoraManagerPrefix,
): Promise<PopulateStatus | null> {
  try {
    const response = await fetch(`${STANDALONE_BASE}/${prefix}/fetch-status`);
    if (!response.ok) return null;
    return (await response.json()) as PopulateStatus;
  } catch {
    return null;
  }
}
