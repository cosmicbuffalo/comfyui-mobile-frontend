export function shouldShowWorkflowTabActivity(
  isInfinite: boolean,
  queuedCount: number,
): boolean {
  return isInfinite || queuedCount > 0;
}

export function resolveWorkflowTabRunKey({
  sessionId,
  activeSessionId,
  sessionExecutingPromptId,
  runningPromptIds,
  promptToSession,
}: {
  sessionId: string;
  activeSessionId: string | null;
  sessionExecutingPromptId: string | null;
  runningPromptIds: readonly string[];
  promptToSession: Record<string, string>;
}): string | null {
  if (sessionExecutingPromptId && runningPromptIds.includes(sessionExecutingPromptId)) {
    const owner = promptToSession[sessionExecutingPromptId];
    if (owner === sessionId || (!owner && sessionId === activeSessionId)) {
      return sessionExecutingPromptId;
    }
  }

  return runningPromptIds.find((promptId) => promptToSession[promptId] === sessionId) ?? null;
}
