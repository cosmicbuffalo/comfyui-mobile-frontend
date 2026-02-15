interface TopBarTitleProps {
  title: string;
  mode?: 'workflow' | 'queue' | 'outputs';
  isDirty: boolean;
  hasWorkflow: boolean;
  nodeCountLabel: string;
  historyLength: number;
  pendingLength: number;
  onTap: () => void;
}

export function TopBarTitle({
  title,
  mode,
  isDirty,
  hasWorkflow,
  nodeCountLabel,
  historyLength,
  pendingLength,
  onTap
}: TopBarTitleProps) {
  return (
    <div id="top-bar-title-container" className="flex-1 text-center min-w-0 px-2 cursor-pointer" onClick={onTap}>
      <h1 id="top-bar-title" className="font-semibold text-gray-900 text-lg truncate flex items-center justify-center">
        <span className="truncate">{title}</span>
        {mode === 'workflow' && isDirty && <span id="dirty-indicator" className="text-blue-500 ml-1 font-bold">*</span>}
      </h1>
      {mode === 'workflow' && hasWorkflow && (
        <p className="node-count-display text-xs text-gray-500">
          {nodeCountLabel}
        </p>
      )}
      {mode === 'queue' && (
        <p className="run-count-display text-xs text-gray-500">
          {historyLength} {historyLength === 1 ? 'run' : 'runs'}
          {pendingLength > 0 && ` (${pendingLength} pending)`}
        </p>
      )}
    </div>
  );
}
