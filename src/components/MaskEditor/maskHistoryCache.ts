import type { ImageRef } from '@/utils/maskEditor/clipspace';
import type { HistoryEntry } from './maskCanvasEngine';

/**
 * Undo history that outlives one opening of the mask editor.
 *
 * Without this, closing the editor throws the history away, so a mask or paint
 * stroke committed in an earlier session can only be removed by erasing it by
 * hand -- there is nothing to undo back into.
 *
 * The rule is: **history is retained when an edit is SAVED, and only then.**
 * Closing without saving already discards the edit itself, so keeping its
 * history would let Undo re-apply strokes the user had just abandoned. Cancel
 * means cancel.
 *
 * ## Identity across saves
 *
 * Every save writes a new `clipspace-painted-masked-<timestamp>.png`, so the
 * file the node points at is a different one each time -- the ref alone cannot
 * identify "this image" across openings. Each save therefore records that its
 * output continues the lineage the session started from, which chains
 * arbitrarily many saves back to the original image.
 *
 * ## Memory
 *
 * An entry is two full-resolution ImageData buffers. The engine keeps up to 20
 * for small images and scales that count down against a raw-byte budget, with a
 * two-state minimum for very large images. Retaining more than one lineage at a
 * time would still multiply that on a phone, so opening a different image drops
 * the previous lineage's history.
 */

interface RetainedHistory {
  lineage: string;
  width: number;
  height: number;
  entries: HistoryEntry[];
  index: number;
}

let retained: RetainedHistory | null = null;

/**
 * Maps a saved file back to the lineage it belongs to. Small (two short
 * strings per save) and bounded below, so it can outlive the retained buffers.
 */
const lineageBySuccessor = new Map<string, string>();
const MAX_TRACKED_SUCCESSORS = 64;

export function maskRefKey(ref: ImageRef): string {
  return `${ref.type || 'input'}:${ref.subfolder || ''}/${ref.filename}`;
}

/** The lineage an opening ref belongs to: its own key unless a save claimed it. */
export function lineageForRef(ref: ImageRef): string {
  const key = maskRefKey(ref);
  return lineageBySuccessor.get(key) ?? key;
}

/**
 * Read the retained history for a lineage without consuming it.
 *
 * Deliberately non-destructive: opening and then closing without saving must
 * leave the previous save's history intact for the next opening.
 */
export function peekMaskHistory(
  lineage: string,
  width: number,
  height: number,
): { entries: HistoryEntry[]; index: number } | null {
  if (!retained || retained.lineage !== lineage) return null;
  // A different-sized image cannot share history: putImageData would throw, and
  // the entries describe a canvas that no longer exists.
  if (retained.width !== width || retained.height !== height) return null;
  return { entries: retained.entries, index: retained.index };
}

/**
 * Register that a file belongs to a lineage, without storing any buffers.
 *
 * Used when history is rehydrated from storage after a reload: the in-memory
 * map is empty then, so the file the node points at has to be re-attached to
 * its lineage or the next save would start a new one.
 */
export function registerLineage(ref: ImageRef, lineage: string): void {
  const key = maskRefKey(ref);
  if (key !== lineage) lineageBySuccessor.set(key, lineage);
}

/** Record a saved edit's history, and adopt its output file into the lineage. */
export function retainMaskHistory(options: {
  lineage: string;
  savedRef: ImageRef;
  width: number;
  height: number;
  entries: HistoryEntry[];
  index: number;
}): void {
  const { lineage, savedRef, width, height, entries, index } = options;
  retained = { lineage, width, height, entries, index };

  const key = maskRefKey(savedRef);
  if (key !== lineage) {
    lineageBySuccessor.set(key, lineage);
    // Oldest-first eviction; the map only exists to chain recent saves.
    while (lineageBySuccessor.size > MAX_TRACKED_SUCCESSORS) {
      const oldest = lineageBySuccessor.keys().next().value;
      if (oldest === undefined) break;
      lineageBySuccessor.delete(oldest);
    }
  }
}

/** Test seam, and a way to release the buffers if that is ever needed. */
export function clearMaskHistory(): void {
  retained = null;
  lineageBySuccessor.clear();
}
