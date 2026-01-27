import type { IconProps } from './types';

export function CopyIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path d="M10.667 2.667c1.45.008 2.235.072 2.748.585C14 3.837 14 4.78 14 6.666v4c0 1.885 0 2.828-.585 3.414-.586.585-1.529.585-3.415.585H6c-1.886 0-2.829 0-3.414-.585C2 13.494 2 12.55 2 10.666v-4c0-1.886 0-2.829.586-3.414.512-.513 1.297-.577 2.747-.585" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M5.333 2.333c0-.552.448-1 1-1h3.334c.552 0 1 .448 1 1v.667c0 .553-.448 1-1 1H6.333c-.552 0-1-.447-1-1v-.667Z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}
