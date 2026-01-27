import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowGroup } from '@/api/types';
import { CaretDownIcon, CaretRightIcon, EllipsisVerticalIcon, BypassToggleIcon, EyeOffIcon, EditIcon, BookmarkIconSvg, BookmarkOutlineIcon } from '@/components/icons';
import { hexToRgba } from '@/utils/grouping';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useBookmarksStore } from '@/hooks/useBookmarks';

interface GroupHeaderProps {
  group: WorkflowGroup;
  nodeCount: number;
  isCollapsed: boolean;
  subgraphId?: string | null;
  bookmarkNodeId?: number | null;
  hiddenNodeCount?: number;
  foldAllLabel: string;
  onToggleCollapse: () => void;
  onToggleFoldAll: () => void;
  onBypassAll: (bypass: boolean) => void;
  onHideGroup: () => void;
  onShowHiddenNodes?: () => void;
}

export function GroupHeader({
  group,
  nodeCount,
  isCollapsed,
  subgraphId = null,
  bookmarkNodeId = null,
  hiddenNodeCount = 0,
  foldAllLabel,
  onToggleCollapse,
  onToggleFoldAll,
  onBypassAll,
  onHideGroup,
  onShowHiddenNodes
}: GroupHeaderProps) {
  const updateGroupTitle = useWorkflowStore((s) => s.updateGroupTitle);
  const bookmarkedNodeIds = useBookmarksStore((s) => s.bookmarkedNodeIds);
  const toggleNodeBookmark = useBookmarksStore((s) => s.toggleNodeBookmark);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const labelInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const updatePosition = () => {
      const button = menuButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setMenuPosition({
        top: rect.bottom + 6,
        left: rect.right - 160
      });
    };

    updatePosition();

    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current || !event.target) return;
      if (menuButtonRef.current?.contains(event.target as Node)) {
        return;
      }
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [menuOpen]);

  const backgroundColor = hexToRgba(group.color, 0.22);
  const borderColor = hexToRgba(group.color, 0.4);
  const displayTitle = group.title?.trim() || `Group ${group.id}`;

  useEffect(() => {
    if (!isEditingLabel) return;
    const input = labelInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isEditingLabel]);

  const handleHeaderClick = () => {
    if (isEditingLabel) return;
    onToggleCollapse();
  };

  const handleToggleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleCollapse();
  };

  const handleLabelBlur = () => {
    updateGroupTitle(group.id, labelValue, subgraphId);
    setIsEditingLabel(false);
  };

  const handleMenuToggleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setMenuOpen((prev) => !prev);
  };

  const handleEditLabelClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setLabelValue(displayTitle);
    setIsEditingLabel(true);
    setMenuOpen(false);
  };

  const handleMenuToggleCollapse = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggleFoldAll();
    setMenuOpen(false);
  };

  const handleBypassAllClick = (shouldBypass: boolean) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onBypassAll(shouldBypass);
    setMenuOpen(false);
  };

  const handleHideGroupClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onHideGroup();
    setMenuOpen(false);
  };

  const handleShowHiddenNodesClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onShowHiddenNodes?.();
    setMenuOpen(false);
  };

  const isNodeBookmarked = bookmarkNodeId != null && bookmarkedNodeIds.includes(bookmarkNodeId);
  const canAddNodeBookmark = bookmarkNodeId != null && (bookmarkedNodeIds.length < 5 || isNodeBookmarked);
  const hasHiddenNodes = hiddenNodeCount > 0 && Boolean(onShowHiddenNodes);

  return (
    <div
      id={`group-header-${group.id}`}
      className={`group-header flex items-center justify-between cursor-pointer gap-3 px-3 py-2 ${
        isCollapsed ? 'rounded-xl' : 'rounded-t-xl mb-2'
      }`}
      style={{
        backgroundColor,
        borderColor
      }}
      onClick={handleHeaderClick}
    >
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <button
          onClick={handleToggleClick}
          className="w-8 h-8 -ml-2 flex items-center justify-center text-gray-500 hover:text-gray-700 shrink-0"
        >
          {isCollapsed ? (
            <CaretRightIcon className="w-6 h-6" />
          ) : (
            <CaretDownIcon className="w-6 h-6" />
          )}
        </button>
        {isEditingLabel ? (
          <input
            ref={labelInputRef}
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            onBlur={handleLabelBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.currentTarget.blur();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-gray-900 flex-1 min-w-0 text-sm bg-white border border-gray-200 rounded px-2 py-1"
          />
        ) : (
          <h3 className="font-semibold text-gray-900 select-none flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
            {displayTitle}
          </h3>
        )}
        {isCollapsed && (
          <span className="text-sm text-gray-500 shrink-0">
            ({nodeCount} node{nodeCount !== 1 ? 's' : ''})
          </span>
        )}
      </div>

      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={handleMenuToggleClick}
          className="w-8 h-8 flex items-center justify-center text-gray-700 hover:text-gray-900 bg-transparent hover:bg-transparent"
          aria-label="Group options"
          ref={menuButtonRef}
        >
          <EllipsisVerticalIcon className="w-5 h-5 -rotate-90" />
        </button>

        {menuOpen && menuPosition && createPortal(
          <div
            ref={menuRef}
            className="fixed z-[1000] w-44 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleEditLabelClick}
            >
              <EditIcon className="w-4 h-4 text-gray-500" />
              Edit Label
            </button>
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={(event) => {
                event.stopPropagation();
                if (bookmarkNodeId == null) return;
                toggleNodeBookmark(bookmarkNodeId);
                setMenuOpen(false);
              }}
              disabled={!canAddNodeBookmark}
            >
              {isNodeBookmarked ? (
                <BookmarkOutlineIcon className="w-4 h-4 text-gray-500" />
              ) : (
                <BookmarkIconSvg className="w-4 h-4 text-yellow-500" />
              )}
              {isNodeBookmarked ? 'Remove bookmark' : 'Bookmark node'}
            </button>
            <div className="border-t border-gray-200 my-1" />
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleMenuToggleCollapse}
            >
              {foldAllLabel === 'Fold all' ? (
                <CaretRightIcon className="w-4 h-4 text-gray-500" />
              ) : (
                <CaretDownIcon className="w-4 h-4 text-gray-500" />
              )}
              {foldAllLabel}
            </button>
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleBypassAllClick(true)}
            >
              <BypassToggleIcon className="w-4 h-4 text-gray-500" isBypassed={true} />
              Bypass all nodes
            </button>
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleBypassAllClick(false)}
            >
              <BypassToggleIcon className="w-4 h-4 text-gray-500" isBypassed={false} />
              Engage all nodes
            </button>
            {hasHiddenNodes && (
              <button
                className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                onClick={handleShowHiddenNodesClick}
              >
                <EyeOffIcon className="w-4 h-4 text-gray-500" />
                Show hidden nodes
              </button>
            )}
            <div className="border-t border-gray-200 my-1" />
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleHideGroupClick}
            >
              <EyeOffIcon className="w-4 h-4 text-gray-500" />
              Hide group
            </button>
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
