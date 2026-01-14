import type { ReactNode, RefObject } from 'react';
import { CaretDownIcon, CaretRightIcon, ProgressRingWithTrack, WarningTriangleIcon } from '@/components/icons';

interface NodeCardHeaderProps {
  nodeId: number;
  displayName: string;
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
  return (
    <div
      className={`flex items-center justify-between cursor-pointer gap-3 ${
        !isCollapsed ? 'mb-3 pb-2 border-b' : ''
      } ${
        isBypassed ? `bg-purple-200 border-purple-300 -mx-4 px-4 -mt-1 pt-1 rounded-t-xl ${isCollapsed ? 'pb-1 -mb-1 rounded-b-xl' : ''}` : !isCollapsed ? 'border-gray-100' : ''
      }`}
      onClick={() => toggleNodeFold(nodeId)}
    >
      <div className="flex items-center gap-1 min-w-0">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleNodeFold(nodeId);
          }}
          className="w-8 h-8 -ml-2 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
        >
          {isCollapsed ? (
            <CaretRightIcon className="w-6 h-6" />
          ) : (
            <CaretDownIcon className="w-6 h-6" />
          )}
        </button>
        <h3 className={`font-semibold text-gray-900 select-none flex-1 min-w-0 ${isCollapsed ? 'whitespace-nowrap overflow-hidden text-ellipsis' : 'whitespace-normal break-words'}`}>
          {displayName}
        </h3>
        <span className="text-xs text-gray-400 min-w-[2ch] text-right">#{nodeId}</span>
        {hasErrors && (
          <button
            ref={errorIconRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setErrorPopoverOpen(!errorPopoverOpen);
            }}
            className="w-5 h-5 flex items-center justify-center text-red-500 hover:text-red-600 shrink-0"
            aria-label="View errors"
          >
            <WarningTriangleIcon className="w-4 h-4" />
          </button>
        )}
        {isExecuting && isCollapsed && overallProgress !== null ? (
          <div className="relative w-6 h-6 flex items-center justify-center">
            <ProgressRingWithTrack
              className="absolute"
              width="24"
              height="24"
              style={{ transform: 'rotate(-90deg)' }}
              progress={overallProgress}
              radius={10}
            />
            <span className="text-[8px] font-bold text-blue-600">{overallProgress}</span>
          </div>
        ) : null}
        {isExecuting && !isCollapsed ? (
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        ) : null}
      </div>
      {rightSlot}
    </div>
  );
}
