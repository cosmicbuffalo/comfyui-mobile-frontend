import type { ReactNode } from 'react';

interface OutputsPanelHeaderProps {
  breadcrumbs: ReactNode;
  selectionMode: boolean;
  selectedCount: number;
  onClearSelection: () => void;
}

export function OutputsPanelHeader({
  breadcrumbs,
  selectionMode,
  selectedCount,
  onClearSelection
}: OutputsPanelHeaderProps) {
  return (
    <div id="outputs-panel-header" className="px-4 py-3 flex flex-col gap-3 border-b border-gray-100">
      <div id="outputs-header-top-row" className="flex items-center justify-between min-h-[24px]">
        {breadcrumbs}
        {selectionMode && (
          <div className="selection-status-container flex items-center gap-2 shrink-0 ml-2">
            <span className="text-[10px] font-bold text-blue-600 uppercase">{selectedCount} selected</span>
            <button
              onClick={onClearSelection}
              className="text-[10px] text-gray-500 underline uppercase font-bold"
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
