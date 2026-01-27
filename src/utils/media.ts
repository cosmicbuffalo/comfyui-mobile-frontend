const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mkv',
  'mov',
  'avi',
  'm4v'
]);

export type MediaType = 'image' | 'video';

export function getMediaType(filename: string): MediaType {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image';
}

export function isVideoFilename(filename: string): boolean {
  return getMediaType(filename) === 'video';
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
