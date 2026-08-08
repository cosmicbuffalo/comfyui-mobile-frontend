import type { IconProps } from './types';

// Prohibition / "no entry" symbol: a circle with a single diagonal line through
// it. Used for cancel-and-exit affordances.
export function NoEntryIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.64 5.64l12.72 12.72" />
    </svg>
  );
}
