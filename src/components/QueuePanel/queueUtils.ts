import { getImageUrl } from '@/api/client';
import type { HistoryOutputImage } from '@/api/types';
import { isHistoryEntryData, type UnifiedItem } from './types';

export function getBatchSources(promptId: string, list: UnifiedItem[]): string[] {
  const match = list.find((item) => item.id === promptId);
  if (!match || match.status !== 'done') return [];
  if (!isHistoryEntryData(match.data)) return [];
  const images = match.data.outputs.images ?? [];
  return images
    .filter((img: HistoryOutputImage) => img.type === 'output')
    .map((img: HistoryOutputImage) => getImageUrl(img.filename, img.subfolder, img.type));
}
