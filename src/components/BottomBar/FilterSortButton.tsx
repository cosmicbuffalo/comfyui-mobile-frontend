import { FunnelArrowsIcon } from '@/components/icons';
import { useOutputsStore } from '@/hooks/useOutputs';
import {
  appChromeIconButtonClassName,
  appChromeIconButtonFilteredClassName,
  chromeBarButtonClassName,
} from '@/components/chromeStyles';
import { useT } from '@/i18n';

export function FilterSortButton() {
  const t = useT();
  const setFilterModalOpen = useOutputsStore((s) => s.setFilterModalOpen);
  const filter = useOutputsStore((s) => s.filter);
  // Anything that HIDES files from the listing counts; sort only reorders what
  // is already there, so a non-default sort deliberately doesn't light this up.
  const filtered = filter.favoritesMode !== 'off'
    || filter.rejectsMode !== 'off'
    || filter.type !== 'all'
    || Boolean(filter.search);

  return (
    <button
      onClick={() => setFilterModalOpen(true)}
      className={`${chromeBarButtonClassName} ${
        filtered ? `filter-active ${appChromeIconButtonFilteredClassName}` : appChromeIconButtonClassName
      }`}
      aria-label={filtered ? t('Filter and sort (filters applied)') : t('Filter and sort')}
      aria-pressed={filtered}
    >
      <FunnelArrowsIcon className="w-6 h-6" />
    </button>
  );
}
