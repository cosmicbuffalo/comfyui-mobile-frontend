import type { RefObject } from 'react';
import type { CSSProperties } from 'react';
import type { FileItem } from '@/api/client';
import { CheckIcon, HeartIcon, HeartOutlineIcon, RejectedIcon, RejectXIcon, DownloadDeviceIcon, EyeIcon, EyeOffIcon, FolderIcon, WorkflowIcon, ThickArrowRightIcon, TrashIcon, EditIcon } from '@/components/icons';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { useI18n } from '@/i18n';

interface OutputsContextMenuProps {
  menuTarget: { file: FileItem } | null;
  favorites: string[];
  rejected: string[];
  setMenuTarget: (target: { file: FileItem } | null) => void;
  menuRef: RefObject<HTMLDivElement | null>;
  menuStyle: CSSProperties;
  handleFavorite: () => void;
  handleReject: () => void;
  handleToggleHidden: () => void;
  handleSelectSingle: () => void;
  handleMoveSingle: () => void;
  handleRenameRequest: () => void;
  handleLoadWorkflow: () => void;
  handleLoadInWorkflow: () => void;
  /**
   * Whether a video target has a loadable workflow (resolved through its
   * same-basename sibling image). Ignored for stills, which always offer the
   * entry.
   */
  videoWorkflowAvailable: boolean;
  handleDownload: () => void;
  handleDeleteRequest: () => void;
}

export function OutputsContextMenu({
  menuTarget,
  favorites,
  rejected,
  setMenuTarget,
  menuRef,
  menuStyle,
  handleFavorite,
  handleReject,
  handleToggleHidden,
  handleSelectSingle,
  handleMoveSingle,
  handleRenameRequest,
  handleLoadWorkflow,
  handleLoadInWorkflow,
  videoWorkflowAvailable,
  handleDownload,
  handleDeleteRequest
}: OutputsContextMenuProps) {
  const { t } = useI18n();
  if (!menuTarget) return null;
  const menuItems = [
    {
      key: 'favorite',
      label: favorites.includes(menuTarget.file.id) ? t('Unfavorite') : t('Favorite'),
      icon: favorites.includes(menuTarget.file.id)
        ? <HeartIcon className="w-4 h-4 text-red-500" />
        : <HeartOutlineIcon className="w-4 h-4" />,
      onClick: () => handleFavorite()
    },
    {
      key: 'reject',
      label: rejected.includes(menuTarget.file.id) ? t('Clear rejected mark') : t('Reject'),
      icon: rejected.includes(menuTarget.file.id)
        ? <RejectedIcon className="w-4 h-4" />
        : <RejectXIcon className="w-4 h-4" />,
      onClick: () => handleReject(),
      hidden: menuTarget.file.type === 'folder'
    },
    {
      key: 'select',
      label: t('Select'),
      icon: <CheckIcon className="w-4 h-4" />,
      onClick: () => handleSelectSingle()
    },
    {
      key: 'move',
      label: t('Move'),
      icon: <FolderIcon className="w-4 h-4" />,
      onClick: () => handleMoveSingle()
    },
    {
      key: 'rename',
      label: t('Rename'),
      icon: <EditIcon className="w-4 h-4" />,
      onClick: () => handleRenameRequest()
    },
    {
      key: 'hide',
      label: menuTarget.file.hiddenSelf ? t('Unhide') : t('Hide'),
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
      label: t('Load workflow'),
      icon: <WorkflowIcon className="w-4 h-4" />,
      onClick: () => handleLoadWorkflow(),
      // A video carries no metadata of its own, but one saved beside its
      // preview frame loads that frame's workflow — the same resolution the
      // full-screen viewer's Load Workflow button uses. Offer the entry only
      // once the probe confirms it, so clips saved on their own don't get an
      // action that can only fail.
      hidden: menuTarget.file.type === 'video'
        ? !videoWorkflowAvailable
        : menuTarget.file.type !== 'image'
    },
    {
      key: 'use-in-workflow',
      label: t('Use in workflow'),
      icon: <ThickArrowRightIcon className="w-4 h-4" />,
      onClick: () => handleLoadInWorkflow(),
      hidden: menuTarget.file.type !== 'image'
    },
    {
      key: 'download',
      label: t('Download'),
      icon: <DownloadDeviceIcon className="w-4 h-4" />,
      onClick: () => handleDownload(),
      hidden: menuTarget.file.type === 'folder'
    },
    {
      key: 'delete',
      label: t('Delete'),
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
