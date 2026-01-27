import { useOutputsStore } from '@/hooks/useOutputs';
import { FilterSortButton } from './FilterSortButton';
import { SelectionActionButton } from './SelectionActionButton';

export function OutputsActionButton() {
  const selectionMode = useOutputsStore((s) => s.selectionMode);

  if (selectionMode) {
    return <SelectionActionButton />;
  }

  return <FilterSortButton />;
}
