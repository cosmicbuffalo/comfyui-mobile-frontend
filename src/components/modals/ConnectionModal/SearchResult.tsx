import { CheckIcon } from '@/components/icons';
import { getTypeClass } from '@/utils/search';

interface ConnectionSearchResultProps {
  nodeId: number;
  displayName: string;
  pack: string;
  outputName: string;
  outputType: string;
  inputName: string;
  isConnected: boolean;
  onSelect: () => void;
}

export function ConnectionSearchResult({
  nodeId,
  displayName,
  pack,
  outputName,
  outputType,
  inputName,
  isConnected,
  onSelect
}: ConnectionSearchResultProps) {
  return (
    <button
      type="button"
      className={`w-full text-left rounded-xl border px-4 py-3 shadow-sm transition ${
        isConnected
          ? 'border-blue-300 bg-white'
          : 'border-gray-200 bg-white hover:border-gray-300 active:scale-[0.998]'
      }`}
      onClick={onSelect}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 flex items-center gap-2 min-w-0">
          <span className="truncate">
            {displayName} <span className="text-gray-400">#{nodeId}</span>
          </span>
          {isConnected && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-medium shrink-0">
              <CheckIcon className="w-3 h-3" />
              Currently connected
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 truncate mt-0.5">
          {pack || 'Core'}
        </div>
        <div className="text-xs text-gray-700 mt-1 inline-flex items-center gap-1.5">
          <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${getTypeClass(outputType)}`}>
            →
          </span>
          <span className="truncate">{outputName}{' -> '}{inputName}</span>
        </div>
      </div>
    </button>
  );
}
