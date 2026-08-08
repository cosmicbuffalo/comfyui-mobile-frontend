import type { IconProps } from './types';

// Plain X (no circle), used as the inactive reject affordance. Shares the exact
// viewBox and X path with RejectedIcon, so switching between the two never
// shifts or resizes the X — only the red disc behind it appears/disappears.
export function RejectXIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M8 8 L16 16 M16 8 L8 16"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
