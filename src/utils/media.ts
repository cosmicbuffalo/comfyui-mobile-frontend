import { splitPathAnnotation } from '@/utils/annotatedPath';
import { isModelFilename } from '@/utils/model3d';

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mkv',
  'mov',
  'avi',
  'm4v'
]);

export type MediaType = 'image' | 'video' | 'model';

export function getMediaType(filename: string): MediaType {
  // `clip.mp4 [input]` names its directory after the extension; the
  // annotation is not part of the filename, so it must not hide the type.
  const path = splitPathAnnotation(filename).path;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return isModelFilename(path) ? 'model' : 'image';
}

export function isVideoFilename(filename: string): boolean {
  return getMediaType(filename) === 'video';
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}
