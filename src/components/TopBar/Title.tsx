import { EyeOffIcon } from '@/components/icons';

interface TopBarTitleProps {
  title: string;
  mode?: 'workflow' | 'queue' | 'outputs';
  isDirty: boolean;
  hasWorkflow: boolean;
  nodeCountLabel: string;
  historyLength: number;
  pendingLength: number;
  onTap: () => void;
  isHidden?: boolean;
}

export function TopBarTitle({
  title,
  mode,
  isDirty,
  hasWorkflow,
  nodeCountLabel,
  historyLength,
  pendingLength,
  onTap,
  isHidden = false,
}: TopBarTitleProps) {
  return (
    <div id="top-bar-title-container" className="grid h-11 w-full min-w-0 grid-rows-[1.75rem_1rem] px-2 text-center cursor-pointer" onClick={onTap}>
      <h1 id="top-bar-title" className="flex h-7 w-full min-w-0 items-center justify-center overflow-hidden text-base font-semibold leading-7 text-slate-100">
        {mode === 'workflow' && isHidden && (
          <EyeOffIcon className="mr-1 h-3.5 w-3.5 shrink-0 text-slate-400" />
        )}
        <span
          data-workflow-hidden={mode === 'workflow' && isHidden}
          className={`min-w-0 truncate text-center ${mode === 'workflow' && isHidden ? 'italic text-slate-400' : ''}`}
        >
          {title}
        </span>
        {mode === 'workflow' && isDirty && <span id="dirty-indicator" className="text-cyan-300 ml-1 font-bold">*</span>}
      </h1>
      {/* Always render the subtitle line (with a non-breaking-space fallback)
          so the top bar keeps a constant height across all three panels and
          the buttons don't shift vertically when swiping between them. */}
      <p className="top-bar-subtitle h-4 w-full truncate text-center text-xs text-slate-400 leading-4">
        {mode === 'workflow'
          ? (hasWorkflow ? nodeCountLabel : ' ')
          : mode === 'queue'
            ? `${historyLength} ${historyLength === 1 ? 'run' : 'runs'}${pendingLength > 0 ? ` (${pendingLength} pending)` : ''}`
            : ' '}
      </p>
    </div>
  );
}
