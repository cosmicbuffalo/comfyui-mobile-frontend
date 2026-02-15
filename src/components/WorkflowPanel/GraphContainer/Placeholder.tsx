import { PlusIcon } from '@/components/icons';

type GraphContainerType = 'group' | 'subgraph';

interface GraphContainerPlaceholderProps {
  containerType: GraphContainerType;
  containerId: string | number;
  hiddenNodeCount?: number;
  borderColor: string;
  dashedBorderColor: string;
  onClick?: () => void;
}

export function GraphContainerPlaceholder({
  containerType,
  containerId,
  hiddenNodeCount = 0,
  borderColor,
  dashedBorderColor,
  onClick
}: GraphContainerPlaceholderProps) {
  const label = containerType === 'group' ? 'group' : 'subgraph';
  return (
    <div
      id={`${containerType}-placeholder-${containerId}`}
      className="flex items-center justify-center px-4 pb-4 pt-2"
      style={{ borderColor }}
    >
      <button
        type="button"
        onClick={onClick}
        className="w-full rounded-lg border-2 border-dashed flex flex-col items-center justify-center py-4 hover:bg-white/40 transition-colors"
        style={{ borderColor: dashedBorderColor }}
      >
        <span className="text-sm text-gray-400 select-none">
          {hiddenNodeCount > 0
            ? `${hiddenNodeCount} hidden node${hiddenNodeCount !== 1 ? 's' : ''} in ${label}`
            : `No nodes in ${label}`}
        </span>
        <span className="text-xs text-gray-500 select-none mt-1 inline-flex items-center gap-1">
          <PlusIcon className="w-3 h-3" />
          Click to add a node
        </span>
      </button>
    </div>
  );
}
