import { CheckIcon } from '@/components/icons';
import { getTypeClass } from '@/utils/search';

interface ConnectionSearchResultProps {
  nodeId: number;
  displayName: string;
  pack: string;
  outputName: string;
  outputType: string;
  inputName: string;
  // Staged selection: the user has picked this source in the form but hasn't
  // committed yet. Drives the highlight + right-side checkbox.
  selected: boolean;
  // The source this input is actually wired to right now (before any edit).
  currentlyConnected: boolean;
  onSelect: () => void;
}

export function ConnectionSearchResult({
  nodeId,
  displayName,
  pack,
  outputName,
  outputType,
  inputName,
  selected,
  currentlyConnected,
  onSelect
}: ConnectionSearchResultProps) {
  return (
    <button
      type="button"
      className={`w-full text-left rounded-xl border px-4 py-3 shadow-sm transition ${
        selected
          ? 'border-cyan-400/50 bg-cyan-500/10'
          : 'border-white/10 bg-slate-900/95 hover:bg-slate-800/95 active:scale-[0.998]'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-100 flex items-center gap-2 min-w-0">
            <span className="truncate">
              {displayName} <span className="text-slate-500">#{nodeId}</span>
            </span>
            {currentlyConnected && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 text-[10px] font-medium shrink-0">
                <CheckIcon className="w-3 h-3" />
                Currently connected
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 truncate mt-0.5">
            {pack || 'Core'}
          </div>
          <div className="text-xs text-slate-300 mt-1 inline-flex items-center gap-1.5">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${getTypeClass(outputType)}`}>
              →
            </span>
            <span className="truncate">{outputName}{' -> '}{inputName}</span>
          </div>
        </div>
        <div className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${selected ? 'bg-cyan-500 border-cyan-500 text-slate-950' : 'bg-slate-950 border-white/20'}`}>
          {selected && <CheckIcon className="w-3 h-3" />}
        </div>
      </div>
    </button>
  );
}
