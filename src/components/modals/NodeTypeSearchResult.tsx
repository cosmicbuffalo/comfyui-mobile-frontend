import { getTypeClass } from '@/utils/search';

interface NodeTypeSearchResultProps {
  title: string;
  subtitle: string;
  onSelect: () => void;
  outputType?: string;
  outputName?: string;
  inputName?: string;
  titleClassName?: string;
}

export function NodeTypeSearchResult({
  title,
  subtitle,
  onSelect,
  outputType,
  outputName,
  inputName,
  titleClassName = 'text-sm font-semibold text-slate-100 truncate'
}: NodeTypeSearchResultProps) {
  return (
    <button
      type="button"
      className="w-full text-left rounded-xl border border-white/10 bg-slate-900/95 px-4 py-3 shadow-sm hover:bg-slate-800/95 active:scale-[0.998] transition"
      onClick={onSelect}
    >
      <div className="min-w-0">
        <div className={titleClassName}>
          {title}
        </div>
        <div className="text-xs text-slate-400 truncate mt-0.5">{subtitle || 'Core'}</div>
        {outputType && outputName && inputName && (
          <div className="text-xs text-slate-300 mt-1 inline-flex items-center gap-1.5">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${getTypeClass(outputType)}`}>
              →
            </span>
            <span className="truncate">{String(outputName)}{' -> '}{inputName}</span>
          </div>
        )}
      </div>
    </button>
  );
}
