import type { IconProps } from '@/components/icons/types';

/**
 * Tool glyphs for the mask editor.
 *
 * Drawn here rather than ported from ComfyUI's desktop editor: that project is
 * GPL-3 and this one is MIT, so its icon artwork is not ours to copy.
 */

/**
 * The "edit mask" affordance: a circle with a hatched region.
 *
 * Drawn here rather than reused from ComfyUI's desktop frontend. Its mask glyph
 * lives in `@comfyorg/design-system` inside that GPL-3 repo with no separate
 * licence, so it is not ours to copy into an MIT project. This is the same
 * visual idea in its own geometry.
 */
export function MaskIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 6.8c0.4 7.4 6.6 12.2 13.8 10.6" />
      <path d="M10.6 6.0 13.4 3.2" />
      <path d="M12.6 8.6 17.0 4.2" />
      <path d="M15.4 10.6 19.2 6.8" />
    </svg>
  );
}

export function MaskPenIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 20l1-4 10-10 3 3-10 10-4 1z" />
      <path d="M14.5 5.5l3 3" />
    </svg>
  );
}

export function PaintPenIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M19 4.5a2 2 0 00-3 0l-7.5 7.5" />
      <path d="M11 14c0 2.2-1.8 4-4 4-1.6 0-3-.6-4-1.6 2-.4 2.5-2.4 4-2.4a4 4 0 014 4z" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12.5" r="1.6" />
    </svg>
  );
}

export function EraserIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M8.5 19H19" />
      <path d="M14 5.5l5 5-6.5 6.5H8L4.5 13z" />
      <path d="M9 10l5 5" />
    </svg>
  );
}

export function PaintBucketIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M9 4l8 8-6.5 6.5a1.5 1.5 0 01-2.1 0L3.9 14a1.5 1.5 0 010-2.1z" />
      <path d="M6.5 9.5h11" />
      <path d="M20 14.5c0 1-.7 1.8-1.6 1.8S17 15.5 17 14.5s1.6-2.8 1.6-2.8S20 13.5 20 14.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ColorSelectIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14 4.5l5.5 5.5" />
      <path d="M16.8 3.6a2.2 2.2 0 013.1 3.1l-2 2-3.1-3.1z" />
      <path d="M13.6 6.4l4 4-8.4 8.4H5.2v-4z" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function InvertIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 010 17z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FitToViewIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M4 9V5.5A1.5 1.5 0 015.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0120 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 014 18.5V15" />
    </svg>
  );
}
