import { getImageUrl } from '@/api/client';
import type { HistoryOutputImage } from '@/api/types';
import { isHistoryEntryData, type UnifiedItem } from './types';
import { isVideoFilename } from '@/utils/media';

interface QueueOutputDisplayOptions {
  includeInputImages?: boolean;
}

const LOAD_IMAGE_INPUT_KEYS = ['image', 'filename', 'file'];

export function isDisplayableQueueOutput(
  img: HistoryOutputImage,
  options: QueueOutputDisplayOptions = {},
): boolean {
  if (!img.filename.trim()) return false;
  if (img.type === 'output') return true;
  if (img.type === 'input') return Boolean(options.includeInputImages);

  // Video-combine nodes can emit temporary video refs for previews/intermediate
  // values even when they were not saved as real outputs. Those refs often are
  // not durable/viewable and they crowd out the running progress UI.
  return !isVideoFilename(img.filename);
}

export function getDisplayableQueueOutputs(
  images: HistoryOutputImage[],
  options: QueueOutputDisplayOptions = {},
): HistoryOutputImage[] {
  return images.filter((img) => isDisplayableQueueOutput(img, options));
}

export function dedupeQueueImages(images: HistoryOutputImage[]): HistoryOutputImage[] {
  const seen = new Set<string>();
  return images.filter((img) => {
    const key = getQueueImageKey(img);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getQueueImageKey(img: HistoryOutputImage): string {
  return `${img.type}/${img.subfolder}/${img.filename}`;
}

export function preserveQueueImageOrder(
  previousKeys: string[],
  images: HistoryOutputImage[],
): HistoryOutputImage[] {
  if (previousKeys.length === 0 || images.length < 2) return images;
  const previousIndex = new Map(previousKeys.map((key, index) => [key, index]));
  return images
    .map((image, index) => ({ image, index }))
    .sort((a, b) => {
      const aPrevious = previousIndex.get(getQueueImageKey(a.image));
      const bPrevious = previousIndex.get(getQueueImageKey(b.image));
      if (aPrevious !== undefined && bPrevious !== undefined) return aPrevious - bPrevious;
      if (aPrevious !== undefined) return -1;
      if (bPrevious !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ image }) => image);
}

export function getPromptInputImages(prompt: Record<string, unknown>): HistoryOutputImage[] {
  const images: HistoryOutputImage[] = [];
  const seen = new Set<string>();

  for (const node of Object.values(prompt)) {
    const record = asRecord(node);
    if (!record || !isLoadImagePromptNode(record)) continue;
    const inputs = asRecord(record.inputs);
    if (!inputs) continue;

    for (const key of LOAD_IMAGE_INPUT_KEYS) {
      const parsed = parsePromptInputImage(inputs[key]);
      if (!parsed) continue;
      const imageKey = `${parsed.type}/${parsed.subfolder}/${parsed.filename}`;
      if (seen.has(imageKey)) continue;
      seen.add(imageKey);
      images.push(parsed);
      break;
    }
  }

  return images;
}

export function getBatchSources(promptId: string, list: UnifiedItem[]): string[] {
  const match = list.find((item) => item.id === promptId);
  if (!match || match.status !== 'done') return [];
  if (!isHistoryEntryData(match.data)) return [];
  const images = getDisplayableQueueOutputs(match.data.outputs.images ?? []);
  return images
    .filter((img: HistoryOutputImage) => img.type === 'output')
    .map((img: HistoryOutputImage) => getImageUrl(img.filename, img.subfolder, img.type));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isLoadImagePromptNode(node: Record<string, unknown>): boolean {
  const classType = typeof node.class_type === 'string' ? node.class_type : '';
  const meta = asRecord(node._meta);
  const title = typeof meta?.title === 'string' ? meta.title : '';
  return /load[\s_-]*image/i.test(`${classType} ${title}`);
}

function parsePromptInputImage(value: unknown): HistoryOutputImage | null {
  if (typeof value === 'string' && value.trim()) {
    const { filename, subfolder } = splitSubfolder(value.trim());
    return { filename, subfolder, type: 'input' };
  }
  const record = asRecord(value);
  if (!record) return null;
  const rawFilename = typeof record.filename === 'string'
    ? record.filename
    : typeof record.name === 'string'
      ? record.name
      : null;
  if (!rawFilename?.trim()) return null;
  const { filename, subfolder } = splitSubfolder(rawFilename.trim());
  const explicitSubfolder = typeof record.subfolder === 'string' ? record.subfolder : '';
  const type = typeof record.type === 'string' && record.type.trim()
    ? record.type.trim()
    : 'input';
  return {
    filename,
    subfolder: explicitSubfolder || subfolder,
    type,
  };
}

function splitSubfolder(path: string): { filename: string; subfolder: string } {
  const normalized = path.replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return { filename: normalized, subfolder: '' };
  }
  const filename = parts.pop() ?? normalized;
  return { filename, subfolder: parts.join('/') };
}
