import { useEffect, useRef, useState } from 'react';
import { connectWebSocket, clientId } from '@/api/client';
import { useWorkflowStore } from './useWorkflow';
import { useLoraManagerStore } from './useLoraManager';
import { useQueueStore } from './useQueue';
import { useHistoryStore } from './useHistory';
import { useWorkflowErrorsStore, type NodeError } from './useWorkflowErrors';
import { useGenerationSettingsStore } from './useGenerationSettings';
import { useConnectionStatusStore } from './useConnectionStatus';
import { useNavigationStore } from './useNavigation';
import { useOutputsStore } from './useOutputs';
import type { WSMessage, WSStatusMessage, WSProgressMessage, WSExecutingMessage, WSExecutedMessage, HistoryOutputImage } from '@/api/types';

// When a run finishes while the user is sitting on the Outputs panel, reload
// that view if any of the just-saved images belong to the folder/source being
// viewed — so new generations appear in place without a manual refresh.
function refreshOutputsPanelIfMatched(images: HistoryOutputImage[]): void {
  if (images.length === 0) return;
  if (useNavigationStore.getState().currentPanel !== 'outputs') return;
  const outputs = useOutputsStore.getState();
  const currentFolder = outputs.currentFolder ?? '';
  const matches = images.some(
    (img) => img.type === outputs.source && (img.subfolder ?? '') === currentFolder,
  );
  if (matches) outputs.refresh();
}

export function extractTextPreviewFromOutput(output: Record<string, unknown>): string | null {
  const preferredKeys = ['text', 'string', 'strings', 'result', 'value', '__value__', 'ui'];
  const mediaContainerKeys = new Set([
    'images',
    'image',
    'videos',
    'video',
    'gifs',
    'audio',
    'filename',
    'filenames',
    'subfolder',
    'type',
  ]);

  const findString = (
    value: unknown,
    depth: number,
    contextKey?: string
  ): string | null => {
    if (depth > 5 || value == null) return null;
    if (contextKey && mediaContainerKeys.has(contextKey)) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = findString(entry, depth + 1, contextKey);
        if (found) return found;
      }
      return null;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      for (const key of preferredKeys) {
        if (!(key in record)) continue;
        const found = findString(record[key], depth + 1, key);
        if (found) return found;
      }
    }
    return null;
  };

  return findString(output, 0);
}

// Only bother the user about a backend outage once it has lasted longer than
// this. Briefer blips (a quick restart, a momentary network hiccup) recover on
// their own and aren't worth a popup.
export const BACKEND_LOST_NOTICE_MIN_DOWNTIME_MS = 5000;

export function getBackendReconnectMessage(downtimeMs: number): string {
  const seconds = Math.max(1, Math.round(downtimeMs / 1000));
  const duration = seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `Backend connection restored after ${duration}. ComfyUI may have restarted; running jobs may have been interrupted.`;
}

// One tick of the 2s background poll. The poll is a backstop for missed
// websocket completion events, but `/history` carries every entry's embedded
// workflow, so re-pulling it every 2s for the whole duration of a run wastes
// bandwidth + main-thread parse time (visible as periodic queue jank on a long
// run). `fetchQueue` is cheap AND is what moves a finished prompt into
// `completing` / TTL-prunes a stuck card, so we always run it — but we only pull
// the heavy history payload when there's actually a finished prompt awaiting
// finalization. A still-running prompt stays in `running`, so the history fetch
// is skipped entirely until something completes. Exported for testing.
export async function runQueuePollTick(
  fetchQueue: () => Promise<void>,
  fetchHistory: () => Promise<void>,
): Promise<void> {
  const queueState = useQueueStore.getState();
  if (queueState.running.length === 0 && queueState.completing.length === 0) {
    return;
  }
  await fetchQueue();
  if (useQueueStore.getState().completing.length > 0) {
    await fetchHistory();
  }
}

function snapshotStoreActions() {
  return {
    setExecutionState: useWorkflowStore.getState().setExecutionState,
    setNodeOutput: useWorkflowStore.getState().setNodeOutput,
    setNodeComparerOutput: useWorkflowStore.getState().setNodeComparerOutput,
    setNodeTextOutput: useWorkflowStore.getState().setNodeTextOutput,
    clearNodeOutputs: useWorkflowStore.getState().clearNodeOutputs,
    setLatentPreview: useWorkflowStore.getState().setLatentPreview,
    clearAllLatentPreviews: useWorkflowStore.getState().clearAllLatentPreviews,
    addPromptOutputs: useWorkflowStore.getState().addPromptOutputs,
    clearPromptOutputs: useWorkflowStore.getState().clearPromptOutputs,
    applyControlAfterGenerate: useWorkflowStore.getState().applyControlAfterGenerate,
    applyLoraCodeUpdate: useLoraManagerStore.getState().applyLoraCodeUpdate,
    applyTriggerWordUpdate: useLoraManagerStore.getState().applyTriggerWordUpdate,
    applyWidgetUpdate: useLoraManagerStore.getState().applyWidgetUpdate,
    registerLoraManagerNodes: useLoraManagerStore.getState().registerLoraManagerNodes,
    updateFromStatus: useQueueStore.getState().updateFromStatus,
    fetchQueue: useQueueStore.getState().fetchQueue,
    addLivePromptOutputs: useQueueStore.getState().addLivePromptOutputs,
    clearLivePromptOutputs: useQueueStore.getState().clearLivePromptOutputs,
    markPromptCompleting: useQueueStore.getState().markPromptCompleting,
    removeRunning: useQueueStore.getState().removeRunning,
    fetchHistory: useHistoryStore.getState().fetchHistory,
  };
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [queueSynchronized, setQueueSynchronized] = useState(false);
  const infiniteLoopSessionId = useWorkflowStore((s) => s.infiniteLoopSessionId);
  const nodeTypesReady = useWorkflowStore((s) => Boolean(s.nodeTypes));
  const infiniteModeEnabled = useGenerationSettingsStore((s) => s.infiniteModeEnabled);
  const running = useQueueStore((s) => s.running);
  const pending = useQueueStore((s) => s.pending);
  const completing = useQueueStore((s) => s.completing);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOutputsRef = useRef<Record<string, HistoryOutputImage[]>>({});
  const hasConnectedRef = useRef(false);
  const reconnectingSinceRef = useRef<number | null>(null);
  const unmountingRef = useRef(false);
  const promptStartedAtRef = useRef<Record<string, number>>({});

  // Use refs for store actions to avoid recreating callbacks
  const storeActionsRef = useRef(snapshotStoreActions());

  // Re-snapshot once after mount. Zustand action identities are stable for the
  // store's lifetime, so this only guards the initial render's snapshot; it does
  // not (and need not) re-run when store state changes.
  useEffect(() => {
    storeActionsRef.current = snapshotStoreActions();
  }, []);

  // Mirror connection state into a global store so overlays/buttons elsewhere
  // can gate on it without consuming this hook's return value directly.
  useEffect(() => {
    useConnectionStatusStore.getState().setConnected(isConnected);
  }, [isConnected]);

  const lastPromptIdRef = useRef<string | null>(null);
  // The prompt_id currently executing, tracked from progress/executing events.
  // Binary preview frames carry no prompt_id, so this tells us which session's
  // node the preview belongs to (it may be a parked, non-active session).
  const executingPromptIdRef = useRef<string | null>(null);
  // Guards the infinite-loop re-enqueue against duplicate `executing(null)`
  // messages for the same finished prompt (which would double-submit).
  const lastReenqueuedPromptRef = useRef<string | null>(null);
  // Guards refresh/reconnect recovery while a newly-submitted prompt has not
  // appeared in ComfyUI's queue endpoint yet.
  const resumeAttemptedSessionRef = useRef<string | null>(null);
  // Caches the resolved canonical key/path for the node a `progress` event
  // targets. KSampler emits one progress event per step; the node only changes
  // between nodes, so caching avoids walking the workflow on every step.
  const progressNodeCacheRef = useRef<{
    key: string;
    hierarchicalKey: string | null;
    path: string | null;
  }>({ key: '', hierarchicalKey: null, path: null });

  useEffect(() => {
    unmountingRef.current = false;
    /** Maps a raw WS node ID (expanded numeric or hierarchical prompt key) to
     *  the canonical hierarchical key used by the store (e.g. "root/node:5" or
     *  "root/subgraph:{uuid}/node:10").
     *
     *  Two lookup paths:
     *  1. expandedNodeIdMap — populated when the mobile frontend queues a prompt.
     *  2. Direct match on workflow.nodes — fallback for prompts queued by the
     *     desktop frontend, where WS node IDs are root-level canonical IDs. */
    /** The session that owns an incoming message, plus the workflow + node-ID
     *  maps used to resolve its node references. Routes by prompt_id; falls back
     *  to the active session when the prompt is unknown (e.g. queued elsewhere). */
    type SessionContext = {
      sessionId: string | null;
      workflow: ReturnType<typeof useWorkflowStore.getState>['workflow'];
      expandedNodeIdMap: Record<string, string>;
      expandedNodePathMap: Record<string, string>;
      /** True when the prompt belongs to a tab that was closed mid-run. Its
       *  workflow no longer exists, so handlers must drop the run's
       *  workflow-routing rather than mis-apply it to the active tab. */
      orphaned: boolean;
    };

    const getSessionContext = (promptId: string | null | undefined): SessionContext => {
      const ws = useWorkflowStore.getState();
      const mapped = promptId ? ws.promptToSession[promptId] : undefined;
      if (mapped && mapped !== ws.activeSessionId) {
        const parked = ws.parkedSessions[mapped];
        if (parked) {
          return {
            sessionId: mapped,
            workflow: parked.workflow,
            expandedNodeIdMap: parked.expandedNodeIdMap,
            expandedNodePathMap: parked.expandedNodePathMap,
            orphaned: false,
          };
        }
        // Mapped to a session that is neither active nor parked → its tab was
        // closed mid-run. Flag it orphaned so the run's outputs / control-after-
        // generate / execution-state never land on the now-active tab. (A prompt
        // with NO mapping — e.g. queued from desktop ComfyUI — is not orphaned
        // and still falls back to the active tab below, as before.)
        return {
          sessionId: null,
          workflow: ws.workflow,
          expandedNodeIdMap: {},
          expandedNodePathMap: {},
          orphaned: true,
        };
      }
      return {
        sessionId: ws.activeSessionId,
        workflow: ws.workflow,
        expandedNodeIdMap: ws.expandedNodeIdMap,
        expandedNodePathMap: ws.expandedNodePathMap,
        orphaned: false,
      };
    };

    const resolveExecutionNodePath = (
      rawNodeId: number | string | null | undefined,
      ctx: SessionContext,
    ): string | null => {
      if (rawNodeId == null) return null;
      const idStr = String(rawNodeId).trim();
      if (!idStr) return null;
      return ctx.expandedNodePathMap[idStr] ?? idStr;
    };

    /** Maps a raw WS node ID to ALL matching canonical hierarchical keys. A
     *  single WS node ID may map to multiple keys (e.g. the same subgraph
     *  definition used more than once), so the `executed` handler needs them
     *  all. The mapped key (from a prompt this client queued) is listed first,
     *  so callers wanting a single key can take `[0]`. */
    const resolveNodeHierarchicalKeysForOutput = (
      rawNodeId: number | string | null | undefined,
      ctx: SessionContext,
    ): string[] => {
      if (rawNodeId == null) return [];
      const idStr = String(rawNodeId);
      const workflow = ctx.workflow;
      if (!workflow) return [];

      const keys = new Set<string>();

      const mappedKey = ctx.expandedNodeIdMap[idStr];
      if (mappedKey) keys.add(mappedKey);

      if (!idStr.includes(':')) {
        const numericNodeId = Number(idStr);
        if (Number.isFinite(numericNodeId)) {
          for (const node of workflow.nodes) {
            if (node.id === numericNodeId && node.itemKey) {
              keys.add(node.itemKey);
            }
          }
        }
      }

      return Array.from(keys);
    };

    /** Single canonical key for a raw WS node ID (the mapped key when present,
     *  else the first direct match). Used by progress/executing handlers. */
    const resolveNodeHierarchicalKey = (
      rawNodeId: number | string | null | undefined,
      ctx: SessionContext,
    ): string | null =>
      resolveNodeHierarchicalKeysForOutput(rawNodeId, ctx)[0] ?? null;

    const clearExecutionAfterBackendRestart = (preserveInfiniteLoop = false) => {
      executingPromptIdRef.current = null;
      lastPromptIdRef.current = null;
      lastReenqueuedPromptRef.current = null;
      progressNodeCacheRef.current = { key: '', hierarchicalKey: null, path: null };
      // A prompt interrupted by a backend restart never emits its terminal
      // executing(null)/execution_error frame, so its per-prompt buffers are
      // never deleted by the normal cleanup. Reset them here (recovery re-fetches
      // history/queue anyway) so they don't accumulate across repeated restarts.
      pendingOutputsRef.current = {};
      promptStartedAtRef.current = {};

      useWorkflowStore.setState((state) => ({
        isExecuting: false,
        executingNodeId: null,
        executingNodeHierarchicalKey: null,
        executingNodePath: null,
        executingPromptId: null,
        progress: 0,
        executionStartTime: null,
        currentNodeStartTime: null,
        isStopping: false,
        infiniteLoop:
          preserveInfiniteLoop &&
          state.infiniteLoopSessionId === state.activeSessionId,
        infiniteLoopSessionId: preserveInfiniteLoop
          ? state.infiniteLoopSessionId
          : null,
        parkedSessions: Object.fromEntries(
          Object.entries(state.parkedSessions).map(([sessionId, snapshot]) => [
            sessionId,
            {
              ...snapshot,
              isExecuting: false,
              executingNodeId: null,
              executingNodeHierarchicalKey: null,
              executingNodePath: null,
              executingPromptId: null,
              progress: 0,
              executionStartTime: null,
              currentNodeStartTime: null,
              isStopping: false,
            },
          ]),
        ),
      }));
      storeActionsRef.current.clearAllLatentPreviews();
    };

    const handleMessage = (data: unknown) => {
      const {
        setExecutionState,
        setNodeOutput,
        setNodeComparerOutput,
        setNodeTextOutput,
        addPromptOutputs,
        clearPromptOutputs,
        updateFromStatus,
        fetchQueue,
        addLivePromptOutputs,
        clearLivePromptOutputs,
        markPromptCompleting,
        removeRunning,
        fetchHistory,
        applyLoraCodeUpdate,
        applyTriggerWordUpdate,
        applyWidgetUpdate,
        registerLoraManagerNodes
      } = storeActionsRef.current;
      const msg = data as WSMessage;
      const asText = (value: unknown): string | null =>
        typeof value === 'string' ? value.trim() : null;
      const asRecord = (value: unknown): Record<string, unknown> | null =>
        typeof value === 'object' && value !== null && !Array.isArray(value)
          ? value as Record<string, unknown>
          : null;
      const asNodeId = (value: unknown): string | null => {
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
        return null;
      };

      switch (msg.type) {
        case 'status': {
          const statusMsg = msg as WSStatusMessage;
          const queueRemaining = statusMsg.data.status.exec_info.queue_remaining;
          updateFromStatus(queueRemaining);

          // `queue_remaining` counts only PENDING items — it hits 0 the moment
          // the last queued prompt STARTS running, so it is not a reliable
          // "everything finished" signal. The authoritative finish signal is
          // `executing` with node===null. Only treat the queue as idle here
          // when nothing is running either, to avoid clearing execution state
          // and latent previews mid-run.
          if (queueRemaining === 0 && useQueueStore.getState().running.length === 0) {
            // Global queue empty → nothing executing in ANY session. Clear the
            // active session's execution state plus every parked session's.
            const ws = useWorkflowStore.getState();
            setExecutionState(false, null, null, 0);
            for (const sid of Object.keys(ws.parkedSessions)) {
              setExecutionState(false, null, null, 0, null, sid);
            }
            storeActionsRef.current.clearAllLatentPreviews();
          }
          break;
        }

        case 'progress': {
          const progressMsg = msg as WSProgressMessage;
          const { value, max, node, prompt_id } = progressMsg.data;
          const progress = Math.round((value / max) * 100);
          const ctx = getSessionContext(prompt_id);
          // Owning tab was closed mid-run: don't drive any visible tab's
          // executing-node display from this orphaned run's progress.
          if (ctx.orphaned) break;
          if (prompt_id && promptStartedAtRef.current[prompt_id] === undefined) {
            promptStartedAtRef.current[prompt_id] = Date.now();
          }
          executingPromptIdRef.current = prompt_id || executingPromptIdRef.current;
          const cacheKey = `${ctx.sessionId ?? ''}|${node ?? ''}`;
          if (progressNodeCacheRef.current.key !== cacheKey) {
            progressNodeCacheRef.current = {
              key: cacheKey,
              hierarchicalKey: resolveNodeHierarchicalKey(node, ctx),
              path: resolveExecutionNodePath(node, ctx),
            };
          }
          setExecutionState(
            true,
            progressNodeCacheRef.current.hierarchicalKey,
            prompt_id || null,
            progress,
            progressNodeCacheRef.current.path,
            ctx.sessionId,
          );
          break;
        }

        case 'executing': {
          const execMsg = msg as WSExecutingMessage;
          const nodeId = execMsg.data.node;
          const promptId = execMsg.data.prompt_id;
          const ctx = getSessionContext(promptId);

          if (ctx.orphaned) {
            // The owning tab was closed mid-run. Don't route execution state to
            // any visible workflow; on completion just clean up refs and let the
            // global queue/history re-sync drop its card and surface its outputs
            // in the Outputs panel. A node-start frame is simply ignored.
            if (nodeId === null && promptId) {
              delete promptStartedAtRef.current[promptId];
              delete pendingOutputsRef.current[promptId];
              clearLivePromptOutputs(promptId);
              removeRunning(promptId);
              if (executingPromptIdRef.current === promptId) {
                executingPromptIdRef.current = null;
              }
              fetchQueue();
              fetchHistory();
            }
            break;
          }

          if (nodeId === null) {
            // Execution finished for this prompt's session.
            const startedAt = promptId ? promptStartedAtRef.current[promptId] : undefined;
            const durationSeconds = startedAt === undefined
              ? undefined
              : Math.max(0, (Date.now() - startedAt) / 1000);
            if (promptId) delete promptStartedAtRef.current[promptId];
            executingPromptIdRef.current = null;
            setExecutionState(false, null, null, 0, null, ctx.sessionId);
            if (ctx.sessionId === useWorkflowStore.getState().activeSessionId) {
              storeActionsRef.current.clearAllLatentPreviews();
            }

            // Apply control_after_generate for PrimitiveNodes
            storeActionsRef.current.applyControlAfterGenerate(ctx.sessionId);

            if (promptId) {
              // Keep the same running card and live media mounted until the
              // authoritative history record arrives. markPromptCompleted
              // performs the cleanup during that final handoff.
              markPromptCompleting(promptId, durationSeconds);
              // Drop it from `running` now so the progress overlays (keyed on
              // runKey = executingPromptId || running[0]) dismiss on this event
              // rather than waiting on the fetchQueue below, which can race the
              // backend still reporting the prompt as running.
              removeRunning(promptId);
              // Capture this run's saved outputs before clearing, so the Outputs
              // panel can refresh in place if they landed in the viewed folder.
              const completedOutputs = pendingOutputsRef.current[promptId] ?? [];
              delete pendingOutputsRef.current[promptId];
              clearPromptOutputs(promptId, ctx.sessionId);
              refreshOutputsPanelIfMatched(completedOutputs);
            }

            // Infinite-loop driver: re-enqueue the owning session iff it is the
            // single looping session, infinite mode is on globally, no error, a
            // submit isn't already in flight, and we haven't already re-enqueued
            // for this exact prompt (guards duplicate `executing(null)` frames).
            const ws = useWorkflowStore.getState();
            const sid = ctx.sessionId;
            const infiniteOn =
              useGenerationSettingsStore.getState().infiniteModeEnabled;
            if (
              sid &&
              promptId &&
              promptId !== lastReenqueuedPromptRef.current &&
              ws.infiniteLoopSessionId === sid &&
              infiniteOn &&
              !ws.isStopping &&
              !ws.isLoadingBySession[sid] &&
              !useWorkflowErrorsStore.getState().error
            ) {
              lastReenqueuedPromptRef.current = promptId;
              ws.queueWorkflow(1, sid, true);
            }

            fetchQueue(); // Refresh queue state
            fetchHistory();
          } else {
            // Track new prompt without clearing existing outputs to avoid layout shift.
            if (promptId && promptId !== lastPromptIdRef.current) {
              lastPromptIdRef.current = promptId;
            }
            if (promptId && promptStartedAtRef.current[promptId] === undefined) {
              promptStartedAtRef.current[promptId] = Date.now();
            }
            executingPromptIdRef.current = promptId || null;

            // Execution started/is continuing for a node
            setExecutionState(
              true,
              resolveNodeHierarchicalKey(nodeId, ctx),
              promptId || null,
              0,
              resolveExecutionNodePath(nodeId, ctx),
              ctx.sessionId,
            );
            // Sync queue if we don't see this prompt_id as running yet
            const queueStore = useQueueStore.getState();
            if (promptId && !queueStore.running.some(r => r.prompt_id === promptId)) {
              fetchQueue();
            }
          }
          break;
        }

        case 'executed': {
          const executedMsg = msg as WSExecutedMessage;
          const { node, prompt_id, output } = executedMsg.data;
          const ctx = getSessionContext(prompt_id);
          // Owning tab was closed mid-run: don't paint this run's outputs onto
          // the now-active tab's nodes. The results are still written to disk by
          // the backend and appear in the Outputs panel via the history fetch.
          if (ctx.orphaned) break;
          const itemKeysForOutput = resolveNodeHierarchicalKeysForOutput(node, ctx);
          const mediaOutputs = [
            ...(output.images ?? []),
            ...(output.gifs ?? []),
            ...(output.videos ?? []),
          ];
          if (mediaOutputs.length > 0) {
             // Store for history
             if (!pendingOutputsRef.current[prompt_id]) {
               pendingOutputsRef.current[prompt_id] = [];
             }
             pendingOutputsRef.current[prompt_id].push(...mediaOutputs);
             addLivePromptOutputs(prompt_id, mediaOutputs);
             addPromptOutputs(prompt_id, mediaOutputs, ctx.sessionId);

             // Store for node display
             itemKeysForOutput.forEach((key) => {
               setNodeOutput(key, mediaOutputs, ctx.sessionId);
             });
          }
          // Image Comparer (rgthree) emits its two sides as a_images / b_images
          // rather than `images`, so capture them into the comparer store.
          const comparerA = output.a_images ?? [];
          const comparerB = output.b_images ?? [];
          if (comparerA.length > 0 || comparerB.length > 0) {
            itemKeysForOutput.forEach((key) => {
              setNodeComparerOutput(key, { a: comparerA, b: comparerB }, ctx.sessionId);
            });
          }
          const textPreview = extractTextPreviewFromOutput(output as Record<string, unknown>);
          if (textPreview && itemKeysForOutput.length > 0) {
            itemKeysForOutput.forEach((key) => {
              setNodeTextOutput(key, textPreview, ctx.sessionId);
            });
          }
          break;
        }

        case 'execution_error': {
          const errorData = (msg as WSMessage).data as Record<string, unknown>;
          const errorRecord = asRecord(errorData);
          const errorObject = asRecord(errorRecord?.error);
          const promptId = asText(errorData.prompt_id);
          const nodeId = asNodeId(errorData.node);
          const nodeType = asText(errorData.node_type);
          const message = asText(errorData.exception_message)
            || asText(errorData.msg)
            || asText(errorData.error)
            || asText(errorObject?.message)
            || 'Execution failed';
          const details = asText(errorData.exception_type)
            || asText(errorData.traceback)
            || asText(errorObject?.details)
            || '';
          const fullMessage = nodeId
            ? `${message}${nodeType ? ` (${nodeType})` : ''} for node ${nodeId}`
            : message;

          const errCtx = getSessionContext(promptId);
          // Owning tab was closed mid-run: don't raise this run's error on the
          // foreground (or any) tab. Just clean up refs and re-sync the queue.
          if (errCtx.orphaned) {
            if (promptId) {
              delete promptStartedAtRef.current[promptId];
              delete pendingOutputsRef.current[promptId];
              clearLivePromptOutputs(promptId);
              removeRunning(promptId);
              if (executingPromptIdRef.current === promptId) {
                executingPromptIdRef.current = null;
              }
            }
            fetchQueue();
            fetchHistory();
            break;
          }
          const errorText = `${fullMessage}${details ? `\n${details}` : ''}`;
          const activeSessionId = useWorkflowStore.getState().activeSessionId;
          // A background (parked) tab's run error must not hijack the foreground:
          // don't set the global banner (which would also stall the active tab's
          // infinite loop / block Run). Stash it against that session instead — the
          // tab shows a warning marker and the error surfaces when it's entered.
          // No session id (e.g. a prompt queued from desktop ComfyUI) falls back to
          // the active tab, matching the rest of this handler.
          const erroredInBackground = Boolean(
            errCtx.sessionId && errCtx.sessionId !== activeSessionId,
          );
          if (erroredInBackground) {
            useWorkflowErrorsStore.getState().setSessionError(errCtx.sessionId!, errorText);
          } else {
            useWorkflowErrorsStore.getState().setError(errorText);
            if (nodeId) {
              const nodeErrors: Record<string, NodeError[]> = {
                [nodeId]: [
                  {
                    type: 'execution_error',
                    message,
                    details,
                    inputName: undefined
                  },
                ],
              };
              useWorkflowErrorsStore.getState().setNodeErrors(nodeErrors);
            }
          }
          console.error('Execution error:', {
            promptId,
            nodeId,
            nodeType,
            message,
            details,
          });

          if (promptId) delete promptStartedAtRef.current[promptId];
          executingPromptIdRef.current = null;
          setExecutionState(false, null, null, 0, null, errCtx.sessionId);
          // Latent previews only ever exist for the active tab, so only clear
          // them when the active tab is the one that errored — a background
          // (parked) session's error must not wipe the foreground run's preview.
          if (errCtx.sessionId === useWorkflowStore.getState().activeSessionId) {
            storeActionsRef.current.clearAllLatentPreviews();
          }
          // Only clear the errored prompt's outputs. A prompt-id-less error must
          // NOT fall through to the wipe-all branch — that would destroy output
          // routing (promptToSession) for every other open tab.
          if (promptId) {
            clearPromptOutputs(promptId, errCtx.sessionId);
            clearLivePromptOutputs(promptId);
            // Mirror the execution-finished path: drop the buffered outputs and
            // the running entry for the errored prompt. Without the delete here,
            // every errored prompt leaks a pendingOutputsRef entry for the session.
            delete pendingOutputsRef.current[promptId];
            removeRunning(promptId);
          }
          // An errored session must not keep auto-re-enqueueing.
          if (
            errCtx.sessionId &&
            useWorkflowStore.getState().infiniteLoopSessionId === errCtx.sessionId
          ) {
            useWorkflowStore.setState({ infiniteLoopSessionId: null, infiniteLoop: false });
          }
          fetchQueue();
          fetchHistory();
          break;
        }

        case 'execution_cached': {
          // Node was cached, no need to run
          break;
        }

        case 'lora_code_update': {
          applyLoraCodeUpdate?.(msg.data);
          break;
        }

        case 'trigger_word_update': {
          applyTriggerWordUpdate?.(msg.data);
          break;
        }

        case 'lm_widget_update': {
          applyWidgetUpdate?.(msg.data);
          break;
        }

        case 'lora_registry_refresh': {
          registerLoraManagerNodes?.();
          break;
        }

        case 'cm-queue-status': {
          window.dispatchEvent(new CustomEvent('comfy-mobile-manager-queue-status', {
            detail: msg.data,
          }));
          break;
        }
      }
    };

    // Binary preview frames carry no usable node ID (type 1 frames carry none;
    // type 4 metadata IDs are unreliable for subgraph inner nodes), so we use
    // the executing node tracked from progress/executing events. Latent previews
    // live in the ACTIVE session's flat field, so only surface a preview when
    // the executing session is the active one — otherwise a background (parked)
    // session's preview would attach to the foreground workflow's node.
    const resolvePreviewItemKey = (): string | null => {
      const ws = useWorkflowStore.getState();
      const execPromptId = executingPromptIdRef.current;
      // Binary preview frames carry no prompt_id, so we route by the last
      // executing prompt. Attach the preview only when that prompt is NOT owned
      // by a parked tab — otherwise a background run's latent would paint on the
      // foreground node. With no executing prompt at all, drop the frame rather
      // than fall back to the active tab (which caused the cross-tab leak).
      if (!execPromptId) return null;
      const sid = ws.promptToSession[execPromptId];
      if (sid && sid !== ws.activeSessionId) return null;
      // NOTE (intentionally deferred — LOW): an unmapped prompt (sid undefined,
      // e.g. queued from desktop ComfyUI) falls through here and attaches to the
      // active tab's executing node, whose ids won't generally match — best-effort
      // routing. Left as-is; tightening it would also drop legit active-tab
      // previews for desktop-queued runs that happen to share the workflow.
      return ws.executingNodeHierarchicalKey;
    };

    const handleBinaryMessage = (data: ArrayBuffer) => {
      if (data.byteLength < 8) return;

      const view = new DataView(data);
      const type = view.getUint32(0, false); // big-endian

      if (type === 1) {
        // Legacy: [type(4B)][imageType(4B)][imageData]
        const imageType = view.getUint32(4, false);
        const mime = imageType === 2 ? 'image/png' : 'image/jpeg';
        const imageData = data.slice(8);
        const blob = new Blob([imageData], { type: mime });
        const url = URL.createObjectURL(blob);
        const itemKey = resolvePreviewItemKey();
        if (!itemKey) { URL.revokeObjectURL(url); return; }
        storeActionsRef.current.setLatentPreview(url, itemKey);
      } else if (type === 4) {
        // Modern: [type(4B)][jsonLen(4B)][JSON metadata][imageData]
        try {
          const jsonLen = view.getUint32(4, false);
          const imageData = data.slice(8 + jsonLen);
          const header = new Uint8Array(imageData.slice(0, 4));
          const mime = (header[0] === 0x89 && header[1] === 0x50) ? 'image/png' : 'image/jpeg';
          const blob = new Blob([imageData], { type: mime });
          const url = URL.createObjectURL(blob);
          const itemKey = resolvePreviewItemKey();
          if (!itemKey) { URL.revokeObjectURL(url); return; }
          storeActionsRef.current.setLatentPreview(url, itemKey);
        } catch (e) {
          console.error('[WS] Failed to parse binary type 4 message:', e);
        }
      }
    };

    const connect = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        return;
      }

      wsRef.current = connectWebSocket(
        clientId,
        handleMessage,
        async () => {
          setIsConnected(true);
          setQueueSynchronized(false);
          resumeAttemptedSessionRef.current = null;
          hasConnectedRef.current = true;
          const reconnectedAfterMs = reconnectingSinceRef.current === null
            ? null
            : Date.now() - reconnectingSinceRef.current;
          reconnectingSinceRef.current = null;
          const { fetchQueue, fetchHistory, setExecutionState } = storeActionsRef.current;
          await fetchQueue();
          await fetchHistory();

          // Sync execution state from queue after reconnect/refresh
          const queueState = useQueueStore.getState();
          const workflowState = useWorkflowStore.getState();
          if (queueState.running.length > 0) {
            const runningItem = queueState.running[0];
            const sessionId =
              workflowState.promptToSession[runningItem.prompt_id] ??
              workflowState.activeSessionId;
            const targetExecutingPromptId =
              sessionId && sessionId !== workflowState.activeSessionId
                ? workflowState.parkedSessions[sessionId]?.executingPromptId
                : workflowState.executingPromptId;
            if (targetExecutingPromptId !== runningItem.prompt_id) {
              // There's a running item but we don't have matching execution state - restore it
              setExecutionState(true, null, runningItem.prompt_id, 0, null, sessionId);
            }
          } else {
            const loopOwner = workflowState.infiniteLoopSessionId;
            const loopOwnerExists = Boolean(
              loopOwner &&
              (
                loopOwner === workflowState.activeSessionId ||
                workflowState.parkedSessions[loopOwner]
              ),
            );
            clearExecutionAfterBackendRestart(
              loopOwnerExists &&
              useGenerationSettingsStore.getState().infiniteModeEnabled,
            );
          }

          const completedPromptIds = useHistoryStore
            .getState()
            .history
            .map((entry) => entry.prompt_id);
          const recoverableJobIds = useQueueStore
            .getState()
            .detectRecoverableJobs(completedPromptIds);

          // Only surface the disruption popup when the outage was long enough to
          // matter AND it actually cost us queued work. Brief blips, or
          // disconnects where the backend kept our queue intact, stay silent —
          // the QueuePanel banner still flags any lost jobs on its own.
          if (
            reconnectedAfterMs !== null &&
            reconnectedAfterMs >= BACKEND_LOST_NOTICE_MIN_DOWNTIME_MS &&
            recoverableJobIds.length > 0
          ) {
            useWorkflowErrorsStore
              .getState()
              .setError(getBackendReconnectMessage(reconnectedAfterMs));
          }
          if (
            recoverableJobIds.length > 0 &&
            useGenerationSettingsStore.getState().autoRestoreLostQueueJobs
          ) {
            try {
              await useQueueStore.getState().restoreLostJobs({
                auto: true,
                onRestored: ({ oldPromptId, newPromptId, job }) => {
                  const sessionId =
                    job.sessionId ??
                    useWorkflowStore.getState().promptToSession[oldPromptId];
                  if (!sessionId) return;
                  useWorkflowStore.setState((state) => ({
                    promptToSession: {
                      ...state.promptToSession,
                      [newPromptId]: sessionId,
                    },
                  }));
                },
              });
            } catch (err) {
              useWorkflowErrorsStore
                .getState()
                .setError(err instanceof Error ? err.message : 'Failed to restore lost queued jobs.');
            }
          }
          setQueueSynchronized(true);
        },
        () => {
          setIsConnected(false);
          setQueueSynchronized(false);
          resumeAttemptedSessionRef.current = null;
          // NOTE (intentionally deferred — LOW): under React StrictMode in dev,
          // the mount→unmount→remount cycle resets `unmountingRef` before this
          // closed socket's async onclose fires, so the first socket can still
          // schedule a reconnect (a brief dev-only double-connect). Production
          // single-mount is unaffected, so this is left as-is. A proper fix would
          // track disposal per-socket instead of via the shared ref.
          if (unmountingRef.current) return;
          // Record when the outage started so we can measure downtime on
          // reconnect, but stay quiet for now: whether this disruption deserves a
          // popup depends on how long it lasts and whether it actually lost
          // queued jobs — neither of which we know until we're back.
          if (hasConnectedRef.current && reconnectingSinceRef.current === null) {
            reconnectingSinceRef.current = Date.now();
          }
          reconnectTimeoutRef.current = setTimeout(connect, 2000);
        },
        () => {
          setIsConnected(false);
        },
        handleBinaryMessage,
      );
    };

    connect();
    const pollInterval = setInterval(() => {
      const { fetchQueue, fetchHistory } = storeActionsRef.current;
      void runQueuePollTick(fetchQueue, fetchHistory);
    }, 2000);

    return () => {
      unmountingRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      clearInterval(pollInterval);
    };
  }, []); // Empty dependency array - only run once on mount

  useEffect(() => {
    if (
      !isConnected ||
      !queueSynchronized ||
      !infiniteModeEnabled ||
      !infiniteLoopSessionId ||
      !nodeTypesReady
    ) {
      return;
    }

    const workflowState = useWorkflowStore.getState();
    const ownerExists =
      infiniteLoopSessionId === workflowState.activeSessionId ||
      Boolean(workflowState.parkedSessions[infiniteLoopSessionId]);
    if (!ownerExists) {
      useWorkflowStore.setState({
        infiniteLoop: false,
        infiniteLoopSessionId: null,
      });
      return;
    }
    if (
      workflowState.isStopping ||
      workflowState.isLoadingBySession[infiniteLoopSessionId] ||
      useWorkflowErrorsStore.getState().error
    ) {
      return;
    }

    const ownsPrompt = (promptId: string) =>
      workflowState.promptToSession[promptId] === infiniteLoopSessionId;
    const hasLivePrompt = [...running, ...pending, ...completing].some((item) =>
      ownsPrompt(item.prompt_id),
    );
    if (hasLivePrompt) {
      if (resumeAttemptedSessionRef.current === infiniteLoopSessionId) {
        resumeAttemptedSessionRef.current = null;
      }
      // A run is live, so the loop is genuinely active now — clear the
      // arm-without-run guard so the idle-resume backup can act again.
      if (workflowState.infiniteLoopAwaitingRun) {
        useWorkflowStore.setState({ infiniteLoopAwaitingRun: false });
      }
      return;
    }
    // Infinite mode was armed via the toggle but no run has started yet.
    // Arming must not auto-start generation — the user starts it with Run. The
    // flag is persisted alongside infiniteLoopSessionId and survives tab
    // switches, so this holds across reloads too; reload-resume of an
    // already-running loop still works because the flag was already cleared
    // when the loop's first run was queued.
    if (workflowState.infiniteLoopAwaitingRun) return;
    if (resumeAttemptedSessionRef.current === infiniteLoopSessionId) return;

    resumeAttemptedSessionRef.current = infiniteLoopSessionId;
    void workflowState.queueWorkflow(1, infiniteLoopSessionId, true);
  }, [
    completing,
    infiniteLoopSessionId,
    infiniteModeEnabled,
    isConnected,
    nodeTypesReady,
    pending,
    queueSynchronized,
    running,
  ]);

  return { isConnected };
}
