import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BypassToggleIcon, BookmarkIconSvg, BookmarkOutlineIcon, ChevronRightIcon, EllipsisVerticalIcon, EyeOffIcon, NodeConnectionsIcon, EditIcon, PinIconSvg, PinOutlineIcon } from '@/components/icons';

interface PinnableWidget {
  widgetIndex: number;
  name: string;
  type: string;
  options?: Record<string, unknown> | unknown[];
}

interface NodeCardMenuProps {
  nodeId: number;
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
  toggleBypass: (nodeId: number) => void;
  hideNode: (nodeId: number) => void;
  connectionHighlightMode: 'off' | 'inputs' | 'outputs' | 'both';
  setConnectionHighlightMode: (nodeId: number, mode: 'off' | 'inputs' | 'outputs' | 'both') => void;
  leftLineCount: number;
  rightLineCount: number;
}

export function NodeCardMenu({
  nodeId,
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
  hideNode,
  connectionHighlightMode,
  setConnectionHighlightMode,
  leftLineCount,
  rightLineCount
}: NodeCardMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pinSubmenuOpen, setPinSubmenuOpen] = useState(false);
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
        setPinSubmenuOpen(false);
      }
    };
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      setMenuOpen(false);
      setPinSubmenuOpen(false);
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

  const hasConnections = leftLineCount > 0 || rightLineCount > 0;

  const closeMenu = () => {
    setMenuOpen(false);
    setPinSubmenuOpen(false);
  };

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
    setConnectionHighlightMode(nodeId, nextMode);
  };

  const handleToggleMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setMenuOpen((prev) => !prev);
  };

  const handleEditLabelClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onEditLabel();
    closeMenu();
  };

  const handleToggleBypassClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleBypass(nodeId);
    closeMenu();
  };

  const handleHideNodeClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    hideNode(nodeId);
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
      {/* Menu */}
      <button
        onClick={handleToggleMenu}
        className="w-8 h-8 flex items-center justify-center text-gray-700 hover:text-gray-900 bg-transparent hover:bg-transparent"
        aria-label="Node options"
        ref={menuButtonRef}
      >
        {isNodeBookmarked ? (
          <BookmarkIconSvg className="w-5 h-5 text-yellow-500" />
        ) : (
          <EllipsisVerticalIcon className="w-5 h-5 -rotate-90" />
        )}
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
          {(isNodeBookmarked || canAddNodeBookmark) && (
            <button
              className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={(event) => {
                event.stopPropagation();
                onToggleNodeBookmark();
                closeMenu();
              }}
            >
              {isNodeBookmarked ? (
                <BookmarkOutlineIcon className="w-4 h-4 text-gray-500" />
              ) : (
                <BookmarkIconSvg className="w-4 h-4 text-yellow-500" />
              )}
              {isNodeBookmarked ? 'Remove bookmark' : 'Bookmark node'}
            </button>
          )}
          <div className="border-t border-gray-200 my-1" />
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleToggleBypassClick}
          >
            <BypassToggleIcon className="w-4 h-4 text-gray-500" isBypassed={isBypassed} />
            {isBypassed ? 'Engage node' : 'Bypass node'}
          </button>
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleHideNodeClick}
          >
            <EyeOffIcon className="w-4 h-4 text-gray-500" />
            Hide node
          </button>
          {pinnableWidgets.length > 0 && (
            <>
              <div className="border-t border-gray-200 my-1" />
              {singlePinnableWidget ? (
                // Single widget - pin directly
                <button
                  className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={handleSinglePinClick}
                >
                  {isSingleWidgetPinned ? (
                    <PinIconSvg className="w-4 h-4 text-fuchsia-500" />
                  ) : (
                    <PinOutlineIcon className="w-4 h-4 text-gray-500" />
                  )}
                  {isSingleWidgetPinned ? 'Remove pin' : 'Pin widget'}
                </button>
              ) : (
                // Multiple widgets - show submenu
                <>
                  {hasPinnedWidget && (
                    <button
                      className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={handleRemovePinClick}
                    >
                      <PinIconSvg className="w-4 h-4 text-fuchsia-500" />
                      Remove pin
                    </button>
                  )}
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
                    onClick={handlePinSubmenuToggle}
                  >
                    <span className="flex items-center gap-2">
                      <PinOutlineIcon className="w-4 h-4 text-gray-500" />
                      Pin widget
                    </span>
                    <ChevronRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${pinSubmenuOpen ? 'rotate-90' : ''}`} />
                  </button>
                  {pinSubmenuOpen && (
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
                  )}
                </>
              )}
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
