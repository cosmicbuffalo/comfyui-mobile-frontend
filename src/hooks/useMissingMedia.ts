import { create } from 'zustand';
import { getImageUrl } from '@/api/client';
import { getHistoryImageFileId, type HistoryImageSource } from '@/utils/viewerImages';

/**
 * Output files known to be gone, each tied to the RUN that wrote it.
 *
 * ComfyUI's history keeps listing every file a run wrote, forever, and only an
 * entry that loses *all* of its media is deleted server-side. Deleting one
 * output of a multi-output run therefore left its descriptor in the entry, and
 * the next history fetch handed the queue card a thumbnail that 404s.
 *
 * The mark is keyed by prompt id AND file, never by file alone. ComfyUI's
 * counter reuses a deleted file's number (`ComfyUI_00042_.png` comes straight
 * back on the next run), so a path-only mark would hide that NEW output as if
 * it were the deleted one, for the rest of the session. The new run has its own
 * prompt id, so a (run, file) mark cannot touch it.
 *
 * Deliberately in-memory only: an accelerator for what the server would say
 * anyway, not a record. A reload re-asks, and anything genuinely gone 404s
 * again the moment its thumbnail is requested.
 */
export interface MissingMediaRef {
  promptId: string;
  fileId: string;
}

export function missingMediaKey(promptId: string, fileId: string): string {
  return `${promptId}\u0000${fileId}`;
}

interface MissingMediaState {
  missingKeys: string[];
  markMediaMissing: (refs: MissingMediaRef[]) => void;
}

export const useMissingMediaStore = create<MissingMediaState>()((set) => ({
  missingKeys: [],
  markMediaMissing: (refs) => set((state) => {
    const next = new Set(state.missingKeys);
    for (const ref of refs) {
      if (ref.promptId && ref.fileId) next.add(missingMediaKey(ref.promptId, ref.fileId));
    }
    return next.size === state.missingKeys.length ? state : { missingKeys: [...next] };
  }),
}));

export function isMediaMissing(promptId: string, fileId: string): boolean {
  return useMissingMediaStore.getState().missingKeys.includes(missingMediaKey(promptId, fileId));
}

const probedKeys = new Set<string>();

/**
 * A run's thumbnail failed to load. Ask the server whether the file is actually
 * gone before hiding anything: only a 404/410 on the canonical `/view` URL
 * counts. A transient failure (offline, server restarting, 5xx) -- or a
 * thumbnail endpoint that cannot extract a still from a video it otherwise
 * serves fine -- must leave the output where it is.
 */
export function probeMissingMedia(image: HistoryImageSource, promptId: string): void {
  if (!image.filename || !promptId || typeof fetch !== 'function') return;
  const fileId = getHistoryImageFileId(image);
  const key = missingMediaKey(promptId, fileId);
  if (probedKeys.has(key) || isMediaMissing(promptId, fileId)) return;
  probedKeys.add(key);
  const url = getImageUrl(image.filename, image.subfolder, image.type, image.cacheToken);
  void fetch(url, { method: 'HEAD', cache: 'no-store' })
    .then((response) => {
      if (response.status === 404 || response.status === 410) {
        useMissingMediaStore.getState().markMediaMissing([{ promptId, fileId }]);
        return;
      }
      // Still there, or an answer that says nothing about the file: forget the
      // probe so a later failure on the same output can ask again.
      probedKeys.delete(key);
    })
    .catch(() => {
      probedKeys.delete(key);
    });
}

/** Test seam: forget in-flight probe bookkeeping between cases. */
export function resetMissingMediaProbes(): void {
  probedKeys.clear();
}
