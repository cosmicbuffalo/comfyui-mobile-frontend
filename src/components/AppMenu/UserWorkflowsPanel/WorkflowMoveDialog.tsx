import { useState } from 'react';
import { ChevronLeftBoldIcon, FolderIcon } from '@/components/icons';
import { Dialog } from '@/components/modals/Dialog';
import { type UserDataFile } from '@/api/client';
import {
  getRelativePath,
  getDirectChildren,
  getWorkflowParentPath,
  canBrowseWorkflowMoveDestination,
  canMoveWorkflowEntryToDirectory,
} from '../userWorkflowHelpers';

export function WorkflowMoveDialog({
  target,
  userWorkflows,
  onMove,
  onClose,
}: {
  target: UserDataFile;
  userWorkflows: UserDataFile[];
  onMove: (destinationDirectory: string) => void;
  onClose: () => void;
}) {
  const [destinationDirectory, setDestinationDirectory] = useState('');
  const destinationFolderPath = destinationDirectory
    ? `workflows/${destinationDirectory}`
    : 'workflows';
  const childFolders = getDirectChildren(userWorkflows, destinationFolderPath)
    .filter(
      (item) =>
        item.type === 'directory'
        && canBrowseWorkflowMoveDestination(target, getRelativePath(item)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const canMove = canMoveWorkflowEntryToDirectory(
    target,
    destinationDirectory,
    userWorkflows,
  );
  const destinationLabel = destinationDirectory || 'My Workflows';

  return (
    <Dialog
      size="md"
      title={`Move ${target.type === 'directory' ? 'folder' : 'workflow'}`}
      description={
        <div className="mt-2 space-y-2">
          <div className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
            <div className="text-xs text-slate-400">Destination</div>
            <div className="mt-0.5 truncate font-medium text-slate-100">
              {destinationLabel}
            </div>
          </div>
          {destinationDirectory && (
            <button
              type="button"
              onClick={() => setDestinationDirectory(getWorkflowParentPath(destinationDirectory))}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-slate-300 hover:bg-white/10 hover:text-slate-100"
            >
              <ChevronLeftBoldIcon className="h-4 w-4" />
              <span>Parent folder</span>
            </button>
          )}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {childFolders.map((folder) => {
              const relativePath = getRelativePath(folder);
              return (
                <button
                  key={folder.path}
                  type="button"
                  onClick={() => setDestinationDirectory(relativePath)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-white/10"
                >
                  <FolderIcon className="h-5 w-5 shrink-0 text-cyan-300" />
                  <span className="min-w-0 truncate">{folder.name}</span>
                </button>
              );
            })}
            {childFolders.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-slate-500">
                No subfolders
              </p>
            )}
          </div>
          {!canMove && (
            <p className="text-xs text-slate-500">
              Choose a different folder without an item of the same name.
            </p>
          )}
        </div>
      }
      actions={[
        { label: 'Cancel', variant: 'secondary', onClick: onClose },
        {
          label: 'Move here',
          variant: 'primary',
          disabled: !canMove,
          onClick: () => onMove(destinationDirectory),
        },
      ]}
      onClose={onClose}
    />
  );
}
