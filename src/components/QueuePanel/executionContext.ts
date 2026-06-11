import type { Workflow } from '@/api/types';

interface ExecutionSnapshot {
  isExecuting: boolean;
  progress: number;
  executingPromptId: string | null;
  executingNodeId: string | null;
  executingNodePath: string | null;
  workflow: Workflow | null;
}

interface QueueExecutionState extends ExecutionSnapshot {
  activeSessionId: string | null;
  promptToSession: Record<string, string>;
  parkedSessions: Record<string, ExecutionSnapshot>;
}

export type QueueExecutionContext = ExecutionSnapshot;

export function resolveQueueExecutionContext(
  state: QueueExecutionState,
  runningPromptIds: Set<string>,
  fallbackExecutingId: string | null,
): QueueExecutionContext {
  let promptId =
    state.executingPromptId && runningPromptIds.has(state.executingPromptId)
      ? state.executingPromptId
      : fallbackExecutingId;
  let sessionId = promptId ? state.promptToSession[promptId] : null;

  if (!sessionId) {
    for (const [candidateSessionId, snapshot] of Object.entries(state.parkedSessions)) {
      if (snapshot.executingPromptId && runningPromptIds.has(snapshot.executingPromptId)) {
        promptId = snapshot.executingPromptId;
        sessionId = candidateSessionId;
        break;
      }
    }
  }

  if (sessionId && sessionId !== state.activeSessionId) {
    const snapshot = state.parkedSessions[sessionId];
    if (snapshot) {
      return {
        isExecuting: snapshot.isExecuting,
        progress: snapshot.progress,
        executingPromptId: snapshot.executingPromptId ?? promptId,
        executingNodeId: snapshot.executingNodeId,
        executingNodePath: snapshot.executingNodePath,
        workflow: snapshot.workflow,
      };
    }
  }

  return {
    isExecuting: state.isExecuting,
    progress: state.progress,
    executingPromptId: promptId,
    executingNodeId: state.executingNodeId,
    executingNodePath: state.executingNodePath,
    workflow: state.workflow,
  };
}
