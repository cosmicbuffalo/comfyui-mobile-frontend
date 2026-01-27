import type { IconProps } from './types';

export function InboxIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}
