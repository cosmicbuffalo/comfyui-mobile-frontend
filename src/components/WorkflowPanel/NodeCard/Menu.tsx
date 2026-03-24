import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BypassToggleIcon, BookmarkIconSvg, BookmarkOutlineIcon, ChevronRightIcon, EyeOffIcon, MoveUpDownIcon, NodeConnectionsIcon, EditIcon, ExternalLinkIcon, PinIconSvg, PinOutlineIcon, TrashIcon, ArrowRightIcon, WorkflowIcon } from '@/components/icons';
import { useAnchoredMenuPosition } from '@/hooks/useAnchoredMenuPosition';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';
import { openLoraManagerUiInNewTab } from '@/utils/loraManagerUi';
import { resolveWorkflowColor, themeColors, workflowColorPickerOptions } from '@/theme/colors';

interface PinnableWidget {
  widgetIndex: number;
  name: string;
  type: string;
  options?: Record<string, unknown> | unknown[];
}

interface NodeCardMenuProps {
  nodeId: number;
  nodeHierarchicalKey: string;
  isLoraManagerNode: boolean;
  showFastGroupsConfigAction: boolean;
  isBypassed: boolean;
  onEnterSubgraph?: () => void;
  onEditLabel: () => void;
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
    options?: Record<string, unknown> | unknown[]
  ) => void;
  setPinnedWidget: (pin: {
    nodeId: number;
    widgetIndex: number;
    widgetName: string;
    widgetType: string;
    options?: Record<string, unknown> | unknown[];
  } | null) => void;
  isNodeBookmarked: boolean;
  canAddNodeBookmark: boolean;
  onToggleNodeBookmark: () => void;
  toggleBypass: (itemKey: string) => void;
  setItemHidden: (itemKey: string, hidden: boolean) => void;
  onDeleteNode: () => void;
  onMoveNode: () => void;
  connectionHighlightMode: 'off' | 'inputs' | 'outputs' | 'both';
  setConnectionHighlightMode: (itemKey: string, mode: 'off' | 'inputs' | 'outputs' | 'both') => void;
  leftLineCount: number;
  rightLineCount: number;
}

export function NodeCardMenu({
  nodeId,
  nodeHierarchicalKey,
  isLoraManagerNode,
  showFastGroupsConfigAction,
  isBypassed,
  onEnterSubgraph,
  onEditLabel,
  onEditFastGroupsConfig,
  nodeColor = '',
  onChangeColor,
  pinnableWidgets,
  singlePinnableWidget,
  isSingleWidgetPinned,
  hasPinnedWidget,
  toggleWidgetPin,
  setPinnedWidget,
  isNodeBookmarked,
  canAddNodeBookmark,
  onToggleNodeBookmark,
  toggleBypass,
  setItemHidden,
  onDeleteNode,
  onMoveNode,
  connectionHighlightMode,
  setConnectionHighlightMode,
  leftLineCount,
  rightLineCount
}: NodeCardMenuProps) {
  const resolvedNodeColor = resolveWorkflowColor(nodeColor);
  const [menuOpen, setMenuOpen] = useState(false);
  const [colorPopoverOpen, setColorPopoverOpen] = useState(false);
  const [pinSubmenuOpen, setPinSubmenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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
  const closeMenu = () => {
    setMenuOpen(false);
    setColorPopoverOpen(false);
    setPinSubmenuOpen(false);
    resetMenuPosition();
  };

  const { menuStyle, resetMenuPosition } = useAnchoredMenuPosition({
    open: menuOpen,
    buttonRef: menuButtonRef,
    menuRef,
    repositionToken: pinSubmenuOpen
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
    open: menuOpen,
    onDismiss: closeMenu,
    triggerRef: menuButtonRef,
    contentRef: menuRef,
    ignoreScrollWithinContent: true
  });
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

  const handleToggleMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    resetMenuPosition();
    setColorPopoverOpen(false);
    setMenuOpen((prev) => !prev);
  };

  const handleEditLabelClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onEditLabel();
    closeMenu();
  };

  const handleToggleBypassClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleBypass(nodeHierarchicalKey);
    closeMenu();
  };

  const handleHideNodeClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setItemHidden(nodeHierarchicalKey, true);
    closeMenu();
  };

  const handleOpenLoraManagerClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    openLoraManagerUiInNewTab();
    closeMenu();
  };

  const handleSinglePinClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!singlePinnableWidget) return;
    toggleWidgetPin(
      singlePinnableWidget.widgetIndex,
      singlePinnableWidget.name,
      singlePinnableWidget.type,
      singlePinnableWidget.options
    );
    closeMenu();
  };

  const handleRemovePinClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setPinnedWidget(null);
    closeMenu();
  };

  const handlePinSubmenuToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setPinSubmenuOpen(!pinSubmenuOpen);
  };

  const handlePinWidgetClick = (widget: PinnableWidget) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setPinnedWidget({
      nodeId,
      widgetIndex: widget.widgetIndex,
      widgetName: widget.name,
      widgetType: widget.type,
      options: widget.options
    });
    closeMenu();
  };

  return (
    <div className="flex items-center gap-1 relative" onClick={(e) => e.stopPropagation()}>
      {hasConnections && (
        <button
          type="button"
          className="w-8 h-8 flex items-center justify-center"
          aria-pressed={connectionHighlightMode !== 'off'}
          aria-label="Highlight connected nodes"
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
      <ContextMenuButton
        onClick={handleToggleMenu}
        buttonRef={menuButtonRef}
        ariaLabel="Node options"
        buttonSize={8}
        iconSize={5}
        icon={isNodeBookmarked
          ? <BookmarkIconSvg className="w-5 h-5 text-yellow-500" />
          : onEnterSubgraph
            ? <WorkflowIcon className="w-5 h-5 -scale-x-100 text-blue-500" />
            : undefined
        }
      />
      {colorPopoverOpen && createPortal(
        <div
          ref={colorPopoverRef}
          className="fixed z-[1100] bg-white border border-gray-200 rounded-lg shadow-lg p-2"
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
                  aria-label={`Set color: ${label}`}
                  className={`w-9 aspect-square rounded-full transition-transform active:scale-95 ${
                    isSelected ? 'ring-2 ring-offset-1 ring-gray-400' : ''
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

      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] w-44"
          style={menuStyle}
        >
          <ContextMenuBuilder
            items={[
              {
                key: 'enter-subgraph',
                label: 'Enter subgraph',
                icon: <ArrowRightIcon className="w-4 h-4" />,
                onClick: (event) => {
                  event.stopPropagation();
                  onEnterSubgraph?.();
                  closeMenu();
                },
                hidden: !onEnterSubgraph
              },
              {
                type: 'divider',
                key: 'divider-enter-subgraph',
                className: onEnterSubgraph ? '' : 'hidden'
              },
              {
                key: 'edit-label',
                label: 'Edit label',
                icon: <EditIcon className="w-4 h-4" />,
                onClick: handleEditLabelClick
              },
              {
                key: 'change-color',
                label: 'Change color',
                icon: (
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: resolvedNodeColor || themeColors.workflow.defaultGroupDot }}
                  />
                ),
                onClick: (event) => {
                  event.stopPropagation();
                  setMenuOpen(false);
                  setPinSubmenuOpen(false);
                  resetMenuPosition();
                  setColorPopoverOpen(true);
                }
              },
              {
                key: 'edit-fast-groups-config',
                label: 'Edit config',
                icon: <EditIcon className="w-4 h-4" />,
                onClick: (event) => {
                  event.stopPropagation();
                  onEditFastGroupsConfig?.();
                  closeMenu();
                },
                hidden: !showFastGroupsConfigAction
              },
              {
                type: 'divider',
                key: 'divider-top-edit-color'
              },
              {
                key: 'toggle-bookmark',
                label: isNodeBookmarked ? 'Remove bookmark' : 'Bookmark node',
                icon: isNodeBookmarked
                  ? <BookmarkOutlineIcon className="w-4 h-4" />
                  : <BookmarkIconSvg className="w-4 h-4 text-yellow-500" />,
                onClick: (event) => {
                  event.stopPropagation();
                  onToggleNodeBookmark();
                  closeMenu();
                },
                hidden: !(isNodeBookmarked || canAddNodeBookmark)
              },
              {
                type: 'divider',
                key: 'divider-node-actions'
              },
              {
                key: 'toggle-bypass',
                label: isBypassed ? 'Engage node' : 'Bypass node',
                icon: <BypassToggleIcon className="w-4 h-4" isBypassed={isBypassed} />,
                onClick: handleToggleBypassClick,
                // Subgraph placeholder bypass is derived from inner node bypass states.
                // Hiding this action prevents placeholder mode from drifting out of sync.
                hidden: Boolean(onEnterSubgraph)
              },
              {
                key: 'hide-node',
                label: 'Hide node',
                icon: <EyeOffIcon className="w-4 h-4" />,
                onClick: handleHideNodeClick
              },
              {
                key: 'move-node',
                label: 'Move',
                icon: <MoveUpDownIcon className="w-4 h-4" />,
                onClick: (event) => {
                  event.stopPropagation();
                  onMoveNode();
                  closeMenu();
                }
              },
              {
                key: 'open-lora-manager',
                label: 'Open LoRA Manager',
                icon: <ExternalLinkIcon className="w-4 h-4" />,
                onClick: handleOpenLoraManagerClick,
                hidden: !isLoraManagerNode
              },
              {
                type: 'divider',
                key: 'divider-pin',
                className: pinnableWidgets.length > 0 ? '' : 'hidden'
              },
              {
                key: 'pin-single-widget',
                label: isSingleWidgetPinned ? 'Remove pin' : 'Pin widget',
                icon: isSingleWidgetPinned
                  ? <PinIconSvg className="w-4 h-4 text-fuchsia-500" />
                  : <PinOutlineIcon className="w-4 h-4" />,
                onClick: handleSinglePinClick,
                hidden: !(pinnableWidgets.length > 0 && Boolean(singlePinnableWidget))
              },
              {
                key: 'remove-pin',
                label: 'Remove pin',
                icon: <PinIconSvg className="w-4 h-4 text-fuchsia-500" />,
                onClick: handleRemovePinClick,
                hidden: !(pinnableWidgets.length > 0 && !singlePinnableWidget && hasPinnedWidget)
              },
              {
                key: 'pin-widget-submenu',
                label: 'Pin widget',
                icon: <PinOutlineIcon className="w-4 h-4" />,
                rightSlot: (
                  <ChevronRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${pinSubmenuOpen ? 'rotate-90' : ''}`} />
                ),
                onClick: handlePinSubmenuToggle,
                hidden: !(pinnableWidgets.length > 0 && !singlePinnableWidget)
              },
              {
                type: 'custom',
                key: 'pin-widget-items',
                hidden: !(pinnableWidgets.length > 0 && !singlePinnableWidget && pinSubmenuOpen),
                render: (
                  <div className="border-t border-gray-100 bg-gray-50 max-h-48 overflow-auto">
                    {pinnableWidgets.map((widget) => (
                      <button
                        key={widget.widgetIndex}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 text-gray-700"
                        onClick={handlePinWidgetClick(widget)}
                      >
                        {widget.name}
                      </button>
                    ))}
                  </div>
                )
              },
              {
                type: 'divider',
                key: 'divider-delete'
              },
              {
                key: 'delete-node',
                label: 'Delete node',
                icon: <TrashIcon className="w-4 h-4" />,
                color: 'danger',
                onClick: (event) => {
                  event.stopPropagation();
                  onDeleteNode();
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
