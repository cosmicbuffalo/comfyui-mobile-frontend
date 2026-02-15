import type { RefObject } from 'react';
import { useOutputsStore } from '@/hooks/useOutputs';
import { CheckIcon, DiceIcon, DocumentLinesIcon, EyeIcon, EyeOffIcon, FolderIcon, ArrowRightIcon, ReloadIcon } from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';

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
  const setNewFolderModalOpen = useOutputsStore((s) => s.setNewFolderModalOpen);

  const handleNewFolderClick = () => {
    setNewFolderModalOpen(true);
    onClose();
  };

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
      <ContextMenuButton
        buttonRef={buttonRef}
        onClick={onToggle}
        ariaLabel="Outputs options"
      />
      {!open ? null : (
        <div
          id="outputs-options-dropdown"
          ref={menuRef}
          className="absolute right-0 top-11 z-50 w-48"
        >
          <ContextMenuBuilder
            items={[
              {
                key: 'toggle-source',
                label: source === 'output' ? 'Switch to inputs' : 'Switch to outputs',
                icon: <ReloadIcon className="w-4 h-4" />,
                onClick: handleToggleSourceClick
              },
              {
                key: 'go-to-workflow',
                label: 'Go to workflow',
                icon: <ArrowRightIcon className="w-3 h-3" />,
                onClick: handleGoToWorkflowClick
              },
              {
                key: 'select',
                label: 'Select',
                icon: <CheckIcon className="w-4 h-4" />,
                onClick: handleToggleSelectionClick
              },
              {
                key: 'new-folder',
                label: 'New folder',
                icon: <FolderIcon className="w-4 h-4" />,
                onClick: handleNewFolderClick
              },
              {
                key: 'toggle-hidden',
                label: showHidden ? 'Hide hidden files' : 'Show hidden files',
                icon: showHidden ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />,
                onClick: handleToggleShowHiddenClick
              },
              {
                key: 'toggle-view',
                label: viewMode === 'grid' ? 'List view' : 'Grid view',
                icon: viewMode === 'grid'
                  ? <DocumentLinesIcon className="w-4 h-4" />
                  : <DiceIcon className="w-4 h-4" />,
                onClick: handleToggleViewModeClick
              }
            ]}
          />
        </div>
      )}
    </div>
  );
}
