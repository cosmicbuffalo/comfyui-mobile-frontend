import { getFileWorkflowAvailability, type AssetSource, type FileItem } from '@/api/client';
import { resolveFilePath, resolveFileSource } from '@/utils/workflowOperations';

// Whether a file can yield a workflow, keyed by path *and* the file's
// modification stamp, so replacing a file at the same path (e.g. re-saving an
// image without embedded workflow metadata) invalidates the cached answer
// instead of leaving Load Workflow stale until the next page reload.
//
// Module-level rather than per-component so every surface that offers Load
// Workflow — the full-screen viewer, the outputs context menu — shares one
// answer per file: probing from the menu right after viewing the same file
// costs nothing, and the two can never disagree about what is loadable.
const workflowAvailabilityCache = new Map<string, boolean>();

function makeWorkflowAvailabilityCacheKey(
  source: string,
  path: string,
  file?: { modifiedDate?: number; size?: number } | null,
): string {
  return `${source}:${path}:${file?.modifiedDate ?? ''}:${file?.size ?? ''}`;
}

function resolveTarget(file: FileItem, source?: AssetSource) {
  const effectiveSource = source ?? resolveFileSource(file);
  return {
    source: effectiveSource,
    path: resolveFilePath(file, effectiveSource),
  };
}

/**
 * The already-known answer for this file, or undefined if it has never been
 * probed (or the last probe failed). Failures are never cached as `false`: a
 * transient server blip must not permanently hide Load Workflow.
 */
export function getCachedWorkflowAvailability(
  file: FileItem,
  source?: AssetSource,
): boolean | undefined {
  const target = resolveTarget(file, source);
  return workflowAvailabilityCache.get(
    makeWorkflowAvailabilityCacheKey(target.source, target.path, file),
  );
}

/**
 * Ask the server whether this file has a loadable workflow, caching the answer.
 * Videos resolve through their same-basename sibling image server-side, so a
 * clip saved beside its preview frame reports available.
 *
 * Rejects when the request is aborted or fails — callers should treat that as
 * "unknown", not "no".
 */
export async function probeWorkflowAvailability(
  file: FileItem,
  source?: AssetSource,
  options?: { signal?: AbortSignal },
): Promise<boolean> {
  const target = resolveTarget(file, source);
  const available = await getFileWorkflowAvailability(target.path, target.source, options);
  workflowAvailabilityCache.set(
    makeWorkflowAvailabilityCacheKey(target.source, target.path, file),
    available,
  );
  return available;
}

/** Test hook: drop every cached answer. */
export function resetWorkflowAvailabilityCache(): void {
  workflowAvailabilityCache.clear();
}
