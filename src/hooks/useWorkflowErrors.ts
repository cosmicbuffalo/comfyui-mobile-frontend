import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export interface NodeError {
  type: string;
  message: string;
  details: string;
  inputName?: string;
}

interface WorkflowErrorsState {
  error: string | null;
  nodeErrors: Record<string, NodeError[]>;
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
  setError: (message: string | null) => void;
  setNodeErrors: (errors: Record<string, NodeError[]>, fromRun?: boolean) => void;
  clearNodeErrors: () => void;
  clearNodeError: (nodeId: number) => void;
  setErrorCycleIndex: (index: number) => void;
  setErrorsDismissed: (dismissed: boolean) => void;
  setSessionError: (sessionId: string, message: string) => void;
  clearSessionError: (sessionId: string) => void;
}

export const useWorkflowErrorsStore = create<WorkflowErrorsState>()(
  persist(
    (set) => ({
      error: null,
      nodeErrors: {},
      nodeErrorsFromRun: false,
      errorCycleIndex: 0,
      errorsDismissed: false,
      sessionErrors: {},
      setError: (message) => {
        set({ error: message, errorsDismissed: false });
      },
      setNodeErrors: (errors, fromRun = false) => {
        set({ nodeErrors: errors, nodeErrorsFromRun: fromRun, errorCycleIndex: 0, errorsDismissed: false });
      },
      clearNodeErrors: () => {
        set({ error: null, nodeErrors: {}, nodeErrorsFromRun: false, errorCycleIndex: 0, errorsDismissed: false });
      },
      clearNodeError: (nodeId) => {
        set((state) => {
          const next = { ...state.nodeErrors };
          delete next[String(nodeId)];
          return { nodeErrors: next };
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
        nodeErrors: state.nodeErrors,
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
          state.setError(`Workflow load error: ${errorCount} input${errorCount === 1 ? '' : 's'} reference missing options.`);
        }
        if (errorCount > 0) {
          state.setErrorCycleIndex(0);
        }
      },
    }
  )
);
