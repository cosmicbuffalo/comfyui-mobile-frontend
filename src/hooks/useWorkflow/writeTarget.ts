import type { Workflow } from "@/api/types";
import { resolveNodeIdentityFromHierarchicalKey } from "@/utils/workflowHierarchy";
import type {
  WorkflowSessionSnapshot,
  WorkflowState,
} from "./state";

/**
 * Per-session write targeting: resolves whether a node-keyed write lands in a
 * parked session snapshot or the active flat fields, and applies the patch to
 * the right place. Extracted verbatim from the useWorkflow store body
 * (mirrors `./metadataNormalization`). All functions are pure w.r.t. `state`.
 */

      // Resolve which session a write targets. Returns null for the active
      // session (write flat fields), or the parked snapshot to mutate.
export const resolveWriteTarget = (
        state: WorkflowState,
        sessionId?: string | null,
      ): WorkflowSessionSnapshot | null => {
        if (
          !sessionId ||
          sessionId === state.activeSessionId ||
          !state.parkedSessions[sessionId]
        ) {
          return null;
        }
        return state.parkedSessions[sessionId];
      };

      // Merge a patch into a parked session snapshot, returning the state slice.
export const patchParkedSession = (
        state: WorkflowState,
        sid: string,
        patch: Partial<WorkflowSessionSnapshot>,
      ): Partial<WorkflowState> => ({
        parkedSessions: {
          ...state.parkedSessions,
          [sid]: { ...state.parkedSessions[sid], ...patch },
        },
      });

      // Resolve the write target (parked snapshot vs flat active state) along
      // with the workflow + pointer maps to use for node identity resolution.
export const resolveWriteContext = (
        state: WorkflowState,
        sessionId?: string | null,
      ): {
        parked: WorkflowSessionSnapshot | null;
        workflow: Workflow | null;
        pointers: Record<string, string>;
      } => {
        const parked = resolveWriteTarget(state, sessionId);
        return {
          parked,
          workflow: parked ? parked.workflow : state.workflow,
          pointers: parked
            ? parked.pointerByHierarchicalKey
            : state.pointerByHierarchicalKey,
        };
      };

      // Resolve a node identity from a hierarchical item key and write a single
      // node-keyed record field, routing to the parked snapshot or flat state.
      // Returns an empty slice when the identity can't be resolved.
export const writeNodeKeyedField = <
        F extends "nodeOutputs" | "nodeComparerOutputs" | "nodeTextOutputs",
      >(
        state: WorkflowState,
        sessionId: string | null | undefined,
        itemKey: string,
        field: F,
        value: WorkflowState[F][string],
      ): Partial<WorkflowState> => {
        const { parked, workflow, pointers } = resolveWriteContext(
          state,
          sessionId,
        );
        const identity = workflow
          ? resolveNodeIdentityFromHierarchicalKey(workflow, itemKey, pointers)
          : null;
        if (!identity) return {};
        const nodeId = String(identity.nodeId);
        if (parked) {
          return patchParkedSession(state, sessionId as string, {
            [field]: { ...parked[field], [nodeId]: value },
          } as Partial<WorkflowSessionSnapshot>);
        }
        return {
          [field]: { ...state[field], [nodeId]: value },
        } as Partial<WorkflowState>;
      };
