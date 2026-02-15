import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

interface ConnectionRowProps {
  direction: 'input' | 'output';
  hasConnection: boolean;
  isEmptyRequiredInput?: boolean;
  hideLabel: boolean;
  resolvedLabel: string;
  shouldWrapResolvedLabel: boolean;
  sizeClass: string;
  arrowClass: string;
  typeClass: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  connectionCount: number;
  onClick: () => void;
  onPointerDown?: (event: ReactPointerEvent) => void;
  onPointerMove?: (event: ReactPointerEvent) => void;
  onPointerUp?: () => void;
}

export function ConnectionRow({
  direction,
  hasConnection,
  isEmptyRequiredInput = false,
  hideLabel,
  resolvedLabel,
  shouldWrapResolvedLabel,
  sizeClass,
  arrowClass,
  typeClass,
  buttonRef,
  connectionCount,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp
}: ConnectionRowProps) {
  const isInput = direction === 'input';
  const isDisabled = isInput ? (!hasConnection && !isEmptyRequiredInput) : false;
  const isInactiveOutput = !isInput && !hasConnection;

  return (
    <>
      {isInput ? null : !hideLabel && (
        <span
          className={`text-sm text-gray-700 flex-1 min-w-0 ${
            shouldWrapResolvedLabel ? 'whitespace-pre-line break-words leading-tight text-right' : 'truncate'
          }`}
        >
          {resolvedLabel}
        </span>
      )}

      {!isInput && connectionCount > 1 && (
        <span className="bg-gray-200 text-gray-700 rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0">
          {connectionCount}
        </span>
      )}

      <button
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        disabled={isDisabled}
        ref={buttonRef}
        className={`
          flex items-center justify-center rounded-full font-medium box-border
          ${isInput ? 'border-2' : ''}
          ${sizeClass} flex-shrink-0
          transition-opacity
          ${typeClass}
          ${isInput && isEmptyRequiredInput ? 'opacity-100 cursor-pointer border-red-500' : 'border-transparent'}
          ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}
          ${!isDisabled && isInactiveOutput ? 'opacity-40 cursor-pointer active:scale-95' : ''}
          ${!isDisabled && !isInactiveOutput ? 'opacity-100 cursor-pointer active:scale-95' : ''}
        `}
      >
        {isInput ? (
          <>
            {hasConnection && <span className={arrowClass}>←</span>}
            {isEmptyRequiredInput && !hasConnection && <span className={arrowClass}>+</span>}
          </>
        ) : (
          hasConnection && <span className={arrowClass}>→</span>
        )}
      </button>

      {!isInput && hideLabel ? null : isInput && !hideLabel && (
        <span
          className={`text-sm flex-1 min-w-0 ${
            shouldWrapResolvedLabel ? 'whitespace-pre-line break-words leading-tight' : 'truncate'
          } ${isEmptyRequiredInput ? 'text-red-600 font-medium' : 'text-gray-700'}`}
        >
          {resolvedLabel}
        </span>
      )}
    </>
  );
}
