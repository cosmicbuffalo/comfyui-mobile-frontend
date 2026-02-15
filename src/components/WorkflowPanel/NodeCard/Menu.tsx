import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BypassToggleIcon, BookmarkIconSvg, BookmarkOutlineIcon, ChevronRightIcon, EyeOffIcon, MoveUpDownIcon, NodeConnectionsIcon, EditIcon, PinIconSvg, PinOutlineIcon, TrashIcon } from '@/components/icons';
import { useAnchoredMenuPosition } from '@/hooks/useAnchoredMenuPosition';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { ContextMenuButton } from '@/components/buttons/ContextMenuButton';
import { ContextMenuBuilder } from '@/components/menus/ContextMenuBuilder';

interface PinnableWidget {
  widgetIndex: number;
  name: string;
  type: string;
  options?: Record<string, unknown> | unknown[];
}

interface NodeCardMenuProps {
  nodeId: number;
  nodeStableKey: string | null;
  isBypassed: boolean;
  onEditLabel: () => void;
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
  toggleBypass: (stableKey: string) => void;
  setItemHidden: (stableKey: string, hidden: boolean) => void;
  onDeleteNode: () => void;
  onMoveNode: () => void;
  connectionHighlightMode: 'off' | 'inputs' | 'outputs' | 'both';
  setConnectionHighlightMode: (stableKey: string, mode: 'off' | 'inputs' | 'outputs' | 'both') => void;
  leftLineCount: number;
  rightLineCount: number;
}

export function NodeCardMenu({
  nodeId,
  nodeStableKey,
  isBypassed,
  onEditLabel,
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinSubmenuOpen, setPinSubmenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => {
    setMenuOpen(false);
    setPinSubmenuOpen(false);
    resetMenuPosition();
  };

  const { menuStyle, resetMenuPosition } = useAnchoredMenuPosition({
    open: menuOpen,
    buttonRef: menuButtonRef,
    menuRef,
    repositionToken: pinSubmenuOpen
  });

  useDismissOnOutsideClick({
    open: menuOpen,
    onDismiss: closeMenu,
    triggerRef: menuButtonRef,
    contentRef: menuRef,
    ignoreScrollWithinContent: true
  });

  const hasConnections = leftLineCount > 0 || rightLineCount > 0;

  const handleHighlightConnections = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!nodeStableKey) return;
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
    setConnectionHighlightMode(nodeStableKey, nextMode);
  };

  const handleToggleMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    resetMenuPosition();
    setMenuOpen((prev) => !prev);
  };

  const handleEditLabelClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onEditLabel();
    closeMenu();
  };

  const handleToggleBypassClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!nodeStableKey) return;
    toggleBypass(nodeStableKey);
    closeMenu();
  };

  const handleHideNodeClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!nodeStableKey) return;
    setItemHidden(nodeStableKey, true);
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
        icon={isNodeBookmarked ? <BookmarkIconSvg className="w-5 h-5 text-yellow-500" /> : undefined}
      />

      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[1000] w-44"
          style={menuStyle}
        >
          <ContextMenuBuilder
            items={[
              {
                key: 'edit-label',
                label: 'Edit Label',
                icon: <EditIcon className="w-4 h-4" />,
                onClick: handleEditLabelClick
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
                onClick: handleToggleBypassClick
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
