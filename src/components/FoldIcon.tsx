import { CaretRightIcon, ChevronRightIcon } from '@/components/icons';
import type { IconProps } from '@/components/icons/types';

interface FoldIconProps extends IconProps {
  /** When true the icon points down (expanded); when false it points right (collapsed). */
  open: boolean;
  /** Visual style of the indicator. `caret` is the filled triangle, `chevron` the thin arrow. */
  variant?: 'caret' | 'chevron';
}

/**
 * Shared fold indicator. Renders a single right-pointing icon that animates its
 * rotation to point down when `open`, instead of swapping between two icons.
 * Pair with <Collapsible> for the matching content slide.
 */
export function FoldIcon({ open, variant = 'caret', className, ...props }: FoldIconProps) {
  const Icon = variant === 'chevron' ? ChevronRightIcon : CaretRightIcon;
  return (
    <Icon
      className={`transition-transform duration-150 ease-out ${open ? 'rotate-90' : 'rotate-0'} ${className ?? ''}`}
      {...props}
    />
  );
}
