import { useOutputsStore } from '@/hooks/useOutputs';
import { FilterSortButton } from './FilterSortButton';
import { SelectionActionButton } from './SelectionActionButton';

export function OutputsActionButton() {
  const selectionMode = useOutputsStore((s) => s.selectionMode);
  const outputsViewerOpen = useOutputsStore((s) => s.outputsViewerOpen);

  // The viewer covers the listing, so filter/sort has nothing to act on while
  // it is open; the slot becomes the way into select mode instead.
  if (selectionMode || outputsViewerOpen) {
    return <SelectionActionButton />;
  }

  return <FilterSortButton />;
}
