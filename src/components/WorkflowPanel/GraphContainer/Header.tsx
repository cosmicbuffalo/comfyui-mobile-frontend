import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookmarkIconSvg,
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
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { resolveWorkflowColor, themeColors, workflowColorPickerOptions } from "@/theme/colors";
import { hexToRgba } from "@/utils/grouping";

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
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
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
  onChangeColor?: (color: string) => void;
  containerColor?: string;
  labelEditRequestId?: number | null;
  labelEditInitialValue?: string;
  onLabelEditRequestHandled?: () => void;
  showUnbypassAllAction?: boolean;
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
  color,
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
  onChangeColor,
  containerColor = "",
  labelEditRequestId = null,
  labelEditInitialValue = "",
  onLabelEditRequestHandled,
  showUnbypassAllAction = true,
}: GraphContainerHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const [colorPopoverPlacement, setColorPopoverPlacement] = useState<"above" | "below">("below");
  const [colorPopoverStyle, setColorPopoverStyle] = useState<{
    top: number;
    left: number;
    width: number;
    visibility: "hidden" | "visible";
  }>({
    top: -9999,
    left: -9999,
    width: 320,
    visibility: "hidden",
  });
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const colorPopoverRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { menuStyle, resetMenuPosition } = useAnchoredMenuPosition({
    open: menuOpen,
    buttonRef: menuButtonRef,
    menuRef,
  });

  const displayTitle = title.trim() || `${containerType} ${containerId}`;
  const fallbackColor = color ?? containerColor ?? "";
  const resolvedContainerColor = resolveWorkflowColor(containerColor || fallbackColor);
  const resolvedColor = resolveWorkflowColor(fallbackColor);
  const resolvedBackgroundColor =
    containerType === "subgraph"
      ? hexToRgba(resolvedColor, 0.22)
      : hexToRgba(resolvedColor, 0.15);
  const hasHiddenNodes = hiddenNodeCount > 0;
  const showBookmarkAction = isBookmarked || canShowBookmarkAction;
  const canChangeColor = containerType === "group";
  const countClassName = containerType === "subgraph" ? "text-blue-600" : "text-gray-500";
  const handleChangeColor = (nextColor: string) => {
    if (onChangeColor) {
      onChangeColor(nextColor);
      return;
    }
    if (containerType !== "group") return;
    const numericContainerId =
      typeof containerId === "number" ? containerId : Number(containerId);
    if (!Number.isFinite(numericContainerId)) return;
    useWorkflowStore.setState((state) => {
      const currentWorkflow = state.workflow;
      if (!currentWorkflow) return state;
      const currentGroups = currentWorkflow.groups ?? [];
      let changed = false;
      const updatedGroups = currentGroups.map((group) => {
        if (group.id !== numericContainerId) return group;
        changed = true;
        return {
          ...group,
          color: nextColor,
        };
      });
      if (!changed) return state;
      return {
        workflow: {
          ...currentWorkflow,
          groups: updatedGroups,
        },
      };
    });
  };
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
  useDismissOnOutsideClick({
    open: colorPopoverOpen,
    onDismiss: () => setColorPopoverOpen(false),
    triggerRef: menuButtonRef,
    contentRef: colorPopoverRef,
    ignoreScrollWithinContent: true,
  });
  useLayoutEffect(() => {
    if (!colorPopoverOpen) return;
    const updateColorPopoverPosition = () => {
      const button = menuButtonRef.current;
      const popover = colorPopoverRef.current;
      if (!button || !popover) return;
      const buttonRect = button.getBoundingClientRect();
      const header = button.closest('[id^="group-header-"], [id^="subgraph-header-"]') as HTMLElement | null;
      const headerRect = header?.getBoundingClientRect();
      const viewportPadding = 8;
      const bottomBarReserve = 104;
      const maxBottom = window.innerHeight - bottomBarReserve;
      const maxWidth = window.innerWidth - viewportPadding * 2;
      const width = Math.min(400, Math.max(220, Math.min(maxWidth, headerRect?.width ?? 320)));
      const leftAnchor = headerRect ? headerRect.left : buttonRect.right - width;
      const left = Math.max(
        viewportPadding,
        Math.min(leftAnchor, window.innerWidth - width - viewportPadding),
      );
      const popoverHeight = popover.getBoundingClientRect().height || 56;
      const belowTop = buttonRect.bottom + 6;
      const aboveTop = buttonRect.top - popoverHeight - 6;
      const preferredTop = colorPopoverPlacement === "below" ? belowTop : aboveTop;
      const top = Math.max(
        viewportPadding,
        Math.min(preferredTop, maxBottom - popoverHeight),
      );
      setColorPopoverStyle({
        top,
        left,
        width,
        visibility: "visible",
      });
    };
    updateColorPopoverPosition();
    const raf1 = requestAnimationFrame(updateColorPopoverPosition);
    const raf2 = requestAnimationFrame(updateColorPopoverPosition);
    window.addEventListener("resize", updateColorPopoverPosition);
    window.addEventListener("scroll", updateColorPopoverPosition, true);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener("resize", updateColorPopoverPosition);
      window.removeEventListener("scroll", updateColorPopoverPosition, true);
    };
  }, [colorPopoverOpen, colorPopoverPlacement]);

  useEffect(() => {
    if (!isEditingLabel) return;
    const input = labelInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isEditingLabel]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (labelEditRequestId == null) return;
    setLabelValue(labelEditInitialValue);
    setIsEditingLabel(true);
    onLabelEditRequestHandled?.();
  }, [labelEditRequestId, labelEditInitialValue, onLabelEditRequestHandled]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleHeaderClick = () => {
    if (isEditingLabel) return;
    onToggleCollapse();
  };

  return (
    <div
      id={`${containerType}-header-${containerId}`}
      className={`relative flex items-center justify-between cursor-pointer gap-3 px-2 py-2 ${
        isCollapsed ? "" : "mb-2"
      }`}
      style={{ backgroundColor: color ? resolvedBackgroundColor : backgroundColor, borderColor }}
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
          setColorPopoverOpen(false);
          setMenuOpen((prev) => !prev);
        }}
        ariaLabel={`${containerType} options`}
        buttonRef={menuButtonRef}
        buttonSize={8}
        iconSize={5}
        icon={isBookmarked ? (
          <BookmarkIconSvg className="w-5 h-5 text-yellow-500" />
        ) : containerType === "subgraph" ? (
          <WorkflowIcon className="w-5 h-5 -scale-x-100 text-blue-500" />
        ) : (
          undefined
        )}
      />
      {canChangeColor && colorPopoverOpen &&
        createPortal(
          <div
            ref={colorPopoverRef}
            className="fixed z-[1001] bg-white border border-gray-200 rounded-lg shadow-lg p-2"
            style={colorPopoverStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              {workflowColorPickerOptions.map(({ key, label, color }, index) => {
                const isSelected = color.toLowerCase() === resolvedContainerColor.toLowerCase();
                return (
                  <button
                    key={`${key}-${index}`}
                    type="button"
                    title={label}
                    aria-label={`Set color: ${label}`}
                    className={`w-9 h-9 rounded-full transition-transform active:scale-95 ${
                      isSelected ? "ring-2 ring-offset-1 ring-gray-400" : ""
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleChangeColor(color);
                      setColorPopoverOpen(false);
                    }}
                  />
                );
              })}
            </div>
          </div>,
          document.body,
        )}

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
                  key: 'change-color',
                  label: 'Change color',
                  icon: (
                    <span
                      className="inline-block w-3 h-3 rounded-full"
                      style={{
                        backgroundColor:
                          resolvedContainerColor || themeColors.workflow.defaultGroupDot,
                      }}
                    />
                  ),
                  onClick: (event) => {
                    event.stopPropagation();
                    const buttonRect = menuButtonRef.current?.getBoundingClientRect();
                    if (buttonRect) {
                      const estimatedPopoverHeight = 56;
                      const viewportPadding = 8;
                      const maxBottom = window.innerHeight - 104;
                      const canOpenBelow =
                        buttonRect.bottom + estimatedPopoverHeight <= maxBottom - viewportPadding;
                      setColorPopoverPlacement(canOpenBelow ? "below" : "above");
                    } else {
                      setColorPopoverPlacement("below");
                    }
                    setColorPopoverOpen(true);
                    closeMenu();
                  },
                  hidden: !canChangeColor
                },
                {
                  type: 'divider',
                  key: 'divider-top-edit-color'
                },
                {
                  key: 'toggle-bookmark',
                  label: isBookmarked ? "Remove bookmark" : "Bookmark",
                  icon: <BookmarkIconSvg className="w-4 h-4 text-yellow-500" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onToggleBookmark();
                    closeMenu();
                  },
                  hidden: !showBookmarkAction
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
                  },
                  hidden: isCollapsed && foldAllLabel === "Unfold all"
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
                  label: 'Engage all nodes',
                  icon: <BypassToggleIcon isBypassed={false} className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onBypassAll(false);
                    closeMenu();
                  },
                  hidden: !showUnbypassAllAction
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
