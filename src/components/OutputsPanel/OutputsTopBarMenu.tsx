import type { RefObject } from 'react';
import { useState } from 'react';
import { useOutputsStore } from '@/hooks/useOutputs';
import { deleteRejectedOutputs, rejectedIdsForSources } from '@/utils/deleteRejectedOutputs';
import { CheckIcon, DiceIcon, DocumentLinesIcon, EyeIcon, EyeOffIcon, FolderIcon, ArrowRightIcon, SearchIcon, TrashIcon } from '@/components/icons';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { Dialog } from '@/components/modals/Dialog';
import { appChromeIconButtonBareClassName } from '@/components/chromeStyles';

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
  // The source the user is actually browsing: Delete rejected only removes
  // files from it, so switching to `input` and deleting can't take outputs with
  // it (and vice versa).
  const source = useOutputsStore((s) => s.source);
  const viewMode = useOutputsStore((s) => s.viewMode);
  const showHidden = useOutputsStore((s) => s.showHidden);
  const searchOpen = useOutputsStore((s) => s.searchOpen);
  const setViewMode = useOutputsStore((s) => s.setViewMode);
  const setSearchOpen = useOutputsStore((s) => s.setSearchOpen);
  const toggleShowHidden = useOutputsStore((s) => s.toggleShowHidden);
  const toggleSelectionMode = useOutputsStore((s) => s.toggleSelectionMode);
  const setNewFolderModalOpen = useOutputsStore((s) => s.setNewFolderModalOpen);
  const rejected = useOutputsStore((s) => s.rejected);
  // Only what this source holds — the count in the label, the visibility of the
  // entry, and the delete itself all read the same list.
  const rejectedHere = rejectedIdsForSources(rejected, [source]);
  const refresh = useOutputsStore((s) => s.refresh);
  const [deleteRejectedOpen, setDeleteRejectedOpen] = useState(false);

  const handleDeleteRejectedClick = () => {
    setDeleteRejectedOpen(true);
    onClose();
  };

  const confirmDeleteRejected = async () => {
    const result = await deleteRejectedOutputs([source]);
    if (result.failed > 0) {
      window.alert(
        `Deleted ${result.deleted} of ${result.attempted} rejected outputs. ${result.failed} could not be deleted and remain marked.`,
      );
    }
    refresh();
    setDeleteRejectedOpen(false);
  };

  const handleNewFolderClick = () => {
    setNewFolderModalOpen(true);
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

  const handleSearchClick = () => {
    setSearchOpen(true);
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
        className={`transition-colors ${appChromeIconButtonBareClassName}`}
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
                key: 'go-to-workflow',
                label: 'Workflow Panel',
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
                key: 'search',
                label: 'Search',
                icon: <SearchIcon className="w-4 h-4" />,
                onClick: handleSearchClick,
                hidden: searchOpen
              },
              {
                key: 'new-folder',
                label: 'New Folder',
                icon: <FolderIcon className="w-4 h-4" />,
                onClick: handleNewFolderClick
              },
              {
                key: 'toggle-hidden',
                label: showHidden ? 'Hide Hidden Files' : 'Show Hidden Files',
                icon: showHidden ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />,
                onClick: handleToggleShowHiddenClick
              },
              {
                key: 'toggle-view',
                label: viewMode === 'grid' ? 'List View' : 'Grid View',
                icon: viewMode === 'grid'
                  ? <DocumentLinesIcon className="w-4 h-4" />
                  : <DiceIcon className="w-4 h-4" />,
                onClick: handleToggleViewModeClick
              },
              {
                key: 'delete-rejected',
                label: `Delete rejected (${rejectedHere.length})`,
                icon: <TrashIcon className="w-4 h-4" />,
                onClick: handleDeleteRejectedClick,
                hidden: rejectedHere.length === 0,
                color: 'danger'
              }
            ]}
          />
        </div>
      )}
      {deleteRejectedOpen && (
        <Dialog
          onClose={() => setDeleteRejectedOpen(false)}
          title="Delete rejected?"
          description={`This will permanently delete ${rejectedHere.length} rejected ${
            rejectedHere.length === 1 ? 'output' : 'outputs'
          } from the server. This cannot be undone.`}
          zIndex={1800}
          actions={[
            {
              label: 'Cancel',
              onClick: () => setDeleteRejectedOpen(false),
              variant: 'secondary'
            },
            {
              label: 'Delete',
              autoFocus: true,
              onClick: confirmDeleteRejected,
              variant: 'danger'
            }
          ]}
        />
      )}
    </div>
  );
}
