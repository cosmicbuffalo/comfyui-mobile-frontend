import { getImagePreviewUrl, getImageUrl } from '@/api/client';
import type { HistoryOutputImage } from '@/api/types';
import { isVideoFilename } from '@/utils/media';
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

function preloadImage(image: HistoryOutputImage): Promise<void> {
  const url = getImagePreviewUrl(image.filename, image.subfolder, image.type);
  return new Promise((resolve) => {
    let settled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(retryTimer);
      clearTimeout(failOpenTimer);
      resolve();
    };
    const failOpenTimer = setTimeout(finish, PRELOAD_TIMEOUT_MS);
    const attempt = () => {
      if (settled) return;
      attempts += 1;
      const preload = new Image();
      const onReady = () => {
        // Decode so the bytes are ready to paint, not just fetched, before the
        // visible <img> swaps in.
        if (typeof preload.decode === 'function') {
          void preload.decode().catch(() => {}).then(finish);
        } else {
          finish();
        }
      };
      preload.onload = onReady;
      preload.onerror = () => {
        if (attempts >= PRELOAD_MAX_ATTEMPTS) {
          finish();
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

function preloadVideo(video: HistoryOutputImage): Promise<void> {
  const url = getImageUrl(video.filename, video.subfolder, video.type);
  return new Promise((resolve) => {
    let settled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(retryTimer);
      clearTimeout(failOpenTimer);
      resolve();
    };
    const failOpenTimer = setTimeout(finish, PRELOAD_TIMEOUT_MS);
    const attempt = () => {
      if (settled) return;
      attempts += 1;
      const preload = document.createElement('video');
      const cleanup = () => {
        preload.removeEventListener('loadeddata', onReady);
        preload.removeEventListener('error', onError);
      };
      const onReady = () => {
        cleanup();
        finish();
      };
      const onError = () => {
        cleanup();
        if (attempts >= PRELOAD_MAX_ATTEMPTS) {
          finish();
          return;
        }
        retryTimer = setTimeout(attempt, PRELOAD_RETRY_MS);
      };
      preload.preload = 'auto';
      preload.addEventListener('loadeddata', onReady);
      preload.addEventListener('error', onError);
      preload.src = url;
      preload.load();
    };
    attempt();
  });
}

export async function preloadQueueMedia(images: readonly HistoryOutputImage[]): Promise<void> {
  await Promise.all(images.map((image) => (
    isVideoFilename(image.filename) ? preloadVideo(image) : preloadImage(image)
  )));
}
