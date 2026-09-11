import type { AssetSource } from '@/api/client';
import { splitPathAnnotation } from '@/utils/annotatedPath';

/**
 * Does a built API prompt consume anything the user has hidden?
 *
 * Hiding is not only about what a listing shows. An input hidden because of
 * what it depicts is still in the picture it produces, so a generation that
 * loads one has to inherit the mark — otherwise the output lands in the grid in
 * plain view and the hiding was for nothing. The same holds for a workflow that
 * was never itself hidden: it is what the run CONSUMED that decides, not where
 * the recipe came from.
 *
 * The check is deliberately blind to node type. `getPromptInputImages` reads
 * LoadImage-shaped nodes because it is drawing thumbnails and needs to know
 * which value is an image; this needs the opposite — it must not miss a hidden
 * file because it arrived through a video loader, a custom node, or an input
 * this app has never heard of. Any string that names a hidden path is a
 * reference to it, whatever holds it.
 *
 * Folder marks inherit downwards, mirroring the server: hiding `private/`
 * stores that one path, and every file beneath it is hidden by being beneath
 * it. So each candidate is tested against its own path and every ancestor.
 */

/** Sources a prompt value can name, in the order `annotated_filepath` allows. */
const CANDIDATE_SOURCES: readonly AssetSource[] = ['input', 'output', 'temp'];

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Every id a prompt value could be referring to: the annotated source when it
 * names one, otherwise each source in turn, and each with every ancestor folder
 * so a mark on a directory catches what is inside it.
 */
function candidateIds(value: string): string[] {
  const { path, type } = splitPathAnnotation(value.trim());
  const normalized = normalizePath(path);
  if (!normalized || normalized.includes('..')) return [];

  const segments = normalized.split('/');
  const paths: string[] = [];
  for (let end = 1; end <= segments.length; end += 1) {
    paths.push(segments.slice(0, end).join('/'));
  }

  const sources = type ? [type] : CANDIDATE_SOURCES;
  return sources.flatMap((source) => paths.map((each) => `${source}/${each}`));
}

/**
 * Dot-prefixed files and folders are hidden structurally — the server never
 * stores a mark for them, so they can never appear in `hiddenIds` — but a run
 * that consumes one still has to inherit the mark. Free text often begins
 * with dots (an ellipsis in a prompt), so this only fires when the value
 * plausibly names a file: it carries a source annotation, or its last segment
 * has a file extension. A dot-named FOLDER passed bare (no extension, no
 * annotation) is the accepted miss.
 */
function referencesDotHiddenPath(value: string): boolean {
  const { path, type } = splitPathAnnotation(value.trim());
  const normalized = normalizePath(path);
  if (!normalized || normalized.includes('..')) return false;
  const segments = normalized.split('/');
  const looksLikeFile =
    Boolean(type) || /\.[a-z0-9]{2,4}$/i.test(segments[segments.length - 1]);
  if (!looksLikeFile) return false;
  return segments.some((segment) => segment.startsWith('.'));
}

/** Walk every string an input holds, including inside arrays and objects. */
function collectStrings(value: unknown, out: string[], depth = 0): void {
  if (depth > 4) return;
  if (typeof value === 'string') {
    // A connection is `[nodeId, slot]`, and a node id is a string — but it
    // names no file, and the loop below is bounded anyway.
    if (value.trim()) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) collectStrings(entry, out, depth + 1);
  }
}

export function promptReferencesHiddenFile(
  prompt: unknown,
  hiddenIds: Iterable<string>,
): boolean {
  const hidden = new Set(hiddenIds);
  if (!prompt || typeof prompt !== 'object') return false;

  for (const node of Object.values(prompt as Record<string, unknown>)) {
    if (!node || typeof node !== 'object') continue;
    const inputs = (node as { inputs?: unknown }).inputs;
    if (!inputs || typeof inputs !== 'object') continue;

    const strings: string[] = [];
    collectStrings(inputs, strings);
    for (const value of strings) {
      if (referencesDotHiddenPath(value)) return true;
      if (hidden.size === 0) continue;
      for (const id of candidateIds(value)) {
        if (hidden.has(id)) return true;
      }
    }
  }
  return false;
}
