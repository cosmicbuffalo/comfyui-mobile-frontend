import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { PlusIcon, PromotedWidgetIcon } from '@/components/icons';

interface ConnectionRowProps {
  direction: 'input' | 'output';
  hasConnection: boolean;
  isEmptyRequiredInput?: boolean;
  /**
   * True when the slot is a subgraph boundary slot, or an inner slot wired to
   * one. Both are "promoted", so both take the promoted widgets' pink border —
   * one colour across the app for "this crosses the subgraph edge".
   */
  isBoundaryConnection?: boolean;
  /**
   * Marks a row whose label names a promoted slot, so the marker sits with the
   * slot name here the same way it does beside a promoted widget.
   */
  isPromoted?: boolean;
  /**
   * True for the "add a slot" affordance that trails a boundary column. It is
   * shaped like a connection button but is not one — a plain grey disc rather
   * than a slot's type colour — so it reads as an invitation sitting with the
   * slots rather than as another slot.
   */
  isAddSlot?: boolean;
  /**
   * True when a Use Everywhere broadcast feeds this input rather than a drawn
   * link. It is a real connection, so it reads as filled — the dashed ring just
   * distinguishes "arrives over the air" from "wired".
   */
  isBroadcastConnection?: boolean;
  hideLabel: boolean;
  resolvedLabel: string;
  /** When set, replaces the label text with this node (e.g. an inline name editor). */
  labelEditor?: ReactNode;
  /**
   * Rendered hard against the label text on its inner side — after it for an
   * input, before it for an output. It shares the label's flex slot rather than
   * taking its own, so the label stops growing at its text and the adornment
   * trails it, instead of being pushed out to the row's edge.
   */
  labelAdornment?: ReactNode;
  shouldWrapResolvedLabel: boolean;
  sizeClass: string;
  arrowClass: string;
  typeClass: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  /** Stable DOM id so navigation can flash this specific connection button. */
  buttonId?: string;
  /** Spoken action for assistive tech and deterministic native UI driving. */
  ariaLabel?: string;
  connectionCount: number;
  onClick: () => void;
  onPointerDown?: (event: ReactPointerEvent) => void;
  onPointerMove?: (event: ReactPointerEvent) => void;
  // The event matters: the long-press hook matches it against the pointer it
  // captured, so a second finger can't end the first one's hold.
  onPointerUp?: (event: ReactPointerEvent) => void;
  onPointerCancel?: (event: ReactPointerEvent) => void;
}

export function ConnectionRow({
  direction,
  hasConnection,
  isEmptyRequiredInput = false,
  isBoundaryConnection = false,
  isPromoted = false,
  isAddSlot = false,
  isBroadcastConnection = false,
  hideLabel,
  resolvedLabel,
  labelEditor,
  labelAdornment,
  shouldWrapResolvedLabel,
  sizeClass,
  arrowClass,
  typeClass,
  buttonRef,
  buttonId,
  ariaLabel,
  connectionCount,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel
}: ConnectionRowProps) {
  const isInput = direction === 'input';
  // An add-slot button is always live: the dimming and the dashed "nothing here
  // yet" treatments describe an empty slot, and this is not one.
  const isVisuallyDisabled = !isAddSlot && isInput && !hasConnection && !isEmptyRequiredInput;
  const isInactiveOutput = !isAddSlot && !isInput && !hasConnection;
  const plusIconClass = sizeClass.includes('w-7') ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <>
      {isInput ? null : !hideLabel && (
        labelEditor ? (
          <span className="flex-1 min-w-0">{labelEditor}</span>
        ) : (
          <span className="flex flex-1 min-w-0 items-center gap-1">
            {labelAdornment}
            <span
              className={`text-sm text-slate-300 min-w-0 ${
                shouldWrapResolvedLabel ? 'whitespace-pre-line break-words leading-tight text-right' : 'truncate'
              }`}
            >
              {resolvedLabel}
            </span>
            {isPromoted && (
              <PromotedWidgetIcon className="w-3.5 h-3.5 shrink-0 text-pink-500" />
            )}
          </span>
        )
      )}

      {!isInput && connectionCount > 1 && (
        <span className="bg-white/10 text-slate-300 rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0">
          {connectionCount}
        </span>
      )}

      <button
        id={buttonId}
        aria-label={ariaLabel}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel ?? onPointerUp}
        disabled={false}
        ref={buttonRef}
        className={`
          flex items-center justify-center rounded-full font-medium box-border
          border-2
          ${sizeClass} flex-shrink-0
          transition-opacity
          ${typeClass}
          ${isBroadcastConnection ? 'connection-broadcast' : ''}
          ${isAddSlot ? 'connection-add-slot cursor-pointer'
            : isInput && isEmptyRequiredInput ? 'opacity-100 cursor-pointer border-red-500'
            // `.connection-promoted` (index.css) keeps the button's footprint
            // and shrinks its fill inside the outline, which is the only way the
            // outline shows on a slot whose own colour is already this pink.
            : isBoundaryConnection ? 'connection-promoted'
            : isBroadcastConnection ? 'border-dashed border-violet-400/80'
            : 'border-transparent'}
          ${!isInput && isInactiveOutput ? 'border-dashed border-slate-500/70' : ''}
          ${isVisuallyDisabled ? 'opacity-40 cursor-pointer active:scale-95' : ''}
          ${!isVisuallyDisabled && isInactiveOutput ? 'opacity-50 cursor-pointer active:scale-95' : ''}
          ${!isVisuallyDisabled && !isInactiveOutput ? 'opacity-100 cursor-pointer active:scale-95' : ''}
        `}
      >
        {isAddSlot || !hasConnection ? (
          <PlusIcon className={plusIconClass} />
        ) : (
          <span className={arrowClass}>{isInput ? '←' : '→'}</span>
        )}
      </button>

      {!isInput && hideLabel ? null : isInput && !hideLabel && (
        <span className="flex flex-1 min-w-0 items-center gap-1">
          <span
            className={`text-sm min-w-0 ${
              shouldWrapResolvedLabel ? 'whitespace-pre-line break-words leading-tight' : 'truncate'
            } ${isEmptyRequiredInput ? 'text-red-400 font-medium' : 'text-slate-300'}`}
          >
            {resolvedLabel}
          </span>
          {isPromoted && (
            <PromotedWidgetIcon className="w-3.5 h-3.5 shrink-0 text-pink-500" />
          )}
          {labelAdornment}
        </span>
      )}
    </>
  );
}
