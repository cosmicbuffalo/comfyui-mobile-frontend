import { getImageUrl, type FileItem } from '@/api/client';
import type { Workflow } from '@/api/types';
import { extractMetadata } from '@/utils/metadata';
import { getMediaType, type MediaType } from '@/utils/media';

export interface ViewerImage {
  src: string;
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

export interface HistoryImageItem {
  prompt_id?: string;
  outputs?: { images?: HistoryImageSource[] };
  prompt: unknown;
  workflow?: Workflow;
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
      const filePath = img.subfolder ? `${img.subfolder}/${img.filename}` : img.filename;
      const mediaType = getMediaType(img.filename);
      const fileType = mediaType === 'video' ? 'video' : 'image';
      images.push({
        src: getImageUrl(img.filename, img.subfolder, img.type),
        alt: altText,
        mediaType,
        metadata,
        workflow: item.workflow,
        promptId: item.prompt_id,
        durationSeconds,
        success,
        filename: img.filename,
        file: {
          id: `${img.type}/${filePath}`,
          name: img.filename,
          type: fileType,
          fullUrl: getImageUrl(img.filename, img.subfolder, img.type)
        }
      });
    });
  });

  return images;
}
