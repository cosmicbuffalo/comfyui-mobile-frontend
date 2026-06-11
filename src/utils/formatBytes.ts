const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/**
 * Format a byte count as a compact human-readable size, e.g. 1536 -> "1.5 KB".
 * Bytes show no decimals; larger units show one decimal below 100 and none at
 * or above it (so "4.2 MB" but "210 MB"). Non-positive / non-finite -> "0 B".
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const formatted = exponent === 0
    ? String(Math.round(value))
    : value.toFixed(value >= 100 ? 0 : 1);
  return `${formatted} ${UNITS[exponent]}`;
}
