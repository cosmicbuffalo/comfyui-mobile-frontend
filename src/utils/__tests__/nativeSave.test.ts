import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE_APP_UA_MARKER, isInNativeApp } from '@/utils/nativeApp';
import { canSaveToPhotosInNativeApp, saveToPhotosInNativeApp } from '@/utils/nativeSave';

// The Save-to-Photos bridge: the only path by which a download reaches the
// camera roll inside CueForge. Two things must hold or the UI lies to the user
// — the bridge reports back the *real* per-save result, and it returns null
// (rather than a hanging promise) on any surface that can't handle it, so the
// caller falls through to the plain web download.

type Complete = (requestId: number, ok: boolean) => void;

const WEB_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/605.1.15';
const APP_UA = `${WEB_UA} ${NATIVE_APP_UA_MARKER}/1.0`;

function setUserAgent(value: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value });
}

/** Install a fake `window.savePhoto` channel and capture what it's posted. */
function installChannel(): Array<{ url: string; filename: string; requestId: number }> {
  const posted: Array<{ url: string; filename: string; requestId: number }> = [];
  (window as unknown as Record<string, unknown>).savePhoto = {
    postMessage: (message: string) => posted.push(JSON.parse(message)),
  };
  return posted;
}

function completeRequest(requestId: number, ok: boolean) {
  const complete = (window as unknown as { __comfyuiMobileSavePhotoComplete?: Complete })
    .__comfyuiMobileSavePhotoComplete;
  complete?.(requestId, ok);
}

describe('saveToPhotosInNativeApp', () => {
  beforeEach(() => {
    setUserAgent(APP_UA);
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).savePhoto;
    setUserAgent(WEB_UA);
    vi.useRealTimers();
  });

  it('detects the native app from the WebView user-agent marker', () => {
    expect(isInNativeApp()).toBe(true);
    setUserAgent(WEB_UA);
    expect(isInNativeApp()).toBe(false);
  });

  it('returns null on the open web so callers fall through to the web download', () => {
    setUserAgent(WEB_UA);
    installChannel();
    expect(saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png')).toBeNull();
  });

  it('returns null in-app when no savePhoto channel is installed', () => {
    expect(saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png')).toBeNull();
  });

  it('posts an absolute URL so the native side needn\'t know the WebView origin', () => {
    const posted = installChannel();
    saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png');
    expect(posted).toHaveLength(1);
    expect(posted[0].url).toBe(`${window.location.origin}/api/view?filename=a.png`);
    expect(posted[0].filename).toBe('a.png');
  });

  it('resolves with the result the native side reports', async () => {
    const posted = installChannel();
    const saved = saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png');
    expect(saved).not.toBeNull();
    completeRequest(posted[0].requestId, true);
    await expect(saved).resolves.toBe(true);

    const failed = saveToPhotosInNativeApp('/api/view?filename=b.png', 'b.png');
    completeRequest(posted[1].requestId, false);
    await expect(failed).resolves.toBe(false);
  });

  it('keeps concurrent saves separate', async () => {
    const posted = installChannel();
    const first = saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png');
    const second = saveToPhotosInNativeApp('/api/view?filename=b.png', 'b.png');
    expect(posted[0].requestId).not.toBe(posted[1].requestId);

    // Complete out of order: the second save must not resolve the first.
    completeRequest(posted[1].requestId, false);
    completeRequest(posted[0].requestId, true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });

  it('ignores a completion for an unknown request id', async () => {
    const posted = installChannel();
    const saved = saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png');
    completeRequest(posted[0].requestId + 9999, true);
    completeRequest(posted[0].requestId, false);
    await expect(saved).resolves.toBe(false);
  });

  it('resolves false rather than hanging when native never reports back', async () => {
    vi.useFakeTimers();
    installChannel();
    const saved = saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png');
    vi.advanceTimersByTime(30_000);
    await expect(saved).resolves.toBe(false);
  });

  it('clears the ceiling timer once native reports back', async () => {
    vi.useFakeTimers();
    const posted = installChannel();
    const saved = saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png');
    completeRequest(posted[0].requestId, true);
    await expect(saved).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not resolve twice when a late completion follows the timeout', async () => {
    vi.useFakeTimers();
    const posted = installChannel();
    const saved = saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png');
    vi.advanceTimersByTime(30_000);
    completeRequest(posted[0].requestId, true);
    await expect(saved).resolves.toBe(false);
  });

  it('returns null when the channel throws instead of propagating', () => {
    (window as unknown as Record<string, unknown>).savePhoto = {
      postMessage: () => {
        throw new Error('channel dropped');
      },
    };
    expect(saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png')).toBeNull();
  });

  // Returning null sends the caller down the web download path, so nothing is
  // waiting on the request any more. Leaving it registered would pile up a
  // timer per failure and let a late native callback resolve an abandoned
  // promise — so a failed post must leave no pending state behind.
  it('leaves no pending request or timer behind when the channel throws', async () => {
    vi.useFakeTimers();
    let shouldThrow = true;
    const posted: Array<{ requestId: number }> = [];
    (window as unknown as Record<string, unknown>).savePhoto = {
      postMessage: (message: string) => {
        if (shouldThrow) throw new Error('channel dropped');
        posted.push(JSON.parse(message));
      },
    };

    expect(saveToPhotosInNativeApp('/api/view?filename=a.png', 'a.png')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    // A completion arriving late for the abandoned id must find nothing
    // registered, and must not disturb a subsequent real save.
    completeRequest(1, true);
    shouldThrow = false;
    const saved = saveToPhotosInNativeApp('/api/view?filename=b.png', 'b.png');
    expect(saved).not.toBeNull();
    completeRequest(posted[0].requestId, true);
    await expect(saved).resolves.toBe(true);
  });
});

// UI copy ("Saving to Photos…") gates on this rather than on the UA marker:
// a session can carry the marker with no bridge installed, and those saves go
// down the plain web download path instead.
describe('canSaveToPhotosInNativeApp', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).savePhoto;
    setUserAgent(WEB_UA);
  });

  it('is true only inside the app with the bridge present', () => {
    setUserAgent(APP_UA);
    installChannel();
    expect(canSaveToPhotosInNativeApp()).toBe(true);
  });

  it('is false in-app when no bridge is installed', () => {
    setUserAgent(APP_UA);
    expect(isInNativeApp()).toBe(true);
    expect(canSaveToPhotosInNativeApp()).toBe(false);
  });

  it('is false on the open web even if something named savePhoto exists', () => {
    setUserAgent(WEB_UA);
    installChannel();
    expect(canSaveToPhotosInNativeApp()).toBe(false);
  });
});
