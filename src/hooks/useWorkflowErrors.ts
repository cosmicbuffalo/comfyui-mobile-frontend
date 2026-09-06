import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { t } from '@/i18n';

export interface NodeError {
  type: string;
  message: string;
  details: string;
  inputName?: string;
}

/**
 * What kind of failure `error` describes. Carried explicitly so the UI can pick
 * a title without pattern-matching the message — the message is translated, and
 * word order differs by locale (in ja/ko the reconnect notice leads with the
 * duration, so a prefix test against the translated title fails).
 */
export type WorkflowErrorKind = 'workflow-load' | 'backend-connection' | 'prompt';

interface WorkflowErrorsState {
  error: string | null;
  errorKind: WorkflowErrorKind | null;
  nodeErrors: Record<string, NodeError[]>;
  /**
   * The same errors, re-keyed by the canonical hierarchical item key of the
   * node each one belongs to.
   *
   * `nodeErrors` is keyed the way ComfyUI reports them — by prompt id, which
   * for a node inside a subgraph is a hierarchical key like `57:3`, and for an
   * expanded instance may be a synthetic id that matches no node in the
   * canonical workflow at all. Every consumer looks nodes up by `node.id`, so
   * on any subgraph-based workflow (the stock templates are almost entirely one
   * big subgraph) nothing matched: no error badge on the card, and the toast's
   * "tap to view" found no node and silently did nothing. `applyNodeErrors`
   * already resolves these ids to item keys to unhide the offending node; this
   * keeps that resolution instead of throwing it away.
   */
  nodeErrorsByItemKey: Record<string, NodeError[]>;
  // Whether the current nodeErrors came from a queue/run attempt (ComfyUI
  // excluded a branch) rather than from loading a workflow. Run errors are
  // surfaced loudly on every panel; load errors only matter on the workflow
  // panel. Not persisted — a reload starts with no live run.
  nodeErrorsFromRun: boolean;
  errorCycleIndex: number;
  errorsDismissed: boolean;
  // Run errors for background (parked) workflow tabs, keyed by session id. The
  // active tab uses the global `error` above; a parked tab's error is stashed
  // here instead so it doesn't hijack the foreground — it surfaces a warning
  // marker on that tab and is promoted to `error` when the user enters the tab.
  sessionErrors: Record<string, string>;
  setError: (message: string | null, kind?: WorkflowErrorKind) => void;
  setNodeErrors: (
    errors: Record<string, NodeError[]>,
    fromRun?: boolean,
    byItemKey?: Record<string, NodeError[]>,
  ) => void;
  clearNodeErrors: () => void;
  clearNodeError: (nodeId: number, itemKey?: string) => void;
  setErrorCycleIndex: (index: number) => void;
  setErrorsDismissed: (dismissed: boolean) => void;
  setSessionError: (sessionId: string, message: string) => void;
  clearSessionError: (sessionId: string) => void;
}

export const useWorkflowErrorsStore = create<WorkflowErrorsState>()(
  persist(
    (set) => ({
      error: null,
      errorKind: null,
      nodeErrors: {},
      nodeErrorsByItemKey: {},
      nodeErrorsFromRun: false,
      errorCycleIndex: 0,
      errorsDismissed: false,
      sessionErrors: {},
      setError: (message, kind) => {
        set({
          error: message,
          errorKind: message === null ? null : (kind ?? 'prompt'),
          errorsDismissed: false,
        });
      },
      setNodeErrors: (errors, fromRun = false, byItemKey = {}) => {
        set({
          nodeErrors: errors,
          nodeErrorsByItemKey: byItemKey,
          nodeErrorsFromRun: fromRun,
          errorCycleIndex: 0,
          errorsDismissed: false,
        });
      },
      clearNodeErrors: () => {
        set({ error: null, errorKind: null, nodeErrors: {}, nodeErrorsByItemKey: {}, nodeErrorsFromRun: false, errorCycleIndex: 0, errorsDismissed: false });
      },
      clearNodeError: (nodeId, itemKey) => {
        set((state) => {
          const next = { ...state.nodeErrors };
          delete next[String(nodeId)];
          const nextByItemKey = { ...state.nodeErrorsByItemKey };
          if (itemKey) delete nextByItemKey[itemKey];
          const remainingErrorCount = Object.values(next).reduce(
            (total, errors) => total + errors.length,
            0,
          );

          // A workflow-load message is only an aggregate description of the
          // node errors below it. Keep that description in sync as the user
          // fixes nodes, and remove it with the final error so the toast closes
          // without requiring an explicit dismissal.
          if (state.errorKind === 'workflow-load') {
            if (remainingErrorCount === 0) {
              return {
                error: null,
                errorKind: null,
                nodeErrors: next,
                nodeErrorsByItemKey: nextByItemKey,
                nodeErrorsFromRun: false,
                errorCycleIndex: 0,
              };
            }
            return {
              error: remainingErrorCount === 1
                ? t('Workflow load error: {count} input references missing options.', { count: remainingErrorCount })
                : t('Workflow load error: {count} inputs reference missing options.', { count: remainingErrorCount }),
              nodeErrors: next,
              nodeErrorsByItemKey: nextByItemKey,
            };
          }

          return { nodeErrors: next, nodeErrorsByItemKey: nextByItemKey };
        });
      },
      setErrorCycleIndex: (index) => {
        set({ errorCycleIndex: index });
      },
      setErrorsDismissed: (dismissed) => {
        set({ errorsDismissed: dismissed });
      },
      setSessionError: (sessionId, message) => {
        set((state) => ({
          sessionErrors: { ...state.sessionErrors, [sessionId]: message },
        }));
      },
      clearSessionError: (sessionId) => {
        set((state) => {
          if (!(sessionId in state.sessionErrors)) return state;
          const next = { ...state.sessionErrors };
          delete next[sessionId];
          return { sessionErrors: next };
        });
      },
    }),
    {
      name: 'workflow-errors-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        error: state.error,
        errorKind: state.errorKind,
        nodeErrors: state.nodeErrors,
        nodeErrorsByItemKey: state.nodeErrorsByItemKey,
        errorCycleIndex: state.errorCycleIndex,
        errorsDismissed: state.errorsDismissed,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const errorCount = Object.values(state.nodeErrors || {}).reduce(
          (total, errors) => total + errors.length,
          0
        );
        if (errorCount > 0 && !state.error) {
          state.setError(
            errorCount === 1
              ? t('Workflow load error: {count} input references missing options.', { count: errorCount })
              : t('Workflow load error: {count} inputs reference missing options.', { count: errorCount }),
            'workflow-load',
          );
        }
        if (errorCount > 0) {
          state.setErrorCycleIndex(0);
        }
      },
    }
  )
);
