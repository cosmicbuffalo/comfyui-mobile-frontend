import { describe, expect, it } from 'vitest';
import {
  getQueueImagePreviewUrl,
  getMediaThumbnailUrl,
  getMediaThumbnailUrlFromAssetUrl,
  getPlayableVideoUrl,
} from '@/api/client/base';
import { bustImageCache } from '@/utils/imageCacheBust';

describe('media thumbnail URLs', () => {
  it('routes queue images through the bounded mobile preview cache', () => {
    expect(getQueueImagePreviewUrl('image one.png', 'nested/folder', 'output')).toBe(
      '/mobile/api/preview?filename=image%20one.png&subfolder=nested%2Ffolder&type=output&maxedge=1280',
    );
  });

  it('builds an encoded still-thumbnail URL for video assets', () => {
    expect(getMediaThumbnailUrl('clip one.mp4', 'nested/folder', 'output')).toBe(
      '/mobile/api/thumbnail?filename=clip%20one.mp4&subfolder=nested%2Ffolder&source=output',
    );
  });

  it('derives a thumbnail from a view URL while preserving its cache identity', () => {
    expect(getMediaThumbnailUrlFromAssetUrl(
      '/view?filename=clip.mp4&subfolder=video%2F2026&type=output&cb=123',
    )).toBe(
      '/mobile/api/thumbnail?filename=clip.mp4&subfolder=video%2F2026&source=output&cb=123',
    );
  });

  it('cache-busts direct thumbnail URLs when a filename is reused', () => {
    bustImageCache('reused-video.mp4', '', 'output');

    expect(getMediaThumbnailUrl('reused-video.mp4', '', 'output')).toBe(
      '/mobile/api/thumbnail?filename=reused-video.mp4&subfolder=&source=output&cb=1',
    );
  });

  it('does not invent thumbnails for live or external URLs', () => {
    expect(getMediaThumbnailUrlFromAssetUrl('blob:https://example.test/id')).toBeUndefined();
    expect(getMediaThumbnailUrlFromAssetUrl('https://cdn.example.test/clip.mp4')).toBeUndefined();
  });

  it('routes local view videos through the playable endpoint', () => {
    expect(getPlayableVideoUrl(
      '/view?filename=clip%20one.mp4&subfolder=video%2F2026&type=output&cb=123',
    )).toBe(
      '/mobile/api/video/playable?filename=clip%20one.mp4&subfolder=video%2F2026&type=output&cb=123',
    );
  });

  it('leaves blob and third-party playback URLs untouched', () => {
    const blob = 'blob:https://example.test/id';
    const external = 'https://cdn.example.test/clip.mp4?filename=clip.mp4&type=output';
    expect(getPlayableVideoUrl(blob)).toBe(blob);
    expect(getPlayableVideoUrl(external)).toBe(external);
  });
});
