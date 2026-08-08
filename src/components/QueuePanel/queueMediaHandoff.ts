import { getQueueImagePreviewUrl, getImageUrl } from '@/api/client';
import type { HistoryOutputImage } from '@/api/types';
import { getQueueImageKey } from './queueUtils';

export function getQueueMediaSignature(images: readonly HistoryOutputImage[]): string {
  return images.map(getQueueImageKey).join('\0');
}

export function shouldHoldPreviousQueueMedia({
  isDone,
  previousImages,
  nextImages,
  readySignature,
}: {
  isDone: boolean;
  previousImages: readonly HistoryOutputImage[];
  nextImages: readonly HistoryOutputImage[];
  readySignature: string | null;
}): boolean {
  if (!isDone || previousImages.length === 0 || nextImages.length === 0) return false;
  const nextSignature = getQueueMediaSignature(nextImages);
  return getQueueMediaSignature(previousImages) !== nextSignature
    && readySignature !== nextSignature;
}

// The output file can lag a beat behind the history event that announces it, so
// a single load attempt often hits a transient 404. Retry through that window
// instead of resolving on the first error (which would open the swap gate before
// the image is actually paintable, producing the preview→final flicker).
const PRELOAD_MAX_ATTEMPTS = 12;
const PRELOAD_RETRY_MS = 250;
// Fail open: if the media genuinely never becomes loadable, resolve anyway after
// this long so a stuck preload can't pin the card on stale preview media.
const PRELOAD_TIMEOUT_MS = 6000;

export type PreloadDims = { w: number; h: number } | null;

function preloadImage(image: HistoryOutputImage): Promise<PreloadDims> {
  const url = getQueueImagePreviewUrl(image.filename, image.subfolder, image.type);
  return new Promise((resolve) => {
    let settled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (dims: PreloadDims) => {
      if (settled) return;
      settled = true;
      clearTimeout(retryTimer);
      clearTimeout(failOpenTimer);
      resolve(dims);
    };
    const failOpenTimer = setTimeout(() => finish(null), PRELOAD_TIMEOUT_MS);
    const attempt = () => {
      if (settled) return;
      attempts += 1;
      const preload = new Image();
      const captureDims = (): PreloadDims =>
        preload.naturalWidth > 0 && preload.naturalHeight > 0
          ? { w: preload.naturalWidth, h: preload.naturalHeight }
          : null;
      const onReady = () => {
        const dims = captureDims();
        // Decode so the bytes are ready to paint, not just fetched, before the
        // visible <img> swaps in.
        if (typeof preload.decode === 'function') {
          void preload.decode().catch(() => {}).then(() => finish(dims));
        } else {
          finish(dims);
        }
      };
      preload.onload = onReady;
      preload.onerror = () => {
        if (attempts >= PRELOAD_MAX_ATTEMPTS) {
          finish(null);
          return;
        }
        retryTimer = setTimeout(attempt, PRELOAD_RETRY_MS);
      };
      preload.src = url;
      if (preload.complete && preload.naturalWidth > 0) {
        onReady();
      }
    };
    attempt();
  });
}

export interface QueueMediaPreload {
  image: HistoryOutputImage;
  url: string;
  dims: PreloadDims;
}

export async function preloadQueueMedia(
  images: readonly HistoryOutputImage[],
): Promise<QueueMediaPreload[]> {
  return Promise.all(images.map(async (image) => {
    const url = getImageUrl(image.filename, image.subfolder, image.type);
    // Images only. Video targets never reach here: QueueCard stages them
    // immediately rather than serializing a poster preload ahead of the
    // playable-video request, so a video branch in this function would be dead.
    const dims = await preloadImage(image);
    return { image, url, dims };
  }));
}
