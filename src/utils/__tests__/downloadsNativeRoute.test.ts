import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_APP_UA_MARKER } from '@/utils/nativeApp';
import { downloadImage, shareOrDownloadFile, shareOrDownloadBatch } from '@/utils/downloads';

// Inside CueForge's WebView, an anchor click is a top-level navigation: the
// `download` attribute is ignored and the user is stranded on the bare image
// URL. Every save path must therefore reach the savePhoto bridge *instead of*
// the anchor — "as well as" is a bug, not a fallback. On the open web the
// anchor path must be untouched.

type Complete = (requestId: number, ok: boolean) => void;

const WEB_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15';
const APP_UA = `${WEB_UA} ${NATIVE_APP_UA_MARKER}/1.0`;

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value });
}

/**
 * Auto-completing savePhoto channel: answers every request with `ok` as soon
 * as it's posted, standing in for the app's PhotoSaver.
 */
function installChannel(ok: boolean) {
  const posted: Array<{ url: string; filename: string; requestId: number }> = [];
  (window as unknown as Record<string, unknown>).savePhoto = {
    postMessage: (message: string) => {
      const request = JSON.parse(message);
      posted.push(request);
      const complete = (window as unknown as { __comfyuiMobileSavePhotoComplete?: Complete })
        .__comfyuiMobileSavePhotoComplete;
      complete?.(request.requestId, ok);
    },
  };
  return posted;
}

describe('downloads native-app routing', () => {
  let clicks: string[];

  beforeEach(() => {
    clicks = [];
    // Record anchor clicks without letting jsdom attempt a navigation.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.href);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as Record<string, unknown>).savePhoto;
    setUserAgent(WEB_UA);
  });

  describe('in the native app', () => {
    beforeEach(() => setUserAgent(APP_UA));

    it('routes downloadImage through the bridge and never clicks an anchor', async () => {
      const posted = installChannel(true);
      const onDownloaded = vi.fn();
      await downloadImage('/api/view?filename=a.png', 'a.png', onDownloaded);
      expect(posted).toHaveLength(1);
      expect(clicks).toEqual([]);
      expect(onDownloaded).toHaveBeenCalledWith('/api/view?filename=a.png');
    });

    it('does not report a save the app said failed', async () => {
      installChannel(false);
      const onDownloaded = vi.fn();
      await downloadImage('/api/view?filename=a.png', 'a.png', onDownloaded);
      expect(onDownloaded).not.toHaveBeenCalled();
    });

    it('reports the photos route with the real per-save result', async () => {
      installChannel(true);
      await expect(shareOrDownloadFile('/api/view?filename=a.png', 'a.png')).resolves.toEqual({
        route: 'photos',
        ok: true,
      });

      installChannel(false);
      await expect(shareOrDownloadFile('/api/view?filename=b.png', 'b.png')).resolves.toEqual({
        route: 'photos',
        ok: false,
      });
      expect(clicks).toEqual([]);
    });

    it('saves every item of a batch through the bridge', async () => {
      const posted = installChannel(true);
      const onCompleted = vi.fn();
      await shareOrDownloadBatch(
        [
          { src: '/api/view?filename=a.png', filename: 'a.png' },
          { src: '/api/view?filename=b.png', filename: 'b.png' },
        ],
        onCompleted,
      );
      expect(posted.map((p) => p.filename)).toEqual(['a.png', 'b.png']);
      expect(onCompleted).toHaveBeenCalledTimes(2);
      expect(clicks).toEqual([]);
    });

    it('keeps going through the rest of a batch when one item fails', async () => {
      installChannel(false);
      const onCompleted = vi.fn();
      await shareOrDownloadBatch(
        [
          { src: '/api/view?filename=a.png', filename: 'a.png' },
          { src: '/api/view?filename=b.png', filename: 'b.png' },
        ],
        onCompleted,
      );
      expect(onCompleted).not.toHaveBeenCalled();
      expect(clicks).toEqual([]);
    });

    it('falls back to the anchor when the app build has no savePhoto channel', async () => {
      await expect(shareOrDownloadFile('/api/view?filename=a.png', 'a.png')).resolves.toEqual({
        route: 'downloads',
        started: true,
      });
      expect(clicks).toHaveLength(1);
    });
  });

  describe('on the open web', () => {
    beforeEach(() => setUserAgent(WEB_UA));

    it('uses the anchor path and reports `started`, not a claimed success', async () => {
      installChannel(true);
      await expect(shareOrDownloadFile('/api/view?filename=a.png', 'a.png')).resolves.toEqual({
        route: 'downloads',
        started: true,
      });
      expect(clicks).toHaveLength(1);
    });

    it('reports started: false when the click never happened', async () => {
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
        throw new Error('blocked');
      });
      await expect(shareOrDownloadFile('/api/view?filename=a.png', 'a.png')).resolves.toEqual({
        route: 'downloads',
        started: false,
      });
    });
  });
});
