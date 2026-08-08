// A/B comparison wipe geometry.
//
// The divider is fixed to the screen at a fraction of the container width, while
// image A is clipped in its OWN coordinate space — which zooms and pans under
// it. Converting the divider's screen X into a fraction of the transformed image
// width is what keeps the wipe boundary welded to the divider instead of
// drifting as the image scales mid-gesture.
//
// Two callers need this: the React render path and the imperative transform
// applied during a pinch/drag (which bypasses React for frame rate). They must
// agree exactly, or the clip jumps when a gesture ends and the render catches up.

export interface CompareClipGeometry {
  // Divider position in container pixels.
  dividerX: number;
  // The image's current left edge on screen: centering offset + pan.
  imageLeft: number;
  // Image width at the current scale.
  scaledWidth: number;
}

// Neutral half-and-half wipe, used before the image has been measured.
export const DEFAULT_COMPARE_CLIP = 'inset(0 50% 0 0)';

export function compareClipPath({
  dividerX,
  imageLeft,
  scaledWidth,
}: CompareClipGeometry): string {
  if (!Number.isFinite(scaledWidth) || scaledWidth <= 0) return DEFAULT_COMPARE_CLIP;
  const fraction = Math.min(1, Math.max(0, (dividerX - imageLeft) / scaledWidth));
  return `inset(0 ${(1 - fraction) * 100}% 0 0)`;
}
