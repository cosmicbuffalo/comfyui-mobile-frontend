import { getImageUrl } from '@/api/client';
import { extractMetadata } from '@/utils/metadata';
import { getMediaType, type MediaType } from '@/utils/media';

export interface ViewerImage {
  src: string;
  alt?: string;
  mediaType?: MediaType;
  metadata?: ReturnType<typeof extractMetadata>;
  durationSeconds?: number;
  success?: boolean;
}

export interface HistoryImageSource {
  filename: string;
  subfolder: string;
  type: string;
}

export interface HistoryImageItem {
  outputs?: { images?: HistoryImageSource[] };
  prompt: unknown;
  durationSeconds?: number;
  success?: boolean;
}

interface BuildViewerImageOptions {
  onlyOutput?: boolean;
  alt?: string | ((imageIndex: number, itemIndex: number) => string);
}

export function buildViewerImages(
  items: HistoryImageItem[],
  options: BuildViewerImageOptions = {}
): ViewerImage[] {
  const { onlyOutput = false, alt } = options;
  const images: ViewerImage[] = [];

  items.forEach((item, itemIndex) => {
    const outputs = item.outputs?.images ?? [];
    const metadata = extractMetadata(item.prompt);
    const durationSeconds = item.durationSeconds;
    const success = item.success !== false;

    outputs.forEach((img, imageIndex) => {
      if (onlyOutput && img.type !== 'output') return;
      const altText = typeof alt === 'function' ? alt(imageIndex, itemIndex) : alt;
      images.push({
        src: getImageUrl(img.filename, img.subfolder, img.type),
        alt: altText,
        mediaType: getMediaType(img.filename),
        metadata,
        durationSeconds,
        success
      });
    });
  });

  return images;
}
