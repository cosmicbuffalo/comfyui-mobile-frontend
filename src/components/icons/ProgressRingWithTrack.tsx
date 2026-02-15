import type { IconProps } from './types';
import { themeColors } from '@/theme/colors';

export interface ProgressRingWithTrackProps extends IconProps {
  progress: number;
  radius?: number;
  trackColor?: string;
  progressColor?: string;
}

export function ProgressRingWithTrack({
  progress,
  radius = 10,
  trackColor = themeColors.border.gray200,
  progressColor = themeColors.brand.blue500,
  ...props
}: ProgressRingWithTrackProps) {
  const normalized = Math.min(100, Math.max(0, progress));
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized / 100);
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r={radius} fill="none" stroke={trackColor} strokeWidth="2" />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke={progressColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  );
}
