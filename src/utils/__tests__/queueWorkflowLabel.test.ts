import { describe, expect, it } from 'vitest';
import {
  getEmbeddedQueueWorkflowLabel,
  QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY,
} from '../queueWorkflowLabel';

describe('queueWorkflowLabel', () => {
  it('trims a valid embedded workflow label', () => {
    expect(getEmbeddedQueueWorkflowLabel({
      [QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY]: '  Portrait Studio  ',
    })).toBe('Portrait Studio');
  });

  it('rejects empty and non-string labels', () => {
    expect(getEmbeddedQueueWorkflowLabel({
      [QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY]: '   ',
    })).toBeNull();
    expect(getEmbeddedQueueWorkflowLabel({
      [QUEUE_WORKFLOW_LABEL_EXTRA_DATA_KEY]: 42,
    })).toBeNull();
    expect(getEmbeddedQueueWorkflowLabel(null)).toBeNull();
  });
});
