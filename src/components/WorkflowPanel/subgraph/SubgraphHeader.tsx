import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WorkflowSubgraphDefinition } from '@/api/types';
import { CaretDownIcon, CaretRightIcon, WorkflowLoadIcon, EditIcon, EyeOffIcon } from '@/components/icons';
import { useWorkflowStore } from '@/hooks/useWorkflow';

interface SubgraphHeaderProps {
  subgraph: WorkflowSubgraphDefinition;
  nodeCount: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

// Default subgraph color - a slightly blue-tinted gray similar to node backgrounds
const SUBGRAPH_BG_COLOR = 'rgba(59, 130, 246, 0.14)'; // blue-500 at 14%
const SUBGRAPH_BORDER_COLOR = 'rgba(59, 130, 246, 0.25)'; // blue-500 at 25%

export function SubgraphHeader({
  subgraph,
  nodeCount,
  isCollapsed,
  onToggleCollapse
}: SubgraphHeaderProps) {
  const updateSubgraphTitle = useWorkflowStore((s) => s.updateSubgraphTitle);
  const setSubgraphHidden = useWorkflowStore((s) => s.setSubgraphHidden);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState('');
  const labelInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const title = subgraph.name || subgraph.id;
  const displayTitle = title.trim() || subgraph.id;

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
    updateSubgraphTitle(subgraph.id, labelValue);
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

  const handleHideSubgraphClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setSubgraphHidden(subgraph.id, true);
    setMenuOpen(false);
  };

  return (
    <div
      id={`subgraph-header-${subgraph.id}`}
      className={`subgraph-header flex items-center justify-between cursor-pointer gap-3 px-3 py-2 ${
        isCollapsed ? 'rounded-xl' : 'rounded-t-xl mb-3'
      }`}
      style={{
        backgroundColor: `var(--subgraph-bg, ${SUBGRAPH_BG_COLOR})`,
        borderColor: `var(--subgraph-border, ${SUBGRAPH_BORDER_COLOR})`,
        // CSS custom properties for dark mode - set via CSS or inline
        ['--subgraph-bg' as string]: SUBGRAPH_BG_COLOR,
        ['--subgraph-border' as string]: SUBGRAPH_BORDER_COLOR,
      }}
      onClick={handleHeaderClick}
    >
      <div className="flex items-center gap-1 min-w-0 flex-1">
        <button
          onClick={handleToggleClick}
          className="w-8 h-8 -ml-2 flex items-center justify-center text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 shrink-0"
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
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 select-none flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis">
            {displayTitle}
          </h3>
        )}
        {isCollapsed && (
          <span className="text-sm text-blue-600 dark:text-blue-400 shrink-0">
            ({nodeCount} node{nodeCount !== 1 ? 's' : ''})
          </span>
        )}
      </div>

      {/* Match the My Workflows icon for subgraphs */}
      <button
        onClick={handleMenuToggleClick}
        className="flex items-center text-blue-400 dark:text-blue-500 opacity-60 hover:opacity-100"
        aria-label="Subgraph options"
        ref={menuButtonRef}
      >
        <WorkflowLoadIcon className="w-5 h-5" />
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
            className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm hover:bg-gray-50"
            onClick={handleHideSubgraphClick}
          >
            <EyeOffIcon className="w-4 h-4 text-gray-500" />
            Hide subgraph
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
