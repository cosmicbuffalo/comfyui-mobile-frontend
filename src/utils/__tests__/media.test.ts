import { describe, it, expect } from 'vitest';
import { getMediaType, isVideoFilename, formatDuration } from '../media';

describe('getMediaType', () => {
  it.each(['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'])(
    'returns "video" for .%s',
    (ext) => {
      expect(getMediaType(`file.${ext}`)).toBe('video');
    }
  );

  it('returns "video" for uppercase extensions', () => {
    expect(getMediaType('file.MP4')).toBe('video');
    expect(getMediaType('file.WebM')).toBe('video');
  });

  it.each(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'])(
    'returns "image" for .%s',
    (ext) => {
      expect(getMediaType(`photo.${ext}`)).toBe('image');
    }
  );

  it('returns "image" for unknown extensions', () => {
    expect(getMediaType('file.txt')).toBe('image');
    expect(getMediaType('noext')).toBe('image');
  });

  it('handles filenames with multiple dots', () => {
    expect(getMediaType('my.video.file.mp4')).toBe('video');
    expect(getMediaType('my.image.file.png')).toBe('image');
  });
});

describe('isVideoFilename', () => {
  it('returns true for video files', () => {
    expect(isVideoFilename('clip.mp4')).toBe(true);
  });

  it('returns false for non-video files', () => {
    expect(isVideoFilename('photo.png')).toBe(false);
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3661000)).toBe('61m 1s');
  });

  it('truncates sub-second remainder', () => {
    expect(formatDuration(1500)).toBe('1s');
    expect(formatDuration(61999)).toBe('1m 1s');
  });
});
