import type { ReactNode, RefObject } from 'react';
import { CaretDownIcon, CaretRightIcon, ProgressRingWithTrack, WarningTriangleIcon } from '@/components/icons';

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
  toggleNodeFold: (nodeId: number) => void;
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
  rightSlot
}: NodeCardHeaderProps) {
  const handleHeaderClick = () => {
    if (isEditingLabel) return;
    toggleNodeFold(nodeId);
  };

  const handleFoldButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    toggleNodeFold(nodeId);
  };

  const handleErrorButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setErrorPopoverOpen(!errorPopoverOpen);
  };

  return (
    <div
      id={`node-header-${nodeId}`}
      className={`node-header flex items-center justify-between cursor-pointer gap-3 ${
        !isCollapsed ? 'mb-3 pb-2 border-b' : ''
      } ${
        isBypassed ? `bg-purple-200 border-purple-300 px-3 -mx-3 -mt-1 pt-1 rounded-t-xl ${isCollapsed ? 'pb-1 -mb-1 rounded-b-xl' : ''}` : !isCollapsed ? 'border-gray-100' : ''
      }`}
      onClick={handleHeaderClick}
    >
      <div id={`node-title-container-${nodeId}`} className="flex items-center gap-1 min-w-0">
        <button
          onClick={handleFoldButtonClick}
          className="w-8 h-8 -ml-2 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
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
            onChange={(e) => onLabelChange(e.target.value)}
            onBlur={onLabelBlur}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'Escape') {
                event.currentTarget.blur();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="font-semibold text-gray-900 flex-1 min-w-0 text-sm bg-white border border-gray-200 rounded px-2 py-1"
          />
        ) : (
          <h3 id={`node-display-name-${nodeId}`} className={`font-semibold text-gray-900 select-none flex-1 min-w-0 ${isCollapsed ? 'whitespace-nowrap overflow-hidden text-ellipsis' : 'whitespace-normal break-words'}`}>
            {displayName}
          </h3>
        )}
        <span id={`node-id-badge-${nodeId}`} className="text-xs text-gray-400 min-w-[2ch] text-right">#{nodeId}</span>
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
            />
            <span id={`node-progress-text-${nodeId}`} className="text-[8px] font-bold text-blue-600">{overallProgress}</span>
          </div>
        ) : null}
        {isExecuting && !isCollapsed ? (
          <span id={`node-executing-pulse-${nodeId}`} className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        ) : null}
      </div>
      <div id={`node-header-right-slot-${nodeId}`} className="header-right-slot">
        {rightSlot}
      </div>
    </div>
  );
}
