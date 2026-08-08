import { RejectXIcon, RejectedIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';

interface RejectButtonProps {
  onClick: () => void;
  isRejected: boolean;
  isFavorited: boolean;
  /** Render as a bare icon (no disc) — used for the persistent state indicator. */
  bare?: boolean;
}

// The "x" affordance. Its action is contextual (resolved by the caller):
// - on a favorited item it unfavorites,
// - otherwise it toggles the rejected state.
// Favorited and rejected are mutually exclusive, so at most one is ever true.
//
// Inactive: a plain white X (RejectXIcon). Active (rejected): the same white X
// over a solid red disc (RejectedIcon). Both icons share an identical viewBox
// and X path, so the X never moves or resizes when toggling — only the disc
// appears behind it.
export function RejectButton({ onClick, isRejected, isFavorited, bare }: RejectButtonProps) {
  const ariaLabel = isFavorited
    ? 'Remove from favorites'
    : isRejected
      ? 'Clear rejected mark'
      : 'Reject';
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel={ariaLabel}
      ariaPressed={isRejected}
      bare={bare}
      className={`text-white${bare ? ' drop-shadow' : ''}`}
      icon={
        isRejected ? (
          <RejectedIcon className="w-6 h-6" />
        ) : (
          <RejectXIcon className="w-6 h-6" />
        )
      }
    />
  );
}
