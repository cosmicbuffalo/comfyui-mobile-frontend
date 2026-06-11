import type { NodeTypes } from '../types';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import { getImageCacheToken } from '@/utils/imageCacheBust';

function getOrCreateClientId(): string {
  const storageKey = 'comfyui-mobile-client-id';
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = 'mobile-' + Math.random().toString(36).substring(2, 15);
    localStorage.setItem(storageKey, id);
  }
  return id;
}

export const clientId = getOrCreateClientId();

export async function getNodeTypes(): Promise<NodeTypes> {
  const response = await fetch(`/api/object_info`);
  if (!response.ok) throw new Error('Failed to fetch node types');
  return response.json();
}

export function getImageUrl(filename: string, subfolder: string, type: string): string {
  const url = `/view?filename=${encodeURIComponent(filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`;
  // Append a cache-bust token if this filename was deleted and (possibly) reused
  // by a later generation, so the browser doesn't serve the stale deleted image.
  const token = getImageCacheToken(filename, subfolder, type);
  return token ? `${url}&cb=${token}` : url;
}

// Display-only variant of getImageUrl. Asks ComfyUI's /view endpoint to
// re-encode the image to a small WebP on the fly — same full resolution, but a
// fraction of the bytes of the source PNG, so inline previews/thumbnails load
// near-instantly instead of streaming a multi-MB file top-to-bottom.
//
// Use for previews and thumbnails only. Do NOT use for: downloads/share (you
// want the original file), videos (this param is image-only), or anywhere a
// pixel-exact PNG is required. Metadata is unaffected — it's read server-side
// from the original file via a separate endpoint.
export function getImagePreviewUrl(filename: string, subfolder: string, type: string): string {
  return withWebpPreview(getImageUrl(filename, subfolder, type));
}

// Append the WebP preview param to an existing `/view` URL. Same effect as
// getImagePreviewUrl, for callers that already hold a full `/view` URL string
// rather than the filename/subfolder/type parts. Images only — never videos.
//
// Honors the user's `webpPreviewEnabled` preference: when opted out, the URL is
// returned untouched so the original (PNG) is loaded everywhere.
export function withWebpPreview(viewUrl: string): string {
  if (!useGenerationSettingsStore.getState().webpPreviewEnabled) return viewUrl;
  return `${viewUrl}&preview=webp;90`;
}

// Longest edge (in device pixels) worth loading for a fit-to-screen image. We
// cap it so a 14-megapixel original isn't downloaded/decoded on a phone that can
// only show ~2-4 MP. Capped at 2560 to bound memory; full-resolution detail is
// loaded lazily on zoom (Phase 2). SSR-safe fallback of 2048.
function screenMaxEdge(): number {
  if (typeof window === 'undefined') return 2048;
  const dpr = window.devicePixelRatio || 1;
  const longest = Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0);
  const target = Math.round((longest || 1024) * dpr);
  return Math.max(1024, Math.min(2560, target));
}

// Full-screen viewer image src: a downscaled, screen-sized WebP from our mobile
// backend (`/mobile/api/preview`) instead of ComfyUI's full-resolution
// `&preview=webp`. Takes a `/view?...` URL (filename/subfolder/type) and routes
// it to the preview endpoint with a `maxedge` cap. Honors the user's
// `webpPreviewEnabled` preference: when opted out, returns the original URL so
// pixel-exact originals load everywhere. Images only — never videos.
export function getScreenPreviewUrl(viewUrl: string): string {
  if (!useGenerationSettingsStore.getState().webpPreviewEnabled) return viewUrl;
  const queryStart = viewUrl.indexOf('?');
  if (queryStart < 0) return viewUrl;
  const query = viewUrl.slice(queryStart + 1);
  return `/mobile/api/preview?${query}&maxedge=${screenMaxEdge()}`;
}

export function connectWebSocket(
  clientId: string,
  onMessage: (msg: unknown) => void,
  onOpen?: () => void,
  onClose?: () => void,
  onError?: (error: Event) => void,
  onBinaryMessage?: (data: ArrayBuffer) => void,
): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws?clientId=${clientId}`;

  const ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    onOpen?.();
  };

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (e) {
        console.error('[WS] Failed to parse message:', e);
      }
    } else if (event.data instanceof ArrayBuffer) {
      onBinaryMessage?.(event.data);
    }
  };

  ws.onclose = () => {
    onClose?.();
  };

  ws.onerror = (error) => {
    console.error('[WS] Error:', error);
    onError?.(error);
  };

  return ws;
}

