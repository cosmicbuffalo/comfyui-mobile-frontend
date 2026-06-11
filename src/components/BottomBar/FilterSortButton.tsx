import { FunnelArrowsIcon } from '@/components/icons';
import { useOutputsStore } from '@/hooks/useOutputs';
import { appChromeIconButtonClassName, chromeBarButtonClassName } from '@/components/chromeStyles';

export function FilterSortButton() {
  const setFilterModalOpen = useOutputsStore((s) => s.setFilterModalOpen);
  return (
    <button
      onClick={() => setFilterModalOpen(true)}
      className={`${chromeBarButtonClassName} ${appChromeIconButtonClassName}`}
      aria-label="Filter and sort"
    >
      <FunnelArrowsIcon className="w-6 h-6" />
    </button>
  );
}
