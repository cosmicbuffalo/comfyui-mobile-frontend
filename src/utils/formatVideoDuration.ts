/**
 * Length of a video, for the badges on outputs cards and queue media overlays.
 * Sub-second clips still read as a real length rather than "0s", and whole
 * seconds drop the trailing ".0".
 */
export function formatVideoDuration(seconds: number): string {
  const rounded = Math.max(0.1, Math.round(seconds * 10) / 10);
  return `${rounded.toFixed(1).replace(/\.0$/, '')}s`;
}
