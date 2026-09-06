import type { IconProps } from './types';

/**
 * The git-fork glyph: two branch heads rising from one trunk. Drawn as strokes
 * so it reads at the 14px the banner uses, where a filled version of the same
 * shape closes up.
 */
export function ForkIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="12" cy="19" r="2.5" />
      {/* Each head drops to the height where the trunk begins, then the trunk
          carries down to the third node. */}
      <path d="M6 7.5v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-2" />
      <path d="M12 12.5v4" />
    </svg>
  );
}
