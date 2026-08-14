import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookmarkIconSvg,
  BypassToggleIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  ClipboardIcon,
  ClipboardDownloadIcon,
  EditIcon,
  EyeOffIcon,
  MoveUpDownIcon,
  PlusIcon,
  TrashIcon,
  WorkflowIcon,
} from "@/components/icons";
import { FoldIcon } from "@/components/FoldIcon";
import { useAnchoredMenuPosition } from "@/hooks/useAnchoredMenuPosition";
import { useDismissOnOutsideClick } from "@/hooks/useDismissOnOutsideClick";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { SelectionCheckbox } from '@/components/buttons/SelectionCheckbox';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { resolveWorkflowColor, themeColors, workflowColorPickerOptions } from "@/theme/colors";
import { hexToRgba } from "@/utils/grouping";
import { useI18n } from "@/i18n";

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
  /** True when the group has expanded children, so "fold all" is the action. */
  canFoldAll: boolean;
  color: string;
  onToggleCollapse: () => void;
  onToggleFoldAll: () => void;
  onToggleBookmark: () => void;
  onBypassAll: (bypass: boolean) => void;
  onHide: () => void;
  onAddNode: () => void;
  onDelete: () => void;
  onShowHiddenNodes: () => void;
  onMove: () => void;
  onCopy: () => void;
  onPaste: () => void;
  pasteSummary: string | null;
  onCommitTitle: (title: string) => void;
  onChangeColor?: (color: string) => void;
  containerColor?: string;
  labelEditRequestId?: number | null;
  labelEditInitialValue?: string;
  onLabelEditRequestHandled?: () => void;
  showBypassAllAction?: boolean;
  showUnbypassAllAction?: boolean;
  bypassState?: 'none' | 'partial' | 'all';
  bypassedNodeCount?: number;
  // Select mode: this container's own hierarchical key and its member node keys.
  // When in select mode the menu button is replaced with a selection checkbox;
  // toggling a group ON also auto-selects its members (companion keys).
  selectionKey?: string;
  selectionMemberKeys?: string[];
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
  canFoldAll,
  color,
  onToggleCollapse,
  onToggleFoldAll,
  onToggleBookmark,
  onBypassAll,
  onHide,
  onAddNode,
  onDelete,
  onShowHiddenNodes,
  onMove,
  onCopy,
  onPaste,
  pasteSummary,
  onCommitTitle,
  onChangeColor,
  containerColor = "",
  labelEditRequestId = null,
  labelEditInitialValue = "",
  onLabelEditRequestHandled,
  showBypassAllAction = true,
  showUnbypassAllAction = true,
  bypassState = 'none',
  bypassedNodeCount = 0,
  selectionKey,
  selectionMemberKeys,
}: GraphContainerHeaderProps) {
  const { t } = useI18n();
  const selectionMode = useWorkflowSelectionStore((s) => s.selectionMode);
  const isContainerSelected = useWorkflowSelectionStore((s) =>
    selectionKey ? s.selectedKeys.includes(selectionKey) : false,
  );
  const toggleSelectionKey = useWorkflowSelectionStore((s) => s.toggleKey);
  const enterSelectionMode = useWorkflowSelectionStore((s) => s.enterSelectionMode);
  const selectSelectionKeys = useWorkflowSelectionStore((s) => s.selectKeys);
  // The per-item "Select" menu entry is only meaningful for groups (subgraphs
  // select via their placeholder card).
  const canSelectFromMenu = containerType === "group" && Boolean(selectionKey);
  // Only groups participate in select mode for now; subgraphs are selected via
  // their placeholder card.
  const showSelectionCheckbox =
    selectionMode && containerType === "group" && Boolean(selectionKey);
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
  const resolvedContainerColor = resolveWorkflowColor(containerColor);
  const resolvedColor = resolveWorkflowColor(color);
  const backgroundColor =
    containerType === "subgraph"
      ? hexToRgba(resolvedColor, 0.22)
      : hexToRgba(resolvedColor, 0.15);
  const hasHiddenNodes = hiddenNodeCount > 0;
  const showBookmarkAction = isBookmarked || canShowBookmarkAction;
  const canChangeColor = typeof onChangeColor === "function";
  const countClassName = containerType === "subgraph" ? "text-cyan-300" : "text-slate-500";
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
      style={{
        backgroundColor: bypassState === 'all'
          ? hexToRgba(themeColors.brand.bypassPurple, 0.12)
          : backgroundColor,
      }}
      onClick={handleHeaderClick}
    >
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleCollapse();
          }}
          className="w-8 h-8 -ml-2 flex items-center justify-center text-slate-400 hover:text-slate-100 shrink-0"
        >
          <FoldIcon open={!isCollapsed} className="w-6 h-6" />
        </button>
        {isEditingLabel ? (
          <input
            ref={labelInputRef}
            value={labelValue}
            onChange={(e) => setLabelValue(e.target.value)}
            data-swipe-nav-ignore="true"
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
            className="font-semibold text-slate-100 flex-1 min-w-0 text-sm bg-slate-950/80 border border-white/10 rounded px-2 py-1"
          />
        ) : (
          <h3 className={`font-semibold text-slate-100 select-none flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis${bypassState === 'all' ? ' opacity-60' : ''}`}>
            {displayTitle}
          </h3>
        )}
        <span className={`text-sm shrink-0 inline-flex items-center gap-1 ${countClassName}`}>
          {bypassState === 'all' ? (
            <>
              <BypassToggleIcon isBypassed className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-purple-300">{nodeCount} node{nodeCount !== 1 ? "s" : ""}</span>
            </>
          ) : isCollapsed && bypassState === 'partial' ? (
            <>
              <span>{nodeCount} node{nodeCount !== 1 ? "s" : ""}</span>
              <BypassToggleIcon isBypassed className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-purple-500 text-xs">{bypassedNodeCount}</span>
            </>
          ) : (
            <>{nodeCount} node{nodeCount !== 1 ? "s" : ""}</>
          )}
        </span>
      </div>

      {showSelectionCheckbox ? (
        <SelectionCheckbox
          selected={isContainerSelected}
          ariaLabel={isContainerSelected ? t('Deselect group') : t('Select group')}
          onClick={(event) => {
            event.stopPropagation();
            if (selectionKey) toggleSelectionKey(selectionKey, selectionMemberKeys ?? []);
          }}
        />
      ) : (
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
            <BookmarkIconSvg className="w-5 h-5 text-amber-500" />
          ) : containerType === "subgraph" ? (
            <WorkflowIcon className="w-5 h-5 -scale-x-100 text-cyan-300" />
          ) : (
            undefined
          )}
        />
      )}
      {canChangeColor && colorPopoverOpen &&
        createPortal(
          <div
            ref={colorPopoverRef}
            className="fixed z-[1001] bg-slate-900 border border-white/10 rounded-lg shadow-lg p-2"
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
                  aria-label={t('Set color: {label}', { label })}
                    className={`w-9 aspect-square rounded-full transition-transform active:scale-95 ${
                      isSelected ? "ring-2 ring-offset-1 ring-cyan-300 ring-offset-slate-900" : ""
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
                  label: t('Edit label'),
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
                  label: t('Change color'),
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
                  label: isBookmarked ? t("Remove bookmark") : t("Bookmark"),
                  icon: <BookmarkIconSvg className="w-4 h-4 text-amber-500" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onToggleBookmark();
                    closeMenu();
                  },
                  hidden: !showBookmarkAction
                },
                {
                  key: 'select-group',
                  label: t('Select'),
                  icon: <CheckIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    if (selectionKey) {
                      enterSelectionMode();
                      selectSelectionKeys([selectionKey, ...(selectionMemberKeys ?? [])]);
                    }
                    closeMenu();
                  },
                  hidden: !canSelectFromMenu
                },
                {
                  key: 'add-node',
                  label: t('Add node'),
                  icon: <PlusIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onAddNode();
                    closeMenu();
                  }
                },
                {
                  key: 'fold-all',
                  label: canFoldAll ? t("Fold all") : t("Unfold all"),
                  icon: canFoldAll
                    ? <CaretRightIcon className="w-4 h-4" />
                    : <CaretDownIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onToggleFoldAll();
                    closeMenu();
                  },
                  hidden: isCollapsed && !canFoldAll
                },
                {
                  key: 'bypass-all',
                  label: t('Bypass all nodes'),
                  icon: <BypassToggleIcon isBypassed className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onBypassAll(true);
                    closeMenu();
                  },
                  hidden: !showBypassAllAction
                },
                {
                  key: 'unbypass-all',
                  label: t('Engage all nodes'),
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
                  label: t('Show hidden nodes'),
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
                  label: containerType === 'group' ? t('Hide group') : t('Hide subgraph'),
                  icon: <EyeOffIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onHide();
                    closeMenu();
                  }
                },
                {
                  key: 'copy-container',
                  label: containerType === 'group' ? t('Copy group') : t('Copy subgraph'),
                  icon: <ClipboardIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onCopy();
                    closeMenu();
                  }
                },
                {
                  key: 'paste-into-container',
                  label: pasteSummary ? t('Paste {summary} here', { summary: pasteSummary }) : t('Paste here'),
                  icon: <ClipboardDownloadIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onPaste();
                    closeMenu();
                  },
                  hidden: !pasteSummary
                },
                {
                  key: 'move-container',
                  label: containerType === 'group' ? t('Move group') : t('Move subgraph'),
                  icon: <MoveUpDownIcon className="w-4 h-4" />,
                  onClick: (event) => {
                    event.stopPropagation();
                    onMove();
                    closeMenu();
                  }
                },
                {
                  key: 'delete-container',
                  label: containerType === 'group' ? t('Delete group') : t('Delete subgraph'),
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
