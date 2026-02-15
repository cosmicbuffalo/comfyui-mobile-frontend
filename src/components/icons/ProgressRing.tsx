import type { IconProps } from './types';
import { themeColors } from '@/theme/colors';

export interface ProgressRingProps extends IconProps {
  progress: number;
  radius?: number;
}

export function ProgressRing({ progress, radius = 11, ...props }: ProgressRingProps) {
  const normalized = Math.min(100, Math.max(0, progress));
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized / 100);
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke={themeColors.status.successStrong}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  );
}
