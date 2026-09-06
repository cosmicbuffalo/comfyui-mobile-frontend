import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRightIcon,
  BookmarkIconSvg,
  BookmarkOutlineIcon,
  BypassToggleIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckIcon,
  ClipboardIcon,
  ClipboardDownloadIcon,
  CopyIcon,
  EditIcon,
  EyeOffIcon,
  MoveUpDownIcon,
  PlusIcon,
  TrashIcon,
  WorkflowIcon,
} from "@/components/icons";
import { FoldIcon } from "@/components/FoldIcon";
import { useDismissOnOutsideClick } from "@/hooks/useDismissOnOutsideClick";
import { SelectionCheckbox } from '@/components/buttons/SelectionCheckbox';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { resolveWorkflowColor, themeColors, workflowColorPickerOptions } from "@/theme/colors";
import { hexToRgba } from "@/utils/grouping";
import { useI18n } from "@/i18n";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { WorkflowObjectContextMenu } from '@/components/WorkflowPanel/WorkflowObjectContextMenu';

type GraphContainerType = "group" | "subgraph";

interface GraphContainerHeaderProps {
  containerType: GraphContainerType;
  containerId: string | number;
  title: string;
  nodeCount: number;
  isCollapsed: boolean;
  hiddenNodeCount: number;
  isBookmarked: boolean;
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
  /** Absent when this scope holds no subgraph the group could move into. */
  onMoveIntoSubgraph?: () => void;
  onDuplicate: () => void;
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
  // Select mode: this container's own hierarchical key. Contents are selected
  // explicitly from the actions rendered inside an unfolded group.
  selectionKey?: string;
}

export function GraphContainerHeader({
  containerType,
  containerId,
  title,
  nodeCount,
  isCollapsed,
  hiddenNodeCount,
  isBookmarked,
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
  onMoveIntoSubgraph,
  onDuplicate,
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
}: GraphContainerHeaderProps) {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
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
  const colorPopoverRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const displayTitle = title.trim() || `${containerType} ${containerId}`;
  const resolvedContainerColor = resolveWorkflowColor(containerColor);
  const resolvedColor = resolveWorkflowColor(color);
  const backgroundColor =
    containerType === "subgraph"
      ? hexToRgba(resolvedColor, 0.22)
      : hexToRgba(resolvedColor, 0.15);
  const hasHiddenNodes = hiddenNodeCount > 0;
  const canChangeColor = typeof onChangeColor === "function";
  const countClassName = containerType === "subgraph" ? "text-cyan-300" : "text-slate-500";
  // Only reachable when `onChangeColor` was given: both the menu entry and the
  // swatch popover are gated on `canChangeColor`, which is that prop.
  const handleChangeColor = (nextColor: string) => {
    onChangeColor?.(nextColor);
  };
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

  const openColorPopover = () => {
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
        <div className="flex shrink-0 items-center gap-1">
          {isDesktop && (
            <button
              type="button"
              className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md ${
                isBookmarked ? "text-amber-500" : "text-slate-400"
              }`}
              aria-pressed={isBookmarked}
              aria-label={isBookmarked ? t("Remove bookmark") : t("Bookmark")}
              onClick={(event) => {
                event.stopPropagation();
                onToggleBookmark();
              }}
            >
              {isBookmarked ? (
                <BookmarkIconSvg className="h-5 w-5" />
              ) : (
                <BookmarkOutlineIcon className="h-5 w-5" />
              )}
            </button>
          )}
          <SelectionCheckbox
            selected={isContainerSelected}
            ariaLabel={isContainerSelected ? t('Deselect group') : t('Select group')}
            onClick={(event) => {
              event.stopPropagation();
              if (selectionKey) toggleSelectionKey(selectionKey);
            }}
          />
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          {isDesktop && (
            <button
              type="button"
              className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-colors ${
                isBookmarked
                  ? "text-amber-500 hover:bg-amber-500/10"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-100"
              }`}
              aria-pressed={isBookmarked}
              aria-label={isBookmarked ? t("Remove bookmark") : t("Bookmark")}
              onClick={(event) => {
                event.stopPropagation();
                onToggleBookmark();
              }}
            >
              {isBookmarked ? (
                <BookmarkIconSvg className="h-5 w-5" />
              ) : (
                <BookmarkOutlineIcon className="h-5 w-5" />
              )}
            </button>
          )}
          <WorkflowObjectContextMenu
            ariaLabel={`${containerType} options`}
            buttonRef={menuButtonRef}
            triggerIcon={!isDesktop && isBookmarked ? (
              <BookmarkIconSvg className="w-5 h-5 text-amber-500" />
            ) : containerType === "subgraph" ? (
              <WorkflowIcon className="w-5 h-5 -scale-x-100 text-cyan-300" />
            ) : (
              undefined
            )}
            onBeforeToggle={() => setColorPopoverOpen(false)}
            sections={{
              cosmetic: [
                {
                  key: 'edit-label',
                  label: t('Edit label'),
                  icon: <EditIcon className="w-4 h-4" />,
                  onSelect: () => {
                    setLabelValue(displayTitle);
                    setIsEditingLabel(true);
                  },
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
                  onSelect: openColorPopover,
                  hidden: !canChangeColor,
                },
              ],
              bookmarkNavigation: [
                {
                  key: 'toggle-bookmark',
                  label: isBookmarked ? t('Remove bookmark') : t('Bookmark'),
                  icon: isBookmarked
                    ? <BookmarkIconSvg className="w-4 h-4 text-amber-500" />
                    : <BookmarkOutlineIcon className="w-4 h-4" />,
                  onSelect: onToggleBookmark,
                  hidden: isDesktop,
                },
              ],
              actions: [
                {
                  key: 'select-group',
                  label: t('Select'),
                  icon: <CheckIcon className="w-4 h-4" />,
                  onSelect: () => {
                    if (!selectionKey) return;
                    enterSelectionMode();
                    selectSelectionKeys([selectionKey]);
                  },
                  hidden: !canSelectFromMenu,
                },
                {
                  key: 'bypass-all',
                  label: t('Bypass all nodes'),
                  icon: <BypassToggleIcon isBypassed className="w-4 h-4" />,
                  onSelect: () => onBypassAll(true),
                  hidden: !showBypassAllAction,
                },
                {
                  key: 'unbypass-all',
                  label: t('Engage all nodes'),
                  icon: <BypassToggleIcon isBypassed={false} className="w-4 h-4" />,
                  onSelect: () => onBypassAll(false),
                  hidden: !showUnbypassAllAction,
                },
                {
                  key: 'hide-container',
                  label: t('Hide'),
                  icon: <EyeOffIcon className="w-4 h-4" />,
                  onSelect: onHide,
                },
                {
                  key: 'duplicate-container',
                  label: t('Duplicate'),
                  icon: <CopyIcon className="w-4 h-4" />,
                  onSelect: onDuplicate,
                },
                {
                  key: 'copy-container',
                  label: t('Copy'),
                  icon: <ClipboardIcon className="w-4 h-4" />,
                  onSelect: onCopy,
                },
                {
                  key: 'paste-into-container',
                  label: pasteSummary ? t('Paste {summary} here', { summary: pasteSummary }) : t('Paste here'),
                  icon: <ClipboardDownloadIcon className="w-4 h-4" />,
                  onSelect: onPaste,
                  hidden: !pasteSummary,
                },
                {
                  key: 'move-container',
                  label: t('Move'),
                  icon: <MoveUpDownIcon className="w-4 h-4" />,
                  onSelect: onMove,
                },
                {
                  key: 'move-into-subgraph',
                  label: t('Move into subgraph'),
                  icon: <ArrowRightIcon className="w-4 h-4" />,
                  onSelect: onMoveIntoSubgraph,
                  hidden: !onMoveIntoSubgraph,
                },
              ],
              special: [
                {
                  key: 'add-node',
                  label: t('Add node'),
                  icon: <PlusIcon className="w-4 h-4" />,
                  onSelect: onAddNode,
                },
                {
                  key: 'fold-all',
                  label: canFoldAll ? t('Fold all') : t('Unfold all'),
                  icon: canFoldAll
                    ? <CaretRightIcon className="w-4 h-4" />
                    : <CaretDownIcon className="w-4 h-4" />,
                  onSelect: onToggleFoldAll,
                  hidden: isCollapsed && !canFoldAll,
                },
                {
                  key: 'show-hidden-nodes',
                  label: t('Show hidden nodes'),
                  icon: <EyeOffIcon className="w-4 h-4" />,
                  onSelect: onShowHiddenNodes,
                  hidden: !hasHiddenNodes,
                },
              ],
              delete: [
                {
                  key: 'delete-container',
                  label: t('Delete'),
                  icon: <TrashIcon className="w-4 h-4" />,
                  color: 'danger',
                  onSelect: onDelete,
                },
              ],
            }}
          />
        </div>
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
    </div>
  );
}
