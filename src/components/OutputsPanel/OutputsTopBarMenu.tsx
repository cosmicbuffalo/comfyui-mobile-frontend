import type { RefObject } from 'react';
import { useOutputsStore } from '@/hooks/useOutputs';
import { CheckIcon, DiceIcon, DocumentLinesIcon, EllipsisVerticalIcon, EyeIcon, EyeOffIcon, MoveIcon, ReloadIcon } from '@/components/icons';

interface OutputsTopBarMenuProps {
  open: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  menuRef: RefObject<HTMLDivElement | null>;
  onToggle: () => void;
  onClose: () => void;
  onGoToWorkflow: () => void;
}

export function OutputsTopBarMenu({
  open,
  buttonRef,
  menuRef,
  onToggle,
  onClose,
  onGoToWorkflow
}: OutputsTopBarMenuProps) {
  const source = useOutputsStore((s) => s.source);
  const viewMode = useOutputsStore((s) => s.viewMode);
  const showHidden = useOutputsStore((s) => s.showHidden);
  const setSource = useOutputsStore((s) => s.setSource);
  const setViewMode = useOutputsStore((s) => s.setViewMode);
  const toggleShowHidden = useOutputsStore((s) => s.toggleShowHidden);
  const toggleSelectionMode = useOutputsStore((s) => s.toggleSelectionMode);

  const handleToggleSourceClick = () => {
    setSource(source === 'output' ? 'input' : 'output');
    onClose();
  };

  const handleGoToWorkflowClick = () => {
    onGoToWorkflow();
    onClose();
  };

  const handleToggleSelectionClick = () => {
    toggleSelectionMode();
    onClose();
  };

  const handleToggleShowHiddenClick = () => {
    toggleShowHidden();
    onClose();
  };

  const handleToggleViewModeClick = () => {
    setViewMode(viewMode === 'grid' ? 'list' : 'grid');
    onClose();
  };

  return (
    <div id="outputs-topbar-actions" className="relative flex items-center gap-1">
      <button
        ref={buttonRef}
        onClick={onToggle}
        className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100"
        aria-label="Outputs options"
      >
        <EllipsisVerticalIcon className="w-5 h-5 -rotate-90" />
      </button>
      {!open ? null : (
        <div
          id="outputs-options-dropdown"
          ref={menuRef}
          className="absolute right-0 top-11 z-50 w-48 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
        >
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleToggleSourceClick}
          >
            <ReloadIcon className="w-4 h-4 text-gray-500" />
            {source === 'output' ? 'Switch to inputs' : 'Switch to outputs'}
          </button>
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleGoToWorkflowClick}
          >
            <MoveIcon className="w-3 h-3 text-gray-500" />
            Go to workflow
          </button>
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleToggleSelectionClick}
          >
            <CheckIcon className="w-4 h-4 text-gray-500" />
            Select
          </button>
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleToggleShowHiddenClick}
          >
            {showHidden ? <EyeOffIcon className="w-4 h-4 text-gray-500" /> : <EyeIcon className="w-4 h-4 text-gray-500" />}
            {showHidden ? 'Hide hidden files' : 'Show hidden files'}
          </button>
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleToggleViewModeClick}
          >
            {viewMode === 'grid' ? <DocumentLinesIcon className="w-4 h-4 text-gray-500" /> : <DiceIcon className="w-4 h-4 text-gray-500" />}
            {viewMode === 'grid' ? 'List view' : 'Grid view'}
          </button>
        </div>
      )}
    </div>
  );
}
