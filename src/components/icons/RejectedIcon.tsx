import type { IconProps } from './types';

// Solid red circle with a white X. Used as the "rejected" badge/affordance,
// the mutually-exclusive counterpart to the favorite heart. The red fill is
// baked in (not currentColor) so it reads the same wherever it's dropped.
export function RejectedIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="10" fill="#ef4444" />
      {/* Same X geometry as RejectXIcon so the X is identical with or without
          the disc behind it. */}
      <path
        d="M8 8 L16 16 M16 8 L8 16"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
