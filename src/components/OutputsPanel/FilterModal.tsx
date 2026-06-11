import { type FilterState, type SortState } from '@/hooks/useOutputs';
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
  zIndex?: number;
  /** Hide the File Type section (e.g. the move picker, which lists folders). */
  hideTypeFilter?: boolean;
}

export function FilterModal({
  open, onClose, filter, sort, onChangeFilter, onChangeSort, zIndex = 1600, hideTypeFilter = false
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
      // API: 'name' = A-Z, 'name-reverse' = Z-A
      mode = order === 'asc' ? 'name' : 'name-reverse';
    } else if (field === 'size') {
      mode = order === 'asc' ? 'size' : 'size-reverse';
    } else {
      // API: 'modified' = newest first, 'modified-reverse' = oldest first
      mode = order === 'desc' ? 'modified' : 'modified-reverse';
    }
    onChangeSort({ mode });
  };

  return (
    <div id="filter-modal-root" className="fixed inset-0 bg-black/50 flex items-center justify-center p-4" style={{ zIndex }} onClick={onClose}>
      <div
        id="filter-modal-content"
        className="bg-slate-900 border border-white/10 text-slate-100 rounded-xl shadow-lg w-full max-w-sm max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div id="filter-modal-header" className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 id="filter-modal-title" className="font-semibold text-slate-100">Filter & Sort</h3>
          <CloseButton variant="plain" onClick={onClose} buttonSize={8} iconSize={6} />
        </div>

        <div id="filter-modal-body" className="p-4 space-y-6">
          {!hideTypeFilter && (
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
          )}
          <FavoritesSection
            checked={filter.favoritesOnly}
            onChange={(favoritesOnly) => onChangeFilter({ favoritesOnly })}
          />
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
                suffix: currentField === 'date' ? (currentOrder === 'desc' ? ' ↓' : ' ↑') : undefined
              },
              {
                value: 'size',
                label: 'Size',
                suffix: currentField === 'size' ? (currentOrder === 'desc' ? ' ↓' : ' ↑') : undefined
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
        </div>

        <div id="filter-modal-footer" className="p-4 border-t border-white/10 bg-slate-950/70 flex justify-end">
          <button
             className="px-4 py-2 bg-cyan-500 text-slate-950 rounded-lg text-sm font-semibold hover:bg-cyan-400"
             onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
