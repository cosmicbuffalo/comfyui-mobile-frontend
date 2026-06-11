import type { IconProps } from './types';

export function StarIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M12 3.7l2.42 4.9 5.4.78-3.91 3.81.92 5.38L12 16.03l-4.83 2.54.92-5.38-3.91-3.81 5.4-.78L12 3.7z" />
    </svg>
  );
}

