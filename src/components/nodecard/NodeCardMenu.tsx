import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BypassToggleIcon, BookmarkIconSvg, BookmarkOutlineIcon, ChevronRightIcon, EllipsisVerticalIcon, EyeOffIcon, NodeConnectionsIcon } from '@/components/icons';

interface BookmarkableWidget {
  widgetIndex: number;
  name: string;
  type: string;
  options?: Record<string, unknown> | unknown[];
}

interface NodeCardMenuProps {
  nodeId: number;
  isBypassed: boolean;
  bookmarkableWidgets: BookmarkableWidget[];
  singleBookmarkableWidget: BookmarkableWidget | null;
  isSingleWidgetBookmarked: boolean;
  hasNodeBookmark: boolean;
  toggleWidgetBookmark: (
    widgetIndex: number,
    widgetName: string,
    widgetType: string,
    options?: Record<string, unknown> | unknown[]
  ) => void;
  setBookmarkedWidget: (bookmark: {
    nodeId: number;
    widgetIndex: number;
    widgetName: string;
    widgetType: string;
    options?: Record<string, unknown> | unknown[];
  } | null) => void;
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
  bookmarkableWidgets,
  singleBookmarkableWidget,
  isSingleWidgetBookmarked,
  hasNodeBookmark,
  toggleWidgetBookmark,
  setBookmarkedWidget,
  toggleBypass,
  hideNode,
  connectionHighlightMode,
  setConnectionHighlightMode,
  leftLineCount,
  rightLineCount
}: NodeCardMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [bookmarkSubmenuOpen, setBookmarkSubmenuOpen] = useState(false);
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
        setBookmarkSubmenuOpen(false);
      }
    };
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      setMenuOpen(false);
      setBookmarkSubmenuOpen(false);
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

  return (
    <div className="flex items-center gap-1 relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="w-8 h-8 flex items-center justify-center"
        aria-pressed={connectionHighlightMode !== 'off'}
        aria-label="Highlight connected nodes"
        onClick={(event) => {
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
        }}
        disabled={leftLineCount === 0 && rightLineCount === 0}
      >
        <NodeConnectionsIcon
          className="w-6 h-6 overflow-visible"
          nodeId={nodeId}
          connectionHighlightMode={connectionHighlightMode}
          leftLineCount={leftLineCount}
          rightLineCount={rightLineCount}
        />
      </button>
      {/* Menu */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((prev) => !prev);
        }}
        className="w-8 h-8 flex items-center justify-center text-gray-700 hover:text-gray-900 bg-transparent hover:bg-transparent"
        aria-label="Node options"
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
            onClick={(e) => {
              e.stopPropagation();
              toggleBypass(nodeId);
              setMenuOpen(false);
              setBookmarkSubmenuOpen(false);
            }}
          >
            <BypassToggleIcon className="w-4 h-4 text-gray-500" isBypassed={isBypassed} />
            {isBypassed ? 'Engage node' : 'Bypass node'}
          </button>
          <button
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={(e) => {
              e.stopPropagation();
              hideNode(nodeId);
              setMenuOpen(false);
              setBookmarkSubmenuOpen(false);
            }}
          >
            <EyeOffIcon className="w-4 h-4 text-gray-500" />
            Hide node
          </button>
          {bookmarkableWidgets.length > 0 && (
            <>
              <div className="border-t border-gray-200 my-1" />
              {singleBookmarkableWidget ? (
                // Single widget - bookmark directly
                <button
                  className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWidgetBookmark(
                      singleBookmarkableWidget.widgetIndex,
                      singleBookmarkableWidget.name,
                      singleBookmarkableWidget.type,
                      singleBookmarkableWidget.options
                    );
                    setMenuOpen(false);
                    setBookmarkSubmenuOpen(false);
                  }}
                >
                  {isSingleWidgetBookmarked ? (
                    <BookmarkIconSvg className="w-4 h-4 text-yellow-500" />
                  ) : (
                    <BookmarkOutlineIcon className="w-4 h-4 text-gray-500" />
                  )}
                  {isSingleWidgetBookmarked ? 'Remove bookmark' : 'Bookmark widget'}
                </button>
              ) : (
                // Multiple widgets - show submenu
                <>
                  {hasNodeBookmark && (
                    <button
                      className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBookmarkedWidget(null);
                        setMenuOpen(false);
                        setBookmarkSubmenuOpen(false);
                      }}
                    >
                      <BookmarkIconSvg className="w-4 h-4 text-yellow-500" />
                      Remove bookmark
                    </button>
                  )}
                  <button
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBookmarkSubmenuOpen(!bookmarkSubmenuOpen);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <BookmarkOutlineIcon className="w-4 h-4 text-gray-500" />
                      Bookmark widget
                    </span>
                    <ChevronRightIcon className={`w-4 h-4 text-gray-400 transition-transform ${bookmarkSubmenuOpen ? 'rotate-90' : ''}`} />
                  </button>
                  {bookmarkSubmenuOpen && (
                    <div className="border-t border-gray-100 bg-gray-50 max-h-48 overflow-auto">
                      {bookmarkableWidgets.map((widget) => (
                        <button
                          key={widget.widgetIndex}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 text-gray-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBookmarkedWidget({
                              nodeId,
                              widgetIndex: widget.widgetIndex,
                              widgetName: widget.name,
                              widgetType: widget.type,
                              options: widget.options
                            });
                            setMenuOpen(false);
                            setBookmarkSubmenuOpen(false);
                          }}
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
