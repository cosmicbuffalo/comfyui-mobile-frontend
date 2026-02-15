import type { RefObject } from 'react';
import type { CSSProperties } from 'react';
import type { FileItem } from '@/api/client';
import { CheckIcon, BookmarkIconSvg, BookmarkOutlineIcon, FolderIcon, WorkflowIcon, ThickArrowRightIcon, TrashIcon, EditIcon } from '@/components/icons';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';

interface OutputsContextMenuProps {
  menuTarget: { file: FileItem } | null;
  favorites: string[];
  setMenuTarget: (target: { file: FileItem } | null) => void;
  menuRef: RefObject<HTMLDivElement | null>;
  menuStyle: CSSProperties;
  handleFavorite: () => void;
  handleSelectSingle: () => void;
  handleMoveSingle: () => void;
  handleRenameRequest: () => void;
  handleLoadWorkflow: () => void;
  handleLoadInWorkflow: () => void;
  handleDeleteRequest: () => void;
}

export function OutputsContextMenu({
  menuTarget,
  favorites,
  setMenuTarget,
  menuRef,
  menuStyle,
  handleFavorite,
  handleSelectSingle,
  handleMoveSingle,
  handleRenameRequest,
  handleLoadWorkflow,
  handleLoadInWorkflow,
  handleDeleteRequest
}: OutputsContextMenuProps) {
  if (!menuTarget) return null;
  const menuItems = [
    {
      key: 'favorite',
      label: favorites.includes(menuTarget.file.id) ? 'Unfavorite' : 'Favorite',
      icon: favorites.includes(menuTarget.file.id)
        ? <BookmarkIconSvg className="w-4 h-4" />
        : <BookmarkOutlineIcon className="w-4 h-4" />,
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
