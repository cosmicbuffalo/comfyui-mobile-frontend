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
        src: getImageUrl(img.filename, img.subfolder, img.type),
        displaySrc: fileType === 'image'
          ? getImagePreviewUrl(img.filename, img.subfolder, img.type)
          : undefined,
        alt: altText,
        mediaType,
        metadata,
        workflow: item.workflow,
        promptId: item.prompt_id,
        durationSeconds,
        success,
        filename: img.filename,
        file: {
          id: getHistoryImageFileId(img),
          name: img.filename,
          type: fileType,
          fullUrl: getImageUrl(img.filename, img.subfolder, img.type),
          hidden: item.hidden,
        }
      });
    });
  });

  return images;
}

export function buildOutputPreferredViewerImages(
  items: HistoryImageItem[],
  options: Omit<BuildViewerImageOptions, 'onlyOutput' | 'preferOutputPerItem'> = {}
): ViewerImage[] {
  return buildViewerImages(items, { ...options, preferOutputPerItem: true });
}
