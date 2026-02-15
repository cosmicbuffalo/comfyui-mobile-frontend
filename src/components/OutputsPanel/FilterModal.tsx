import { type FilterState, type SortState } from '@/hooks/useOutputs';
import { SearchBar } from '@/components/SearchBar';
import type { SortMode } from '@/api/client';
import { OptionSection } from './OptionSection';
import { FavoritesSection } from './FavoritesSection';
import { CloseButton } from '@/components/buttons/CloseButton';

interface FilterModalProps {
  open: boolean;
  onClose: () => void;
  filter: FilterState;
  sort: SortState;
  onChangeFilter: (filter: Partial<FilterState>) => void;
  onChangeSort: (sort: SortState) => void;
}

export function FilterModal({
  open, onClose, filter, sort, onChangeFilter, onChangeSort
}: FilterModalProps) {
  if (!open) return null;

  // Derived state for UI - handle potential undefined mode from old persisted state
  const mode = sort?.mode || 'modified';
  const currentField = mode.includes('name') ? 'name' : mode.includes('size') ? 'size' : 'date';
  const currentOrder = (() => {
    const isReverse = mode.endsWith('reverse');
    if (currentField === 'date') {
      return isReverse ? 'asc' : 'desc';
    }
    return isReverse ? 'desc' : 'asc';
  })();

  // Helper to change sort
  const handleSortChange = (field: 'name' | 'date' | 'size', order: 'asc' | 'desc') => {
    let mode: SortMode;
    if (field === 'name') {
      // name: A-Z (asc), name-reverse: Z-A (desc)
      // BUT API conventions: 'name' usually means A-Z.
      // Let's check typical ComfyUI API or OS behavior. 
      // Typically 'name' is A-Z. 'name-reverse' is Z-A.
      // So 'asc' -> 'name', 'desc' -> 'name-reverse'
      mode = order === 'asc' ? 'name' : 'name-reverse';
    } else if (field === 'size') {
      mode = order === 'asc' ? 'size' : 'size-reverse';
    } else {
      // date:
      // modified: newest first (desc)
      // modified-reverse: oldest first (asc)
      mode = order === 'desc' ? 'modified' : 'modified-reverse';
    }
    onChangeSort({ mode });
  };

  return (
    <div id="filter-modal-root" className="fixed inset-0 z-[1600] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div id="filter-modal-content" className="bg-white rounded-xl shadow-lg w-full max-w-sm max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div id="filter-modal-header" className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 id="filter-modal-title" className="font-semibold text-gray-900">Filter & Sort</h3>
          <CloseButton variant="plain" onClick={onClose} buttonSize={8} iconSize={6} />
        </div>

        <div id="filter-modal-body" className="p-4 space-y-6">
          <OptionSection<'name' | 'date' | 'size'>
            idPrefix="sort-group"
            title="Sort By"
            items={[
              {
                value: 'name',
                label: 'Name',
                suffix: currentField === 'name' ? (currentOrder === 'asc' ? ' ↓' : ' ↑') : undefined
              },
              {
                value: 'date',
                label: 'Date',
                suffix: currentField === 'date' ? (currentOrder === 'asc' ? ' ↓' : ' ↑') : undefined
              },
              {
                value: 'size',
                label: 'Size',
                suffix: currentField === 'size' ? (currentOrder === 'asc' ? ' ↓' : ' ↑') : undefined
              }
            ]}
            selectedValue={currentField}
            onSelect={(field) => {
              const nextOrder = currentField === field
                ? (currentOrder === 'asc' ? 'desc' : 'asc')
                : (field === 'name' ? 'asc' : 'desc');
              handleSortChange(field, nextOrder);
            }}
          />
          <OptionSection<FilterState['type']>
            idPrefix="filter-type-group"
            title="File Type"
            items={[
              { value: 'all', label: 'All' },
              { value: 'image', label: 'Image' },
              { value: 'video', label: 'Video' }
            ]}
            selectedValue={filter.type}
            onSelect={(type) => onChangeFilter({ type })}
            gridClassName="flex gap-2"
            buttonClassName="flex-1"
          />
          <div id="search-input-container">
            <label id="search-input-label" className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <SearchBar
              placeholder="Search by filename..."
              value={filter.search}
              onChange={(search) => onChangeFilter({ search })}
            />
          </div>
          <FavoritesSection
            checked={filter.favoritesOnly}
            onChange={(favoritesOnly) => onChangeFilter({ favoritesOnly })}
          />
        </div>

        <div id="filter-modal-footer" className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
          <button
             className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
             onClick={onClose}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
