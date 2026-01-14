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
