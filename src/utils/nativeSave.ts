import { isInNativeApp } from '@/utils/nativeApp';

/**
 * In the native iOS app, posts a Save-to-Photos request over the WebView's
 * `savePhoto` JS channel. The app fetches the bytes itself (URLSession with
 * the server's auth headers), prompts for camera-roll permission once, and
 * writes the asset to PHPhotoLibrary.
 *
 * Returns a Promise<boolean> when the request was posted — resolves to true
 * iff the native side reported a successful save, false on any failure or
 * timeout. The host invokes `window.__comfyuiMobileSavePhotoComplete(rid,
 * ok)` on completion; we keep a per-request callback map so concurrent
 * downloads don't tangle.
 *
 * Returns null on the open web or when the bridge isn't present — callers
 * fall through to the standard web download path.
 */
type SavePhotoComplete = (requestId: number, ok: boolean) => void;

let nextRequestId = 0;
const pending = new Map<number, { resolve: (ok: boolean) => void; timeoutId: number }>();

if (typeof window !== 'undefined') {
  (window as unknown as { __comfyuiMobileSavePhotoComplete?: SavePhotoComplete })
    .__comfyuiMobileSavePhotoComplete = (requestId, ok) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    // Native answered — the outer ceiling timer has nothing left to guard.
    window.clearTimeout(entry.timeoutId);
    entry.resolve(ok);
  };
}

// Outer ceiling — if native never reports back (channel dropped, app
// backgrounded mid-write, etc.) we resolve false so the UI doesn't spin
// forever. The PhotoSaver itself does its own permission + write within
// a few seconds in the happy path; 30s is the don't-strand-the-user fallback.
const NATIVE_SAVE_TIMEOUT_MS = 30000;

// The app exposes its bridge as `window.<name>.postMessage(string)`.
function savePhotoChannel(): { postMessage: (m: string) => void } | null {
  if (!isInNativeApp()) return null;
  if (typeof window === 'undefined') return null;
  const channel = (window as unknown as Record<string, unknown>).savePhoto;
  if (!channel || typeof (channel as { postMessage?: unknown }).postMessage !== 'function') {
    return null;
  }
  return channel as { postMessage: (m: string) => void };
}

/**
 * True only when a save really would land in Photos. The UA marker alone isn't
 * enough — a session can carry the marker without the `savePhoto` channel
 * being installed, and those saves fall through to the web download path. UI copy
 * ("Saving to Photos…") gates on this, not on `isInNativeApp()`.
 */
export function canSaveToPhotosInNativeApp(): boolean {
  return savePhotoChannel() !== null;
}

export function saveToPhotosInNativeApp(
  src: string,
  filename: string,
): Promise<boolean> | null {
  const channel = savePhotoChannel();
  if (!channel) return null;
  let requestId: number | null = null;
  let timeoutId: number | undefined;
  try {
    // Resolve relative ComfyUI URLs (`/api/view?...`) to absolute so the
    // native side doesn't have to know the WebView origin.
    const absoluteUrl = new URL(src, window.location.origin).toString();
    const id = ++nextRequestId;
    requestId = id;
    const promise = new Promise<boolean>((resolve) => {
      timeoutId = window.setTimeout(() => {
        if (pending.delete(id)) resolve(false);
      }, NATIVE_SAVE_TIMEOUT_MS);
      pending.set(id, { resolve, timeoutId });
    });
    channel.postMessage(JSON.stringify({ url: absoluteUrl, filename, requestId: id }));
    return promise;
  } catch {
    // Returning null sends the caller down the web download path, so nothing
    // holds this request any more. Drop the pending entry and its timer
    // instead of letting them sit for the full timeout — otherwise repeated
    // failures pile up timers, and a late native callback resolves a promise
    // the caller already abandoned.
    if (requestId !== null) pending.delete(requestId);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    return null;
  }
}
