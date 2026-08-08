import {
  fetchCustomNodeList,
  fetchCustomNodeMappings,
  type CustomNodeMappingsResponse,
  type CustomNodePackageMetadata,
  type CustomNodesDataMode,
} from '@/api/customNodesManagerClient';
import { buildCustomNodeRows, type CustomNodeRow } from '@/utils/customNodesManager';

// Module-level cache of the (multi-MB) custom-node list + built rows, shared by
// the Custom Nodes Manager modal and the background prefetch. Survives close/
// reopen within a session so reopening the modal is instant.

export const MANAGER_CACHE_STALE_MS = 60_000;
const DATA_MODE: CustomNodesDataMode = 'cache';

export interface CustomNodesManagerCache {
  nodePacks: Record<string, CustomNodePackageMetadata>;
  mappings: CustomNodeMappingsResponse;
  channel: string;
  rows: CustomNodeRow[];
  fetchedAt: number;
}

let cache: CustomNodesManagerCache | null = null;
let prefetchInFlight: Promise<void> | null = null;

export function getCustomNodesManagerCache(): CustomNodesManagerCache | null {
  return cache;
}

export function setCustomNodesManagerCache(next: CustomNodesManagerCache | null): void {
  cache = next;
}

export function isCustomNodesManagerCacheFresh(): boolean {
  return cache !== null && Date.now() - cache.fetchedAt < MANAGER_CACHE_STALE_MS;
}

/** The in-flight background prefetch, if any, so the modal can await it. */
export function getCustomNodesManagerPrefetch(): Promise<void> | null {
  return prefetchInFlight;
}

/**
 * Best-effort background warm of the manager data into the cache, so opening the
 * modal — e.g. from a missing-node "Install" button — is instant rather than a
 * cold first load. No-ops when the cache is fresh or a prefetch is already
 * running; errors are swallowed (the modal's own load surfaces real errors).
 */
export function prefetchCustomNodesData(): void {
  if (isCustomNodesManagerCacheFresh() || prefetchInFlight) return;
  prefetchInFlight = (async () => {
    try {
      const [listResponse, mappingResponse] = await Promise.all([
        fetchCustomNodeList(DATA_MODE, { skipUpdate: true }),
        fetchCustomNodeMappings(DATA_MODE),
      ]);
      cache = {
        nodePacks: listResponse.node_packs,
        mappings: mappingResponse,
        channel: listResponse.channel,
        rows: buildCustomNodeRows(listResponse.node_packs, { mappings: mappingResponse }),
        fetchedAt: Date.now(),
      };
    } catch {
      // Best-effort — ignore.
    } finally {
      prefetchInFlight = null;
    }
  })();
}
