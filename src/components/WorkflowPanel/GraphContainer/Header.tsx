import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookmarkIconSvg,
  BookmarkOutlineIcon,
  BypassToggleIcon,
  CaretDownIcon,
  CaretRightIcon,
  EditIcon,
  EyeOffIcon,
  MoveUpDownIcon,
  PlusIcon,
  TrashIcon,
  WorkflowIcon,
} from "@/components/icons";
import { useAnchoredMenuPosition } from "@/hooks/useAnchoredMenuPosition";
import { useDismissOnOutsideClick } from "@/hooks/useDismissOnOutsideClick";
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';

type GraphContainerType = "group" | "subgraph";

interface GraphContainerHeaderProps {
  containerType: GraphContainerType;
  containerId: string | number;
  title: string;
  nodeCount: number;
  isCollapsed: boolean;
  hiddenNodeCount: number;
  isBookmarked: boolean;
  canShowBookmarkAction: boolean;
  foldAllLabel: string;
  backgroundColor: string;
  borderColor: string;
  onToggleCollapse: () => void;
  onToggleFoldAll: () => void;
  onToggleBookmark: () => void;
  onBypassAll: (bypass: boolean) => void;
  onHide: () => void;
  onAddNode: () => void;
  onDelete: () => void;
  onShowHiddenNodes: () => void;
  onMove: () => void;
  onCommitTitle: (title: string) => void;
}

export function GraphContainerHeader({
  containerType,
  containerId,
  title,
  nodeCount,
  isCollapsed,
  hiddenNodeCount,
  isBookmarked,
  canShowBookmarkAction,
  foldAllLabel,
  backgroundColor,
  borderColor,
  onToggleCollapse,
  onToggleFoldAll,
  onToggleBookmark,
  onBypassAll,
  onHide,
  onAddNode,
  onDelete,
  onShowHiddenNodes,
  onMove,
  onCommitTitle,
}: GraphContainerHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { menuStyle, resetMenuPosition } = useAnchoredMenuPosition({
    open: menuOpen,
    buttonRef: menuButtonRef,
    menuRef,
  });

  const displayTitle = title.trim() || `${containerType} ${containerId}`;
  const hasHiddenNodes = hiddenNodeCount > 0;
  const showBookmarkAction = isBookmarked || canShowBookmarkAction;
  const countClassName = containerType === "subgraph" ? "text-blue-600" : "text-gray-500";
  const closeMenu = () => {
    setMenuOpen(false);
    resetMenuPosition();
  };

  useDismissOnOutsideClick({
    open: menuOpen,
    onDismiss: () => {
      setMenuOpen(false);
      resetMenuPosition();
    },
    triggerRef: menuButtonRef,
    contentRef: menuRef,
    ignoreScrollWithinContent: true,
  });

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

  return (
    <div
      id={`${containerType}-header-${containerId}`}
      className={`flex items-center justify-between cursor-pointer gap-3 px-3 py-2 ${
        isCollapsed ? "rounded-xl" : "rounded-t-xl mb-2"
      }`}
      style={{ backgroundColor, borderColor }}
      onClick={handleHeaderClick}
    >
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse();
          }}
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
            onBlur={() => {
              onCommitTitle(labelValue);
              setIsEditingLabel(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.currentTarget.blur();
              }
            }}
            onClick={(event) => event.stopPropagation()}
            className="font-semibold text-gray-900 flex-1 min-w-0 text-sm bg-white border border-gray-200 rounded px-2 py-1"
          />
        ) : (
          <h3 className="font-semibold text-gray-900 select-none flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
            {displayTitle}
          </h3>
        )}
        <span className={`text-sm shrink-0 ${countClassName}`}>
          {nodeCount} node{nodeCount !== 1 ? "s" : ""}
        </span>
      </div>

      <ContextMenuButton
        onClick={(event) => {
          event.stopPropagation();
          resetMenuPosition();
          setMenuOpen((prev) => !prev);
        }}
        ariaLabel={`${containerType} options`}
        buttonRef={menuButtonRef}
        buttonSize={8}
        iconSize={5}
        icon={isBookmarked ? (
          <BookmarkIconSvg className="w-5 h-5 text-blue-500" />
        ) : containerType === "subgraph" ? (
          <WorkflowIcon className="w-5 h-5 -scale-x-100 text-blue-500" />
        ) : (
          undefined
        )}
      />

      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[1000] w-44"
            style={menuStyle}
          >
            <ContextMenuBuilder
              items={[
                {
                  key: 'edit-label',
                  label: 'Edit label',
                  icon: <EditIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    setLabelValue(displayTitle);
                    setIsEditingLabel(true);
                    closeMenu();
                  }
                },
                {
                  key: 'add-node',
                  label: 'Add node',
                  icon: <PlusIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onAddNode();
                    closeMenu();
                  }
                },
                {
                  key: 'fold-all',
                  label: foldAllLabel,
                  icon: foldAllLabel === "Fold all"
                    ? <CaretRightIcon className="w-4 h-4" />
                    : <CaretDownIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onToggleFoldAll();
                    closeMenu();
                  }
                },
                {
                  key: 'bypass-all',
                  label: 'Bypass all nodes',
                  icon: <BypassToggleIcon isBypassed className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onBypassAll(true);
                    closeMenu();
                  }
                },
                {
                  key: 'unbypass-all',
                  label: 'Un-bypass all nodes',
                  icon: <BypassToggleIcon isBypassed={false} className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onBypassAll(false);
                    closeMenu();
                  }
                },
                {
                  key: 'toggle-bookmark',
                  label: isBookmarked ? "Remove bookmark" : "Bookmark container",
                  icon: isBookmarked
                    ? <BookmarkIconSvg className="w-4 h-4 text-blue-500" />
                    : <BookmarkOutlineIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onToggleBookmark();
                    closeMenu();
                  },
                  hidden: !showBookmarkAction
                },
                {
                  key: 'show-hidden-nodes',
                  label: 'Show hidden nodes',
                  icon: <EyeOffIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onShowHiddenNodes();
                    closeMenu();
                  },
                  hidden: !hasHiddenNodes
                },
                {
                  key: 'hide-container',
                  label: `Hide ${containerType}`,
                  icon: <EyeOffIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onHide();
                    closeMenu();
                  }
                },
                {
                  key: 'move-container',
                  label: `Move ${containerType}`,
                  icon: <MoveUpDownIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onMove();
                    closeMenu();
                  }
                },
                {
                  key: 'delete-container',
                  label: `Delete ${containerType}`,
                  icon: <TrashIcon className="w-4 h-4" />,
                  color: 'danger',
                  onClick: (event) => {
                    event.stopPropagation();
                    onDelete();
                    closeMenu();
                  }
                }
              ]}
            />
          </div>,
          document.body
        )}
    </div>
  );
}
