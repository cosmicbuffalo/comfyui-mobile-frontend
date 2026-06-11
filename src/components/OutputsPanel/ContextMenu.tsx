import type { RefObject } from 'react';
import type { CSSProperties } from 'react';
import type { FileItem } from '@/api/client';
import { CheckIcon, HeartIcon, HeartOutlineIcon, DownloadDeviceIcon, EyeIcon, EyeOffIcon, FolderIcon, WorkflowIcon, ThickArrowRightIcon, TrashIcon, EditIcon } from '@/components/icons';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';

interface OutputsContextMenuProps {
  menuTarget: { file: FileItem } | null;
  favorites: string[];
  setMenuTarget: (target: { file: FileItem } | null) => void;
  menuRef: RefObject<HTMLDivElement | null>;
  menuStyle: CSSProperties;
  handleFavorite: () => void;
  handleToggleHidden: () => void;
  handleSelectSingle: () => void;
  handleMoveSingle: () => void;
  handleRenameRequest: () => void;
  handleLoadWorkflow: () => void;
  handleLoadInWorkflow: () => void;
  handleDownload: () => void;
  handleDeleteRequest: () => void;
}

export function OutputsContextMenu({
  menuTarget,
  favorites,
  setMenuTarget,
  menuRef,
  menuStyle,
  handleFavorite,
  handleToggleHidden,
  handleSelectSingle,
  handleMoveSingle,
  handleRenameRequest,
  handleLoadWorkflow,
  handleLoadInWorkflow,
  handleDownload,
  handleDeleteRequest
}: OutputsContextMenuProps) {
  if (!menuTarget) return null;
  const menuItems = [
    {
      key: 'favorite',
      label: favorites.includes(menuTarget.file.id) ? 'Unfavorite' : 'Favorite',
      icon: favorites.includes(menuTarget.file.id)
        ? <HeartIcon className="w-4 h-4 text-red-500" />
        : <HeartOutlineIcon className="w-4 h-4" />,
      onClick: () => handleFavorite()
    },
    {
      key: 'select',
      label: 'Select',
      icon: <CheckIcon className="w-4 h-4" />,
      onClick: () => handleSelectSingle()
    },
    {
      key: 'move',
      label: 'Move',
      icon: <FolderIcon className="w-4 h-4" />,
      onClick: () => handleMoveSingle()
    },
    {
      key: 'rename',
      label: 'Rename',
      icon: <EditIcon className="w-4 h-4" />,
      onClick: () => handleRenameRequest()
    },
    {
      key: 'hide',
      label: menuTarget.file.hiddenSelf ? 'Unhide' : 'Hide',
      icon: menuTarget.file.hiddenSelf
        ? <EyeIcon className="w-4 h-4" />
        : <EyeOffIcon className="w-4 h-4" />,
      onClick: () => handleToggleHidden(),
      // Dot-prefixed items are hidden by convention; this action only governs
      // manually-marked hidden state, so don't offer it for them.
      hidden: menuTarget.file.name.startsWith('.')
    },
    {
      key: 'load-workflow',
      label: 'Load workflow',
      icon: <WorkflowIcon className="w-4 h-4" />,
      onClick: () => handleLoadWorkflow(),
      hidden: menuTarget.file.type !== 'image'
    },
    {
      key: 'use-in-workflow',
      label: 'Use in workflow',
      icon: <ThickArrowRightIcon className="w-4 h-4" />,
      onClick: () => handleLoadInWorkflow(),
      hidden: menuTarget.file.type !== 'image'
    },
    {
      key: 'download',
      label: 'Download',
      icon: <DownloadDeviceIcon className="w-4 h-4" />,
      onClick: () => handleDownload(),
      hidden: menuTarget.file.type === 'folder'
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <TrashIcon className="w-4 h-4" />,
      onClick: () => handleDeleteRequest(),
      color: 'danger' as const
    }
  ];

  return (
    <>
      <div
        id="outputs-context-menu-overlay"
        className="fixed inset-0 z-[1690]"
        onClick={() => setMenuTarget(null)}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <div
        id="outputs-context-menu"
        ref={menuRef}
        className="fixed z-[1700] min-w-44 w-max"
        style={menuStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <ContextMenuBuilder items={menuItems} />
      </div>
    </>
  );
}
