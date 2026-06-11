import type { PromptQueueRequest } from '@/api/client';

export function buildReenqueueRequest(
  original: PromptQueueRequest,
  clientId: string,
): PromptQueueRequest {
  return {
    ...original,
    client_id: clientId,
  };
}
