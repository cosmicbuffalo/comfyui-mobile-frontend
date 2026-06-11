import type { ReactNode, RefObject } from 'react';
import { ProgressRingWithTrack, WarningTriangleIcon } from '@/components/icons';
import { FoldIcon } from '@/components/FoldIcon';

interface NodeCardHeaderProps {
  nodeId: number;
  displayName: string;
  isEditingLabel: boolean;
  labelValue: string;
  labelInputRef: RefObject<HTMLInputElement | null>;
  onLabelChange: (value: string) => void;
  onLabelBlur: () => void;
  isCollapsed: boolean | undefined;
  isBypassed: boolean;
  isExecuting?: boolean;
  overallProgress: number | null;
  hasErrors: boolean;
  errorIconRef: RefObject<HTMLButtonElement | null>;
  errorPopoverOpen: boolean;
  setErrorPopoverOpen: (next: boolean) => void;
  toggleNodeFold: () => void;
  expandedBorderColor?: string;
  rightSlot?: ReactNode;
}

export function NodeCardHeader({
  nodeId,
  displayName,
  isEditingLabel,
  labelValue,
  labelInputRef,
  onLabelChange,
  onLabelBlur,
  isCollapsed,
  isBypassed,
  isExecuting,
  overallProgress,
  hasErrors,
  errorIconRef,
  errorPopoverOpen,
  setErrorPopoverOpen,
  toggleNodeFold,
  expandedBorderColor,
  rightSlot,
}: NodeCardHeaderProps) {
  const handleHeaderClick = () => {
    if (isEditingLabel) return;
    toggleNodeFold();
  };

  const handleFoldButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleNodeFold();
  };

  const handleErrorButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setErrorPopoverOpen(!errorPopoverOpen);
  };

  return (
    <div
      id={`node-header-${nodeId}`}
      className={`node-header flex items-center justify-between px-3 -mx-3 cursor-pointer gap-3 border-b transition-[margin,padding,border-color] duration-200 ease-out ${
        !isCollapsed ? 'mb-3 pb-2' : 'mb-0 pb-0 border-transparent'
      } ${
        isBypassed ? `bg-purple-950/45 ${!isCollapsed ? 'border-purple-500/30' : ''} -mt-1 pt-1 rounded-t-xl ${isCollapsed ? 'pb-1 -mb-1 rounded-b-xl' : ''}` : !isCollapsed ? 'border-white/10' : ''
      }`}
      style={!isCollapsed && expandedBorderColor ? { borderBottomColor: expandedBorderColor } : undefined}
      onClick={handleHeaderClick}
    >
      <div id={`node-title-container-${nodeId}`} className="flex items-center gap-1 min-w-0">
        <button
          onClick={handleFoldButtonClick}
          className="w-8 h-8 -ml-2 flex items-center justify-center text-slate-400 hover:text-slate-100 shrink-0"
        >
          <FoldIcon open={!isCollapsed} className="w-6 h-6" />
        </button>
        {isEditingLabel ? (
          <input
            ref={labelInputRef}
            value={labelValue}
            onChange={(e) => onLabelChange(e.target.value)}
            onBlur={onLabelBlur}
            data-swipe-nav-ignore="true"
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.currentTarget.blur();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-slate-100 flex-1 min-w-0 text-sm bg-slate-950/80 border border-white/10 rounded px-2 py-1"
          />
        ) : (
          <h3 id={`node-display-name-${nodeId}`} className={`text-sm font-semibold text-slate-100 select-none flex-1 min-w-0 ${isCollapsed ? 'whitespace-nowrap overflow-hidden text-ellipsis' : 'whitespace-normal break-words'}`}>
            {displayName}
          </h3>
        )}
        <span id={`node-id-badge-${nodeId}`} className="text-xs text-slate-500 min-w-[2ch] text-right">#{nodeId}</span>
        {hasErrors && (
          <button
            ref={errorIconRef}
            type="button"
            onClick={handleErrorButtonClick}
            className="w-5 h-5 flex items-center justify-center text-red-500 hover:text-red-600 shrink-0"
            aria-label="View errors"
          >
            <WarningTriangleIcon className="w-4 h-4" />
          </button>
        )}
        {isExecuting && isCollapsed && overallProgress !== null ? (
          <div id={`node-progress-indicator-${nodeId}`} className="relative w-6 h-6 flex items-center justify-center">
            <ProgressRingWithTrack
              className="absolute"
              width="24"
              height="24"
              style={{ transform: 'rotate(-90deg)' }}
              progress={overallProgress}
              radius={10}
              progressColor="#22d3ee"
              trackColor="rgba(255,255,255,0.15)"
            />
            <span id={`node-progress-text-${nodeId}`} className="text-[8px] font-bold text-cyan-300">{overallProgress}</span>
          </div>
        ) : null}
        {isExecuting && !isCollapsed ? (
          <span id={`node-executing-pulse-${nodeId}`} className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
        ) : null}
      </div>
      <div id={`node-header-right-slot-${nodeId}`} className="header-right-slot">
        {rightSlot}
      </div>
    </div>
  );
}
