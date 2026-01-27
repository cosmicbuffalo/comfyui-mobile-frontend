import { FunnelArrowsIcon } from '@/components/icons';
import { useOutputsStore } from '@/hooks/useOutputs';

export function FilterSortButton() {
  const setFilterModalOpen = useOutputsStore((s) => s.setFilterModalOpen);
  return (
    <button
      onClick={() => setFilterModalOpen(true)}
      className="relative w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200"
      aria-label="Filter and sort"
    >
      <FunnelArrowsIcon className="w-6 h-6" />
    </button>
  );
}
