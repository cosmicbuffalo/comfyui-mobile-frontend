export const QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY = 'mobile_workflow_label';

export function getEmbeddedQueueWorkflowLabel(extraData: unknown): string | null {
  if (!extraData || typeof extraData !== 'object' || Array.isArray(extraData)) {
    return null;
  }

  const value = (extraData as Record<string, unknown>)[
    QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY
  ];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}
