import { type FilterState, type SortState, type StatusFilterKey } from '@/hooks/useOutputs';
import type { SortMode } from '@/api/client';
import { OptionSection } from './OptionSection';
import { FavoritesSection } from './FavoritesSection';
import { CloseButton } from '@/components/buttons/CloseButton';
import { useI18n } from '@/i18n';

interface FilterModalProps {
  open: boolean;
  onClose: () => void;
  filter: FilterState;
  sort: SortState;
  onChangeFilter: (filter: Partial<FilterState>) => void;
  /** Advance one status filter through off → only → exclude → off. */
  onCycleStatusFilter: (key: StatusFilterKey) => void;
  onChangeSort: (sort: SortState) => void;
  zIndex?: number;
  /** Hide the File Type section (e.g. the move picker, which lists folders). */
  hideTypeFilter?: boolean;
}

export function FilterModal({
  open, onClose, filter, sort, onChangeFilter, onCycleStatusFilter, onChangeSort,
  zIndex = 1600, hideTypeFilter = false
}: FilterModalProps) {
  const { t } = useI18n();
  if (!open) return null;

  // Derived state for UI - handle potential undefined mode from old persisted state
  const mode = sort?.mode || 'created';
  const currentField = mode.startsWith('name')
    ? 'name'
    : mode.startsWith('size')
      ? 'size'
      : mode.startsWith('created')
        ? 'created'
        : 'modified';
  const currentOrder = (() => {
    const isReverse = mode.endsWith('reverse');
    if (currentField === 'created' || currentField === 'modified') {
      return isReverse ? 'asc' : 'desc';
    }
    return isReverse ? 'desc' : 'asc';
  })();

  // Helper to change sort
  const handleSortChange = (
    field: 'name' | 'size' | 'created' | 'modified',
    order: 'asc' | 'desc',
  ) => {
    let mode: SortMode;
    if (field === 'name') {
      // API: 'name' = A-Z, 'name-reverse' = Z-A
      mode = order === 'asc' ? 'name' : 'name-reverse';
    } else if (field === 'size') {
      mode = order === 'asc' ? 'size' : 'size-reverse';
    } else if (field === 'created') {
      mode = order === 'desc' ? 'created' : 'created-reverse';
    } else {
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
          <h3 id="filter-modal-title" className="font-semibold text-slate-100">{t('Filter & Sort')}</h3>
          <CloseButton variant="plain" onClick={onClose} buttonSize={8} iconSize={6} />
        </div>

        <div id="filter-modal-body" className="p-4 space-y-6">
          {!hideTypeFilter && (
            <OptionSection<FilterState['type']>
              idPrefix="filter-type-group"
              title={t('File Type')}
              items={[
                { value: 'all', label: t('All') },
                { value: 'image', label: t('Image') },
                { value: 'video', label: t('Video') }
              ]}
              selectedValue={filter.type}
              onSelect={(type) => onChangeFilter({ type })}
              gridClassName="flex gap-2"
              buttonClassName="flex-1"
            />
          )}
          <FavoritesSection
            favoritesMode={filter.favoritesMode}
            rejectsMode={filter.rejectsMode}
            onCycleFavorites={() => onCycleStatusFilter('favoritesMode')}
            onCycleRejects={() => onCycleStatusFilter('rejectsMode')}
            showRejects={!hideTypeFilter}
          />
          <OptionSection<'name' | 'size' | 'created' | 'modified'>
            idPrefix="sort-group"
            title={t('Sort By')}
              items={[
                {
                  value: 'name',
                  label: t('Name'),
                suffix: currentField === 'name' ? (currentOrder === 'asc' ? ' ↓' : ' ↑') : undefined
              },
              {
                value: 'size',
                  label: t('Size'),
                suffix: currentField === 'size' ? (currentOrder === 'desc' ? ' ↓' : ' ↑') : undefined
              },
              {
                value: 'created',
                label: t('Created'),
                suffix: currentField === 'created' ? (currentOrder === 'desc' ? ' ↓' : ' ↑') : undefined
              },
              {
                value: 'modified',
                label: t('Modified'),
                suffix: currentField === 'modified' ? (currentOrder === 'desc' ? ' ↓' : ' ↑') : undefined
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
