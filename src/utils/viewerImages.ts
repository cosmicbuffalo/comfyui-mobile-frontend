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
