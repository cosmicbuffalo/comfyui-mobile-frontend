import { getImageUrl, getImagePreviewUrl, type FileItem } from '@/api/client';
import type { Workflow } from '@/api/types';
import { extractMetadata } from '@/utils/metadata';
import { getMediaType, type MediaType } from '@/utils/media';

export interface ViewerImage {
  src: string;
  // Optional fast-loading WebP variant. JPEGs use `src` in the full-screen
  // viewer so browser-applied EXIF orientation remains correct. Never set for
  // videos.
  displaySrc?: string;
  alt?: string;
  mediaType?: MediaType;
  metadata?: ReturnType<typeof extractMetadata>;
  workflow?: Workflow;
  /** Concrete API prompt stored beside an output workflow in ComfyUI metadata. */
  executedPrompt?: unknown;
  promptId?: string;
  durationSeconds?: number;
  success?: boolean;
  filename?: string;
  file?: FileItem;
  // When set, the viewer renders an A/B before-after comparison (image A
  // revealed from the left up to a draggable wipe slider, image B behind),
  // sharing one zoom/pan transform. `src`/`displaySrc` above point at image A so
  // non-comparer code paths still have a usable single image.
  comparison?: ViewerComparison;
}

export interface ViewerComparison {
  aSrc: string;
  bSrc: string;
  aDisplaySrc?: string;
  bDisplaySrc?: string;
}

export interface HistoryImageSource {
  filename: string;
  subfolder: string;
  type: string;
  cacheToken?: string | number;
}

export function getHistoryImageFileId(image: HistoryImageSource): string {
  const filePath = image.subfolder
    ? `${image.subfolder}/${image.filename}`
    : image.filename;
  return `${image.type}/${filePath}`;
}

// Derive the same stable file id from an asset URL, so the id matches
// getHistoryImageFileId / FileItem.id everywhere. Returns null if the URL isn't
// a recognizable asset URL.
//
// The source parameter is spelled differently per endpoint: ComfyUI's `/view`
// uses `type`, while this node's thumbnail/preview endpoints use `source`.
// Reading only `type` silently returned null for every grid thumbnail — the
// caller then records nothing, with no error to notice.
//
// No production caller on this branch: the per-device download history that
// consumes it ships in 3.1.1.
export function fileIdFromAssetUrl(url: string): string | null {
  try {
    const parsed = new URL(url, window.location.origin);
    const filename = parsed.searchParams.get('filename');
    const type = parsed.searchParams.get('type') ?? parsed.searchParams.get('source');
    if (!filename || !type) return null;
    const subfolder = parsed.searchParams.get('subfolder') || '';
    return getHistoryImageFileId({ filename, subfolder, type });
  } catch {
    return null;
  }
}

export interface HistoryImageItem {
  prompt_id?: string;
  outputs?: { images?: HistoryImageSource[] };
  prompt: unknown;
  workflow?: Workflow;
  durationSeconds?: number;
  success?: boolean;
  hidden?: boolean;
}

interface BuildViewerImageOptions {
  onlyOutput?: boolean;
  preferOutputPerItem?: boolean;
  alt?: string | ((imageIndex: number, itemIndex: number) => string);
}

export function buildViewerImages(
  items: HistoryImageItem[],
  options: BuildViewerImageOptions = {}
): ViewerImage[] {
  const { onlyOutput = false, preferOutputPerItem = false, alt } = options;
  const images: ViewerImage[] = [];

  items.forEach((item, itemIndex) => {
    const outputs = item.outputs?.images ?? [];
    const metadata = extractMetadata(item.prompt);
    const durationSeconds = item.durationSeconds;
    const success = item.success !== false;
    const itemHasOutput =
      preferOutputPerItem && outputs.some((img) => img.type === 'output');

    outputs.forEach((img, imageIndex) => {
      if (onlyOutput && img.type !== 'output') return;
      if (itemHasOutput && img.type !== 'output') return;
      const altText = typeof alt === 'function' ? alt(imageIndex, itemIndex) : alt;
      const mediaType = getMediaType(img.filename);
      const fileType = mediaType === 'video' ? 'video' : 'image';
      images.push({
        src: getImageUrl(img.filename, img.subfolder, img.type, img.cacheToken),
        displaySrc: fileType === 'image'
          ? getImagePreviewUrl(img.filename, img.subfolder, img.type, img.cacheToken)
          : undefined,
        alt: altText,
        mediaType,
        metadata,
        workflow: item.workflow,
        executedPrompt: item.prompt,
        promptId: item.prompt_id,
        durationSeconds,
        success,
        filename: img.filename,
        file: {
          id: getHistoryImageFileId(img),
          name: img.filename,
          type: fileType,
          fullUrl: getImageUrl(img.filename, img.subfolder, img.type, img.cacheToken),
          hidden: item.hidden,
        }
      });
    });
  });

  return images;
}

/**
 * Fill in the identity a viewer item is meant to carry, from its own URL.
 *
 * The viewer keys almost everything off `file` and `filename`: the header title,
 * favourite, reject, delete and download all read one or the other, and an item
 * carrying neither renders as the alt text ("Generation") with a row of inert
 * buttons. Every list builder in the app attaches both — but the viewer is a
 * shared surface fed from a dozen call sites, and one that forgets is a silent,
 * confusing failure rather than a loud one.
 *
 * So the guarantee is enforced here instead of trusted at each producer. A
 * server asset URL already names the file, the subfolder and the source, which
 * is exactly what `file` needs; anything else (a `blob:` latent preview) is
 * returned untouched, since inventing an identity for it would make delete and
 * favourite reach for a file that does not exist.
 */
export function ensureViewerImageIdentity(item: ViewerImage): ViewerImage {
  if (item.file && item.filename) return item;
  const fileId = fileIdFromAssetUrl(item.src);
  if (!fileId) return item;
  // `${type}/${subfolder?}/${name}` — the name is whatever follows the last
  // separator, and the type is what precedes the first.
  const name = fileId.slice(fileId.lastIndexOf('/') + 1);
  if (!name) return item;
  const mediaType = item.mediaType ?? getMediaType(name);
  return {
    ...item,
    filename: item.filename ?? name,
    mediaType,
    file: item.file ?? {
      id: fileId,
      name,
      type: mediaType === 'video' ? 'video' : 'image',
      fullUrl: item.src,
    },
  };
}

export function buildOutputPreferredViewerImages(
  items: HistoryImageItem[],
  options: Omit<BuildViewerImageOptions, 'onlyOutput' | 'preferOutputPerItem'> = {}
): ViewerImage[] {
  return buildViewerImages(items, { ...options, preferOutputPerItem: true });
}
