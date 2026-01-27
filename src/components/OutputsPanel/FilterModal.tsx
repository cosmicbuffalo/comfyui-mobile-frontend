import { type FilterState, type SortState } from '@/hooks/useOutputs';
import { XMarkIcon } from '@/components/icons';
import type { SortMode } from '@/api/client';

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
          <button onClick={onClose}><XMarkIcon className="w-6 h-6 text-gray-500" /></button>
        </div>

        <div id="filter-modal-body" className="p-4 space-y-6">
          {/* Sort */}
          <div id="sort-group-container">
            <h4 id="sort-group-label" className="text-sm font-medium text-gray-700 mb-2">Sort By</h4>
            <div id="sort-options-grid" className="grid grid-cols-2 gap-2">
              {(['name', 'date', 'size'] as const).map(field => {
                const isActive = currentField === field;
                // If active, toggle order. If inactive, default to:
                // name -> asc (A-Z)
                // date -> desc (Newest)
                // size -> desc (Largest)
                const nextOrder = isActive
                  ? (currentOrder === 'asc' ? 'desc' : 'asc')
                  : (field === 'name' ? 'asc' : 'desc');

                // Determine what arrow to show if active
                // For name: asc = A-Z (Down arrow? or Up?), usually A->Z is "ascending".
                // For date: desc = Newest (Down arrow?), asc = Oldest.
                // Let's stick to standard arrows: asc=Up, desc=Down.
                // Except for Date, "Newest" (desc) is usually default.
                
                return (
                  <button
                    key={field}
                    className={`sort-option-button px-3 py-2 rounded-lg text-sm border ${isActive ? 'bg-blue-500 border-blue-500 text-white shadow-sm' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                    onClick={() => handleSortChange(field, nextOrder)}
                  >
                    {field === 'name' ? 'Name' : field === 'size' ? 'Size' : 'Date'}
                    {isActive && (currentOrder === 'asc' ? ' ↓' : ' ↑')}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type Filter */}
          <div id="filter-type-group-container">
            <h4 id="filter-type-label" className="text-sm font-medium text-gray-700 mb-2">File Type</h4>
            <div id="filter-type-options" className="flex gap-2">
              {(['all', 'image', 'video'] as const).map(type => (
                <button
                  key={type}
                  className={`filter-type-button flex-1 px-3 py-2 rounded-lg text-sm border ${filter.type === type ? 'bg-blue-500 border-blue-500 text-white shadow-sm' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                  onClick={() => onChangeFilter({ type })}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div id="search-input-container">
            <label id="search-input-label" className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Search by filename..."
              value={filter.search}
              onChange={e => onChangeFilter({ search: e.target.value })}
            />
          </div>

          {/* Favorites */}
          <div id="favorites-toggle-container" className="flex items-center gap-2">
             <input
               type="checkbox"
               id="favOnly"
               checked={filter.favoritesOnly}
               onChange={e => onChangeFilter({ favoritesOnly: e.target.checked })}
               className="rounded text-blue-600 focus:ring-blue-500"
             />
             <label htmlFor="favOnly" className="text-sm text-gray-700">Show Favorites Only</label>
          </div>
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
