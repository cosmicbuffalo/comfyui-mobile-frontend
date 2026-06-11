import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/api/types';
import { resolveQueueExecutionContext } from '../executionContext';

const workflow = (id: number): Workflow => ({
  last_node_id: id,
  last_link_id: 0,
  nodes: [],
  links: [],
  groups: [],
  config: {},
  version: 1,
});

describe('resolveQueueExecutionContext', () => {
  it('uses the parked workflow session that owns the running prompt', () => {
    const activeWorkflow = workflow(1);
    const parkedWorkflow = workflow(99);

    const context = resolveQueueExecutionContext(
      {
        activeSessionId: 'active',
        promptToSession: { 'prompt-parked': 'parked' },
        parkedSessions: {
          parked: {
            isExecuting: true,
            progress: 47,
            executingPromptId: 'prompt-parked',
            executingNodeId: '99',
            executingNodePath: '5:99',
            workflow: parkedWorkflow,
          },
        },
        isExecuting: false,
        progress: 0,
        executingPromptId: null,
        executingNodeId: null,
        executingNodePath: null,
        workflow: activeWorkflow,
      },
      new Set(['prompt-parked']),
      'prompt-parked',
    );

    expect(context).toEqual({
      isExecuting: true,
      progress: 47,
      executingPromptId: 'prompt-parked',
      executingNodeId: '99',
      executingNodePath: '5:99',
      workflow: parkedWorkflow,
    });
  });

  it('falls back to the active workflow when the prompt has no parked owner', () => {
    const activeWorkflow = workflow(1);

    const context = resolveQueueExecutionContext(
      {
        activeSessionId: 'active',
        promptToSession: {},
        parkedSessions: {},
        isExecuting: true,
        progress: 12,
        executingPromptId: 'prompt-active',
        executingNodeId: '1',
        executingNodePath: '1',
        workflow: activeWorkflow,
      },
      new Set(['prompt-active']),
      'prompt-active',
    );

    expect(context).toEqual({
      isExecuting: true,
      progress: 12,
      executingPromptId: 'prompt-active',
      executingNodeId: '1',
      executingNodePath: '1',
      workflow: activeWorkflow,
    });
  });
});
