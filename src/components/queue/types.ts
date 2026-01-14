import type { HistoryOutputImage, Workflow } from '@/api/types';
import type { extractMetadata } from '@/utils/metadata';
import type { MediaType } from '@/utils/media';

export interface ViewerImage {
  src: string;
  alt?: string;
  mediaType?: MediaType;
  metadata?: ReturnType<typeof extractMetadata>;
  durationSeconds?: number;
  success?: boolean;
}

export type ItemStatus = 'pending' | 'running' | 'done';

export interface QueueItemData {
  number: number;
  prompt_id: string;
  prompt: Record<string, unknown>;
  extra: Record<string, unknown>;
  outputs_to_execute: string[];
}

export interface HistoryEntryData {
  prompt_id: string;
  timestamp: number;
  durationSeconds?: number;
  success?: boolean;
  outputs: {
    images: HistoryOutputImage[];
  };
  prompt: Record<string, unknown>;
  workflow?: Workflow;
}

export type UnifiedItemData = QueueItemData | HistoryEntryData;

export interface UnifiedItem {
  id: string;
  status: ItemStatus;
  data: UnifiedItemData;
  timestamp?: number;
}

export function isHistoryEntryData(data: UnifiedItemData): data is HistoryEntryData {
  return 'outputs' in data;
}
