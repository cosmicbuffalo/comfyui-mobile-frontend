import { describe, expect, it } from 'vitest';
import {
  resolveWorkflowTabRunKey,
  shouldShowWorkflowTabActivity,
} from '../workflowTabActivity';

describe('shouldShowWorkflowTabActivity', () => {
  it('does not reserve an activity slot for idle tabs', () => {
    expect(shouldShowWorkflowTabActivity(false, 0)).toBe(false);
  });

  it('keeps the activity slot for queued and infinite tabs', () => {
    expect(shouldShowWorkflowTabActivity(false, 1)).toBe(true);
    expect(shouldShowWorkflowTabActivity(true, 0)).toBe(true);
  });
});

describe('resolveWorkflowTabRunKey', () => {
  it('ignores stale execution state from a parked workflow', () => {
    expect(resolveWorkflowTabRunKey({
      sessionId: 'parked',
      activeSessionId: 'active',
      sessionExecutingPromptId: 'old-prompt',
      runningPromptIds: ['current-prompt'],
      promptToSession: { 'current-prompt': 'active', 'old-prompt': 'parked' },
    })).toBeNull();
  });

  it('attributes a running prompt only to its owning workflow session', () => {
    const input = {
      activeSessionId: 'active',
      sessionExecutingPromptId: null,
      runningPromptIds: ['background-prompt'],
      promptToSession: { 'background-prompt': 'parked' },
    };

    expect(resolveWorkflowTabRunKey({ ...input, sessionId: 'active' })).toBeNull();
    expect(resolveWorkflowTabRunKey({ ...input, sessionId: 'parked' })).toBe(
      'background-prompt',
    );
  });
});
