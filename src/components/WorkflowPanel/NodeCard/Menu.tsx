import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BypassToggleIcon, BookmarkIconSvg, BookmarkOutlineIcon, CheckIcon, ClipboardIcon, ClipboardDownloadIcon, CopyIcon, EyeIcon, EyeOffIcon, MoveUpDownIcon, NodeConnectionsIcon, EditIcon, ExternalLinkIcon, PinIconSvg, PinOutlineIcon, PromotedWidgetIcon, SaveDiskIcon, TrashIcon, ArrowRightIcon, WorkflowIcon } from '@/components/icons';
import { useWorkflowSelectionStore } from '@/hooks/useWorkflowSelection';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { openLoraManagerUiInNewTab } from '@/utils/loraManagerUi';
import { resolveWorkflowColor, themeColors, workflowColorPickerOptions } from '@/theme/colors';
import { useI18n } from '@/i18n';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { SubgraphActionsModal } from '@/components/modals/SubgraphActionsModal';
import { WidgetPickerModal } from '@/components/modals/WidgetPickerModal';
import { WorkflowObjectContextMenu } from '@/components/WorkflowPanel/WorkflowObjectContextMenu';
import type { PromotableWidget } from '@/utils/promotableWidgets';

interface PinnableWidget {
  widgetIndex: number;
  name: string;
  inputName?: string;
  type: string;
  options?: Record<string, unknown> | unknown[];
}

interface NodeCardMenuProps {
  nodeId: number;
  nodeHierarchicalKey: string;
  // Current ComfyUI node class name. Used to gate the PreviewImage ↔ SaveImage
  // conversion items so they only surface on the relevant nodes.
  nodeType: string;
  isLoraManagerNode: boolean;
  showFastGroupsConfigAction: boolean;
  isBypassed: boolean;
  onEnterSubgraph?: () => void;
  // Subgraph-type actions, provided only for subgraph placeholder cards.
  // onReplaceSubgraph is provided only when another type exists to swap to.
  onReplaceSubgraph?: () => void;
  onDissolveSubgraph?: () => void;
  onEditSubgraphLabels?: () => void;
  onPopOutToRoot?: () => void;
  onEditLabel: () => void;
  // Provided only for SetNodes: starts inline rename of the relay name (the
  // outgoing connection label becomes an input).
  onEditSetName?: () => void;
  onEditFastGroupsConfig?: () => void;
  nodeColor?: string;
  onChangeColor: (color: string) => void;
  pinnableWidgets: PinnableWidget[];
  singlePinnableWidget: PinnableWidget | null;
  isSingleWidgetPinned: boolean;
  hasPinnedWidget: boolean;
  toggleWidgetPin: (
    widgetIndex: number,
    widgetName: string,
    widgetType: string,
    options?: Record<string, unknown> | unknown[],
    inputName?: string,
  ) => void;
  setPinnedWidget: (pin: {
    nodeId: number;
    widgetIndex: number;
    widgetName: string;
    inputName?: string;
    widgetType: string;
    options?: Record<string, unknown> | unknown[];
  } | null) => void;
  promotableWidgets?: PromotableWidget[];
  onPromoteWidget?: (widget: PromotableWidget) => void;
  isNodeBookmarked: boolean;
  onToggleNodeBookmark: () => void;
  toggleBypass: (itemKey: string) => void;
  setItemHidden: (itemKey: string, hidden: boolean) => void;
  onDeleteNode: () => void;
  onDuplicateNode: () => void;
  onCopyNode: () => void;
  onPasteBelow: () => void;
  pasteSummary: string | null;
  onMoveNode: () => void;
  onMoveIntoSubgraph?: () => void;
  // Fired by the conversion menu items. Receives the desired target type; the
  // store decides whether the node is actually convertible. Optional so callers
  // that don't care about this feature aren't forced to wire it.
  onConvertImageOutputNode?: (target: 'PreviewImage' | 'SaveImage') => void;
  connectionHighlightMode: 'off' | 'inputs' | 'outputs' | 'both';
  setConnectionHighlightMode: (itemKey: string, mode: 'off' | 'inputs' | 'outputs' | 'both') => void;
  leftLineCount: number;
  rightLineCount: number;
}

export function NodeCardMenu({
  nodeId,
  nodeHierarchicalKey,
  nodeType,
  isLoraManagerNode,
  showFastGroupsConfigAction,
  isBypassed,
  onEnterSubgraph,
  onReplaceSubgraph,
  onDissolveSubgraph,
  onEditSubgraphLabels,
  onPopOutToRoot,
  onEditLabel,
  onEditSetName,
  onEditFastGroupsConfig,
  nodeColor = '',
  onChangeColor,
  pinnableWidgets,
  singlePinnableWidget,
  isSingleWidgetPinned,
  hasPinnedWidget,
  toggleWidgetPin,
  setPinnedWidget,
  promotableWidgets = [],
  onPromoteWidget,
  isNodeBookmarked,
  onToggleNodeBookmark,
  toggleBypass,
  setItemHidden,
  onDeleteNode,
  onDuplicateNode,
  onCopyNode,
  onPasteBelow,
  pasteSummary,
  onMoveNode,
  onMoveIntoSubgraph,
  onConvertImageOutputNode,
  connectionHighlightMode,
  setConnectionHighlightMode,
  leftLineCount,
  rightLineCount
}: NodeCardMenuProps) {
  const { t } = useI18n();
  const isDesktop = useIsDesktop();
  const resolvedNodeColor = resolveWorkflowColor(nodeColor);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  // Which widget picker is open, if any. Both actions need to be told WHICH
  // widget when a node has several, and both ask in a modal rather than by
  // unfolding the menu into a list.
  const [widgetPicker, setWidgetPicker] = useState<'pin' | 'promote' | null>(null);
  const [subgraphActionsOpen, setSubgraphActionsOpen] = useState(false);
  const enterSelectionMode = useWorkflowSelectionStore((s) => s.enterSelectionMode);
  const selectSelectionKeys = useWorkflowSelectionStore((s) => s.selectKeys);
  const colorPopoverRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [colorPopoverStyle, setColorPopoverStyle] = useState<{
    bottom: number;
    left: number;
    width: number;
    visibility: 'visible' | 'hidden';
  }>({
    bottom: -9999,
    left: -9999,
    width: 0,
    visibility: 'hidden'
  });
  useLayoutEffect(() => {
    if (!colorPopoverOpen) return;

    const updateColorPopoverPosition = () => {
      const anchor = document.getElementById(`node-card-${nodeId}`);
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const width = Math.min(anchorRect.width, 400);
      setColorPopoverStyle({
        bottom: Math.max(8, window.innerHeight - anchorRect.top + 6),
        left: anchorRect.left,
        width,
        visibility: 'visible'
      });
    };

    updateColorPopoverPosition();
    const raf1 = requestAnimationFrame(updateColorPopoverPosition);
    const raf2 = requestAnimationFrame(updateColorPopoverPosition);
    window.addEventListener('resize', updateColorPopoverPosition);
    window.addEventListener('scroll', updateColorPopoverPosition, true);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.removeEventListener('resize', updateColorPopoverPosition);
      window.removeEventListener('scroll', updateColorPopoverPosition, true);
    };
  }, [colorPopoverOpen, nodeId]);

  useDismissOnOutsideClick({
    open: colorPopoverOpen,
    onDismiss: () => setColorPopoverOpen(false),
    triggerRef: menuButtonRef,
    contentRef: colorPopoverRef,
    ignoreScrollWithinContent: true
  });

  const hasConnections = leftLineCount > 0 || rightLineCount > 0;

  const handleHighlightConnections = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const hasInputs = leftLineCount > 0;
    const hasOutputs = rightLineCount > 0;
    if (!hasInputs && !hasOutputs) return;
    const validModes = hasInputs && hasOutputs
      ? ['off', 'inputs', 'outputs', 'both']
      : hasInputs
        ? ['off', 'inputs']
        : ['off', 'outputs'];
    const currentIndex = validModes.indexOf(connectionHighlightMode);
    const nextMode = validModes[(currentIndex + 1) % validModes.length] as typeof connectionHighlightMode;
    setConnectionHighlightMode(nodeHierarchicalKey, nextMode);
  };

  const handleSinglePin = () => {
    if (!singlePinnableWidget) return;
    toggleWidgetPin(
      singlePinnableWidget.widgetIndex,
      singlePinnableWidget.name,
      singlePinnableWidget.type,
      singlePinnableWidget.options,
      singlePinnableWidget.inputName,
    );
  };

  const handleRemovePin = () => {
    setPinnedWidget(null);
  };



  const handlePinWidget = (widget: PinnableWidget) => {
    setPinnedWidget({
      nodeId,
      widgetIndex: widget.widgetIndex,
      widgetName: widget.name,
      inputName: widget.inputName,
      widgetType: widget.type,
      options: widget.options
    });
  };

  return (
    <div className="flex items-center gap-1 relative" onClick={(e) => e.stopPropagation()}>
      {hasConnections && (
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center"
          aria-pressed={connectionHighlightMode !== 'off'}
          aria-label={t('Highlight connected nodes')}
          onClick={handleHighlightConnections}
        >
          <NodeConnectionsIcon
            className="w-6 h-6 overflow-visible"
            nodeId={nodeId}
            connectionHighlightMode={connectionHighlightMode}
            leftLineCount={leftLineCount}
            rightLineCount={rightLineCount}
          />
        </button>
      )}
      {isDesktop && (
        <button
          type="button"
          className={`flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-colors ${
            isNodeBookmarked
              ? 'text-amber-500 hover:bg-amber-500/10'
              : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
          } disabled:cursor-not-allowed disabled:opacity-35`}
          aria-pressed={isNodeBookmarked}
          aria-label={isNodeBookmarked ? t('Remove bookmark') : t('Bookmark node')}
          onClick={(event) => {
            event.stopPropagation();
            onToggleNodeBookmark();
          }}
        >
          {isNodeBookmarked ? (
            <BookmarkIconSvg className="h-5 w-5" />
          ) : (
            <BookmarkOutlineIcon className="h-5 w-5" />
          )}
        </button>
      )}
      <WorkflowObjectContextMenu
        buttonRef={menuButtonRef}
        ariaLabel={t('Node options')}
        triggerIcon={!isDesktop && isNodeBookmarked
            ? <BookmarkIconSvg className="w-5 h-5 text-amber-500" />
            : onEnterSubgraph
            ? <WorkflowIcon className="w-5 h-5 -scale-x-100 text-cyan-300" />
            : undefined
        }
        onBeforeToggle={() => setColorPopoverOpen(false)}
        // NOT onClose: choosing "Change color" opens the popover and then
        // closes the menu, so closing the popover from the menu's own close
        // shut it in the same tick and the picker could never be reached. The
        // popover dismisses itself on an outside tap, and re-opening the menu
        // resets it through onBeforeToggle above.
        sections={{
          cosmetic: [
            // First in the menu, ahead of the cosmetic entries this section is
            // otherwise made of: on a subgraph card, going inside is the reason
            // the menu was opened nine times out of ten.
            {
              key: 'enter-subgraph',
              label: t('Enter subgraph'),
              icon: <ArrowRightIcon className="w-4 h-4" />,
              onSelect: onEnterSubgraph,
              hidden: !onEnterSubgraph,
            },
            {
              key: 'edit-label',
              label: t('Edit label'),
              icon: <EditIcon className="w-4 h-4" />,
              onSelect: onEditLabel,
            },
            {
              key: 'change-color',
              label: t('Change color'),
              icon: (
                <span
                  className="inline-block w-3 h-3 rounded-full"
                  style={{ backgroundColor: resolvedNodeColor || themeColors.workflow.defaultGroupDot }}
                />
              ),
              onSelect: () => setColorPopoverOpen(true),
            },
          ],
          bookmarkNavigation: [
            {
              key: 'toggle-bookmark',
              label: isNodeBookmarked ? t('Remove bookmark') : t('Bookmark'),
              icon: isNodeBookmarked
                ? <BookmarkIconSvg className="w-4 h-4 text-amber-500" />
                : <BookmarkOutlineIcon className="w-4 h-4" />,
              onSelect: onToggleNodeBookmark,
              hidden: isDesktop,
            },
            {
              key: 'pop-out-to-root',
              label: t('Pop out to root'),
              icon: <ExternalLinkIcon className="w-4 h-4" />,
              onSelect: onPopOutToRoot,
              hidden: !onPopOutToRoot,
            },
          ],
          actions: [
            {
              key: 'select-node',
              label: t('Select'),
              icon: <CheckIcon className="w-4 h-4" />,
              onSelect: () => {
                enterSelectionMode();
                selectSelectionKeys([nodeHierarchicalKey]);
              },
            },
            {
              key: 'toggle-bypass',
              // A subgraph placeholder's mode applies to this instance only.
              label: isBypassed ? t('Engage') : t('Bypass'),
              icon: <BypassToggleIcon className="w-4 h-4" isBypassed={isBypassed} />,
              onSelect: () => toggleBypass(nodeHierarchicalKey),
            },
            {
              key: 'hide-node',
              label: t('Hide'),
              icon: <EyeOffIcon className="w-4 h-4" />,
              onSelect: () => setItemHidden(nodeHierarchicalKey, true),
            },
            {
              key: 'duplicate-node',
              label: t('Duplicate'),
              icon: <CopyIcon className="w-4 h-4" />,
              onSelect: onDuplicateNode,
            },
            {
              key: 'copy-node',
              label: t('Copy'),
              icon: <ClipboardIcon className="w-4 h-4" />,
              onSelect: onCopyNode,
            },
            {
              key: 'paste-below',
              label: pasteSummary ? t('Paste {summary} below', { summary: pasteSummary }) : t('Paste below'),
              icon: <ClipboardDownloadIcon className="w-4 h-4" />,
              onSelect: onPasteBelow,
              hidden: !pasteSummary,
            },
            {
              key: 'move-node',
              label: t('Move'),
              icon: <MoveUpDownIcon className="w-4 h-4" />,
              onSelect: onMoveNode,
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
              key: 'subgraph-actions',
              label: t('Subgraph actions'),
              icon: <WorkflowIcon className="w-4 h-4 -scale-x-100" />,
              onSelect: () => setSubgraphActionsOpen(true),
              hidden: !onReplaceSubgraph && !onEditSubgraphLabels && !onDissolveSubgraph,
            },
            {
              key: 'edit-set-name',
              label: t('Edit set name'),
              icon: <EditIcon className="w-4 h-4" />,
              onSelect: onEditSetName,
              hidden: !onEditSetName,
            },
            {
              key: 'edit-fast-groups-config',
              label: t('Edit config'),
              icon: <EditIcon className="w-4 h-4" />,
              onSelect: onEditFastGroupsConfig,
              hidden: !showFastGroupsConfigAction,
            },
            {
              key: 'convert-to-save-image',
              label: t('Convert to Save Image'),
              icon: <SaveDiskIcon className="w-4 h-4" />,
              onSelect: () => onConvertImageOutputNode?.('SaveImage'),
              hidden: !onConvertImageOutputNode || nodeType !== 'PreviewImage',
            },
            {
              key: 'convert-to-preview-image',
              label: t('Convert to Preview Image'),
              icon: <EyeIcon className="w-4 h-4" />,
              onSelect: () => onConvertImageOutputNode?.('PreviewImage'),
              hidden: !onConvertImageOutputNode || nodeType !== 'SaveImage',
            },
            {
              key: 'open-lora-manager',
              label: t('Open LoRA Manager'),
              icon: <ExternalLinkIcon className="w-4 h-4" />,
              onSelect: openLoraManagerUiInNewTab,
              hidden: !isLoraManagerNode,
            },
            {
              key: 'promote-single-widget',
              label: t('Promote widget'),
              icon: <PromotedWidgetIcon className="w-4 h-4 text-pink-400" />,
              onSelect: () => {
                const widget = promotableWidgets[0];
                if (widget) onPromoteWidget?.(widget);
              },
              hidden: !(onPromoteWidget && promotableWidgets.length === 1),
            },
            {
              key: 'promote-widget-picker',
              label: t('Promote widget'),
              icon: <PromotedWidgetIcon className="w-4 h-4 text-pink-400" />,
              onSelect: () => setWidgetPicker('promote'),
              hidden: !(onPromoteWidget && promotableWidgets.length > 1),
            },
            {
              key: 'pin-single-widget',
              label: isSingleWidgetPinned ? t('Remove pin') : t('Pin widget'),
              icon: isSingleWidgetPinned
                ? <PinIconSvg className="w-4 h-4 text-fuchsia-500" />
                : <PinOutlineIcon className="w-4 h-4" />,
              onSelect: handleSinglePin,
              hidden: !(pinnableWidgets.length > 0 && Boolean(singlePinnableWidget)),
            },
            {
              key: 'remove-pin',
              label: t('Remove pin'),
              icon: <PinIconSvg className="w-4 h-4 text-fuchsia-500" />,
              onSelect: handleRemovePin,
              hidden: !(pinnableWidgets.length > 0 && !singlePinnableWidget && hasPinnedWidget),
            },
            {
              key: 'pin-widget-picker',
              label: t('Pin widget'),
              icon: <PinOutlineIcon className="w-4 h-4" />,
              onSelect: () => setWidgetPicker('pin'),
              hidden: !(pinnableWidgets.length > 0 && !singlePinnableWidget),
            },
          ],
          delete: [
            {
              key: 'delete-node',
              label: t('Delete'),
              icon: <TrashIcon className="w-4 h-4" />,
              color: 'danger',
              onSelect: onDeleteNode,
            },
          ],
        }}
      />
      {colorPopoverOpen && createPortal(
        <div
          ref={colorPopoverRef}
          className="fixed z-[1100] bg-slate-900 border border-white/10 rounded-lg shadow-lg p-2"
          style={colorPopoverStyle}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-2">
            {workflowColorPickerOptions.map(({ key, label, color }, index) => {
              const isSelected = color.toLowerCase() === resolvedNodeColor.toLowerCase();
              return (
                <button
                  key={`${key}-${index}`}
                  type="button"
                  title={label}
                  aria-label={t('Set color: {label}', { label })}
                  className={`w-9 aspect-square rounded-full transition-transform active:scale-95 ${
                    isSelected ? 'ring-2 ring-offset-1 ring-cyan-300 ring-offset-slate-900' : ''
                  }`}
                  style={{ backgroundColor: color }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChangeColor(color);
                    setColorPopoverOpen(false);
                  }}
                />
              );
            })}
          </div>
        </div>,
        document.body
      )}
      {widgetPicker === 'pin' && (
        <WidgetPickerModal
          title={t('Pin widget')}
          icon={<PinOutlineIcon className="h-5 w-5 text-fuchsia-400" />}
          entries={pinnableWidgets.map((widget) => ({
            key: String(widget.widgetIndex),
            label: widget.name,
          }))}
          onPick={(key) => {
            const widget = pinnableWidgets.find(
              (candidate) => String(candidate.widgetIndex) === key,
            );
            if (widget) handlePinWidget(widget);
          }}
          onClose={() => setWidgetPicker(null)}
        />
      )}
      {widgetPicker === 'promote' && (
        <WidgetPickerModal
          title={t('Promote widget')}
          icon={<PromotedWidgetIcon className="h-5 w-5 text-pink-400" />}
          entries={promotableWidgets.map((widget) => ({
            key: `${widget.widgetIndex}:${widget.inputName}`,
            label: widget.name,
          }))}
          onPick={(key) => {
            const widget = promotableWidgets.find(
              (candidate) => `${candidate.widgetIndex}:${candidate.inputName}` === key,
            );
            if (widget) onPromoteWidget?.(widget);
          }}
          onClose={() => setWidgetPicker(null)}
        />
      )}
      {subgraphActionsOpen && (
        <SubgraphActionsModal
          onReplace={onReplaceSubgraph}
          onEditWidgetLabels={onEditSubgraphLabels}
          onDissolve={onDissolveSubgraph}
          onClose={() => setSubgraphActionsOpen(false)}
        />
      )}
    </div>
  );
}
