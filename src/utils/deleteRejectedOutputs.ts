import { deleteFile, type AssetSource } from '@/api/client';
import { useOutputsStore } from '@/hooks/useOutputs';
import { useHistoryStore } from '@/hooks/useHistory';

export interface DeleteRejectedResult {
  attempted: number;
  deleted: number;
  failed: number;
}

/**
 * Delete every output currently marked "rejected": remove the files, reconcile
 * history (so queue/outputs cards drop them), and clear the marks that genuinely
 * succeeded — a failed delete stays marked so the list can't wedge. Shared by the
 * outputs panel and the queue panel's "Delete Rejected" actions.
 */
// What the queue panel is entitled to delete: the media it generated. Uploads
// live in `input` and belong to the outputs panel's own source selector.
export const QUEUE_REJECT_SOURCES: AssetSource[] = ['output', 'temp'];

/**
 * Ids of rejected files belonging to `sources`.
 *
 * Reject state is global on purpose — an output rejected from a queue card
 * shows as rejected in the outputs grid too. The DELETE built on it must not
 * be: each panel only has the standing to remove what it shows, so the queue's
 * menu must never delete an input file the user rejected while browsing
 * uploads. Both the menu label's count and the delete itself read this, so the
 * number shown is always the number removed.
 */
export function rejectedIdsForSources(
  rejected: string[],
  sources: AssetSource[],
): string[] {
  const wanted = new Set(sources);
  return rejected.filter((id) => {
    const slash = id.indexOf('/');
    // An id with no source prefix shouldn't exist (getHistoryImageFileId always
    // writes one) but has always been treated as an output; keep that rather
    // than silently skipping a file the user marked.
    const source = slash >= 0 ? id.slice(0, slash) : 'output';
    return wanted.has(source as AssetSource);
  });
}

export async function deleteRejectedOutputs(
  sources: AssetSource[],
): Promise<DeleteRejectedResult> {
  const ids = rejectedIdsForSources(useOutputsStore.getState().rejected, sources);
  if (ids.length === 0) return { attempted: 0, deleted: 0, failed: 0 };

  // allSettled (not all): one un-deletable id must not abort the whole batch and
  // leave every rejected mark stuck. deleteFile treats "already gone" (404) as
  // success, so a rejected promise here is a genuine failure.
  const results = await Promise.allSettled(
    ids.map((id) => {
      // Rejected ids are `${type}/${path}` (output/input/temp). Delete each from
      // the source its type names.
      const slash = id.indexOf('/');
      const source = (slash >= 0 ? id.slice(0, slash) : 'output') as AssetSource;
      const path = slash >= 0 ? id.slice(slash + 1) : id;
      return deleteFile(path, source);
    }),
  );

  const failedIds = ids.filter((_, i) => results[i].status === 'rejected');
  const deletedIds = ids.filter((_, i) => results[i].status === 'fulfilled');
  // Reconcile history so no orphaned card lingers with a now-broken image. The
  // rejected ids are already in the `type/subfolder/filename` file-id format
  // removeOutputImages expects.
  await useHistoryStore.getState().removeOutputImages(deletedIds);

  // Remove only the marks whose files were actually deleted. The batch can
  // take seconds on a slow connection and the panels stay interactive behind
  // the dialog — a wholesale replace would silently unmark anything the user
  // rejected while the deletes were in flight.
  const deletedSet = new Set(deletedIds);
  useOutputsStore.setState((state) => ({
    rejected: state.rejected.filter((id) => !deletedSet.has(id)),
  }));
  if (failedIds.length > 0) {
    console.error(
      'Some rejected outputs could not be deleted:',
      results.filter((r) => r.status === 'rejected'),
    );
  }

  return { attempted: ids.length, deleted: deletedIds.length, failed: failedIds.length };
}
