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
import { applyImpactNodeFeedback, parseImpactNodeFeedback } from '@/utils/impactNodeFeedback';
import { appendOasisPreviewResults } from '@/utils/nodeFrontendPreviews';
import type { WSMessage, WSStatusMessage, WSProgressMessage, WSExecutingMessage, WSExecutedMessage, HistoryOutputImage } from '@/api/types';
import {
  extractTextPreviewFromOutput,
  collectExecutedMediaOutputs,
  collectDenoVideoCompareOutput,
  finiteNumber,
} from './useWebSocket/outputExtraction';
import { parseBinaryPreviewMessage } from './useWebSocket/binaryPreview';
import {
  BACKEND_LOST_NOTICE_MIN_DOWNTIME_MS,
  getBackendReconnectMessage,
  runQueuePollTick,
} from './useWebSocket/queuePolling';

// These helpers used to live further down in this file; re-export them so the
// existing public surface of @/hooks/useWebSocket is unchanged.
export {
  extractTextPreviewFromOutput,
  collectExecutedMediaOutputs,
  collectDenoVideoCompareOutput,
  parseBinaryPreviewMessage,
  BACKEND_LOST_NOTICE_MIN_DOWNTIME_MS,
  getBackendReconnectMessage,
  runQueuePollTick,
};
export type { ParsedBinaryPreview } from './useWebSocket/binaryPreview';


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


function snapshotStoreActions() {
  return {
    setExecutionState: useWorkflowStore.getState().setExecutionState,
    setNodeOutput: useWorkflowStore.getState().setNodeOutput,
    setNodeComparerOutput: useWorkflowStore.getState().setNodeComparerOutput,
    setNodeTextOutput: useWorkflowStore.getState().setNodeTextOutput,
    clearNodeOutputs: useWorkflowStore.getState().clearNodeOutputs,
    setLatentPreview: useWorkflowStore.getState().setLatentPreview,
    setLatentPreviewTiles: useWorkflowStore.getState().setLatentPreviewTiles,
    clearAllLatentPreviews: useWorkflowStore.getState().clearAllLatentPreviews,
    setQueueLatentPreview: useWorkflowStore.getState().setQueueLatentPreview,
    setQueueLatentPreviewTiles: useWorkflowStore.getState().setQueueLatentPreviewTiles,
    clearQueueLatentPreviews: useWorkflowStore.getState().clearQueueLatentPreviews,
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

    // Authoritative latent shape from our own ComfyUI extension
    // (mobile_latent_shape.py), keyed by `promptId|nodeId`. Preview frames
    // arrive as a flat run of N images whether they are N separate results or N
    // frames of one animation, and nothing in the frames themselves says which;
    // this is the only thing that does. Absent means unknown, and unknown keeps
    // the previous single-slot behaviour rather than guessing.
    type LatentShape = { batch: number; frames: number };
    const latentShapes = new Map<string, LatentShape>();
    const latentShapeKey = (promptId: string | null, nodeId: string) =>
      `${promptId ?? ''}|${nodeId}`;
    const lookupLatentShape = (nodeId: string): LatentShape | null => {
      const promptId = executingPromptIdRef.current;
      return latentShapes.get(latentShapeKey(promptId, nodeId))
        ?? latentShapes.get(latentShapeKey(null, nodeId))
        ?? null;
    };

    type VhsLatentSequence = {
      frames: Array<Blob | undefined>;
      // A batch of B results is drawn as B tiles; an animation of T frames is
      // drawn in one. VHS flattens [B, C, T, H, W] batch-major, so the frame at
      // index `tile * framesPerTile + displayIndex` belongs to `tile`.
      tiles: number;
      framesPerTile: number;
      displayIndex: number;
      nodeId: string;
      timer: ReturnType<typeof setInterval> | null;
    };
    const vhsLatentSequences = new Map<string, VhsLatentSequence>();
    /** Stop every running sequence, keeping the shape hints. A new sequence
     *  supersedes the old one but is described by a hint that has already
     *  arrived, so opening one must not discard it. */
    const stopVhsLatentSequences = () => {
      for (const sequence of vhsLatentSequences.values()) {
        if (sequence.timer) clearInterval(sequence.timer);
      }
      vhsLatentSequences.clear();
    };
    /** Run/node boundary: drop the sequences AND the hints that described them.
     *  Hints arrive after the `executing` frame for their node, so clearing here
     *  keeps the map to the sampler in flight rather than letting it grow for
     *  the life of the socket. */
    const clearVhsLatentSequences = () => {
      stopVhsLatentSequences();
      latentShapes.clear();
    };
    const startVhsLatentSequence = (detail: Record<string, unknown>) => {
      const rawId = typeof detail.id === 'string' || typeof detail.id === 'number'
        ? String(detail.id)
        : '';
      const length = Math.max(1, Math.min(4096, Math.trunc(finiteNumber(detail.length, 1))));
      const rate = Math.max(1, Math.min(60, finiteNumber(detail.rate, 8)));
      if (!rawId) return;
      // Comfy executes one node at a time, so a new VHS sequence supersedes
      // every earlier one, even when its node id differs. Leaving an older
      // interval alive lets it keep racing the new sampler for the prompt's
      // queue preview (and repeatedly repaint its old workflow card).
      stopVhsLatentSequences();

      // Split the flat frame run into tiles using the shape our extension
      // reported. Without it, or if the numbers disagree with what VHS actually
      // sent, fall back to one tile carrying every frame — the pre-existing
      // behaviour, never a guess at a different one.
      const shape = lookupLatentShape(rawId);
      const splits = shape && shape.batch > 1 && shape.batch * shape.frames === length
        ? { tiles: shape.batch, framesPerTile: shape.frames }
        : { tiles: 1, framesPerTile: length };

      const sequence: VhsLatentSequence = {
        frames: new Array<Blob | undefined>(length),
        tiles: splits.tiles,
        framesPerTile: splits.framesPerTile,
        displayIndex: 0,
        nodeId: rawId,
        timer: null,
      };
      // A still-image batch has one frame per tile, so there is nothing to
      // animate: painting on arrival avoids both the flicker of cycling
      // unrelated images through one slot and a timer that would mint a fresh
      // object URL for unchanged frames several times a second.
      if (sequence.framesPerTile > 1) {
        sequence.timer = setInterval(() => {
          // Paint the current frame, then advance — the first tick shows frame
          // 0, not frame 1.
          paintVhsLatentSequence(sequence);
          sequence.displayIndex = (sequence.displayIndex + 1) % sequence.framesPerTile;
        }, 1000 / rate);
      }
      vhsLatentSequences.set(rawId, sequence);
    };

    /** Push the sequence's currently-visible frame (one per tile) to the node
     *  card and the queue card. Each consumer gets its own object URL from the
     *  same blob: they have independent lifecycles, so revoking one must never
     *  invalidate the other. */
    const paintVhsLatentSequence = (sequence: VhsLatentSequence) => {
      const visible = Array.from({ length: sequence.tiles }, (_, tile) => (
        sequence.frames[tile * sequence.framesPerTile + sequence.displayIndex]
      ));
      if (!visible.some(Boolean)) return;
      const promptId = executingPromptIdRef.current;
      const ctx = getSessionContext(promptId);
      if (ctx.orphaned) return;
      const urlsFor = (frames: Array<Blob | undefined>) =>
        frames.map((frame) => (frame ? URL.createObjectURL(frame) : null));

      // Queue previews are global, but workflow-card latent previews belong
      // only to the foreground session. A parked run must not paint onto an
      // active card whose numeric/pointer key happens to coincide.
      if (ctx.sessionId === useWorkflowStore.getState().activeSessionId) {
        const idParts = sequence.nodeId.split(':');
        const routedKeys = new Set<string>();
        for (let index = 1; index <= idParts.length; index += 1) {
          const prefix = idParts.slice(0, index).join(':');
          const key = resolveNodeHierarchicalKey(prefix, ctx);
          if (key) routedKeys.add(key);
        }
        for (const key of routedKeys) {
          storeActionsRef.current.setLatentPreviewTiles(urlsFor(visible), key);
        }
      }
      if (promptId) {
        storeActionsRef.current.setQueueLatentPreviewTiles(promptId, urlsFor(visible));
      }
    };

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
      storeActionsRef.current.clearQueueLatentPreviews();
      clearVhsLatentSequences();
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
            clearVhsLatentSequences();
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

          // Stop an animated sampler as soon as execution advances. The next
          // sampler, if it supports VHS animation, starts a fresh sequence from
          // its own VHS_latentpreview event below.
          if (nodeId !== null) clearVhsLatentSequences();

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
            clearVhsLatentSequences();

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
              // A new prompt is starting and has no latent frames yet, so this is
              // the safe moment to revoke the previous run's queue latent previews
              // (the just-finished card has already swapped to its real output).
              storeActionsRef.current.clearQueueLatentPreviews();
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
          const mediaOutputs = collectExecutedMediaOutputs(
            output,
            `${prompt_id}:${node}:${Date.now()}`,
          );
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
          const denoVideoCompare = collectDenoVideoCompareOutput(output);
          if (denoVideoCompare) {
            itemKeysForOutput.forEach((key) => {
              setNodeComparerOutput(key, denoVideoCompare, ctx.sessionId);
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

        case 'video-oasis/result': {
          const ioId = asText(msg.data.io_id);
          const results = Array.isArray(msg.data.results) ? msg.data.results : [];
          if (!ioId || results.length === 0) break;
          const token = `oasis:${ioId}:${Date.now()}`;
          const descriptors = collectExecutedMediaOutputs({ videos: results })
            .map((descriptor) => ({ ...descriptor, cacheToken: token }));
          if (descriptors.length === 0) break;
          // Oasis's desktop widget appends every result to its serialized scene
          // bar. Do the same atomically for the active or parked owner, while a
          // one-item volatile output marks this arrival as eligible to autoplay.
          // Only one owner consumes an id; duplicate legacy ids are repaired at
          // load/queue time and must never paint multiple nodes in the meantime.
          useWorkflowStore.setState((state) => {
            let consumed = false;
            let workflow = state.workflow;
            let nodeOutputs = state.nodeOutputs;
            if (workflow) {
              const appended = appendOasisPreviewResults(
                workflow,
                state.nodeTypes,
                ioId,
                descriptors,
              );
              if (appended.target) {
                consumed = true;
                workflow = appended.workflow;
                nodeOutputs = {
                  ...nodeOutputs,
                  [String(appended.target.node.id)]: descriptors.slice(-1),
                };
              }
            }
            let parkedChanged = false;
            const parkedSessions = { ...state.parkedSessions };
            if (!consumed) {
              for (const [sessionId, snapshot] of Object.entries(state.parkedSessions)) {
                if (!snapshot.workflow) continue;
                const appended = appendOasisPreviewResults(
                  snapshot.workflow,
                  state.nodeTypes,
                  ioId,
                  descriptors,
                );
                if (!appended.target) continue;
                parkedChanged = true;
                consumed = true;
                parkedSessions[sessionId] = {
                  ...snapshot,
                  workflow: appended.workflow,
                  nodeOutputs: {
                    ...snapshot.nodeOutputs,
                    [String(appended.target.node.id)]: descriptors.slice(-1),
                  },
                };
                break;
              }
            }
            if (!consumed) return {};
            return {
              ...(workflow !== state.workflow ? { workflow } : {}),
              ...(nodeOutputs !== state.nodeOutputs ? { nodeOutputs } : {}),
              ...(parkedChanged ? { parkedSessions } : {}),
            };
          });
          break;
        }

        // Sent by our own extension (mobile_latent_shape.py) just before the
        // sampler's first preview, so the shape is always known by the time a
        // sequence opens below.
        case 'mobile_latent_shape': {
          const detail = asRecord(msg.data);
          const nodeId = asText(detail?.node_id);
          if (!nodeId) break;
          const batch = Math.max(1, Math.trunc(finiteNumber(detail?.batch, 1)));
          const frames = Math.max(1, Math.trunc(finiteNumber(detail?.frames, 1)));
          latentShapes.set(
            latentShapeKey(asText(detail?.prompt_id) || null, nodeId),
            { batch, frames },
          );
          break;
        }

        case 'VHS_latentpreview': {
          startVhsLatentSequence(msg.data);
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
              // fromRun: this IS the mid-run failure path (the execution_error
              // frame). Without the flag the error is classified as a workflow
              // LOAD error, and BottomStatusOverlay suppresses its toast on
              // every panel except the workflow one — so a run that died while
              // the user watched the queue or outputs failed silently.
              useWorkflowErrorsStore.getState().setNodeErrors(nodeErrors, true);
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
          clearVhsLatentSequences();
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

        case 'impact-node-feedback': {
          // Impact Pack echoing a widget value it rewrote server-side at queue
          // time — most visibly the wildcard processor's resolved prompt.
          const feedback = parseImpactNodeFeedback(msg.data);
          if (!feedback) break;
          const { workflow, nodeTypes } = useWorkflowStore.getState();
          if (!workflow) break;
          const next = applyImpactNodeFeedback(workflow, nodeTypes, feedback);
          if (next) useWorkflowStore.setState({ workflow: next });
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

    // Route a decoded preview frame to its two consumers. They have independent
    // lifecycles (the node card is active-tab-only and keyed by node; the queue
    // card is global and keyed by prompt), so each gets its OWN object URL from
    // the same blob — revoking one must never invalidate the other.
    const dispatchPreviewFrame = (blob: Blob) => {
      // Queue card: keyed by the executing prompt, so it works even for a run
      // started in a parked tab.
      const execPromptId = executingPromptIdRef.current;
      if (execPromptId) {
        storeActionsRef.current.setQueueLatentPreview(execPromptId, URL.createObjectURL(blob));
      }
      // Node card: only the active session's executing node.
      const nodeUrl = URL.createObjectURL(blob);
      const itemKey = resolvePreviewItemKey();
      if (!itemKey) { URL.revokeObjectURL(nodeUrl); return; }
      storeActionsRef.current.setLatentPreview(nodeUrl, itemKey);
    };

    const handleBinaryMessage = (data: ArrayBuffer) => {
      const parsed = parseBinaryPreviewMessage(data);
      if (!parsed) return;
      if (parsed.kind === 'image') {
        dispatchPreviewFrame(parsed.blob);
        return;
      }
      const sequence = vhsLatentSequences.get(parsed.nodeId);
      if (!sequence || parsed.index < 0 || parsed.index >= sequence.frames.length) return;
      sequence.frames[parsed.index] = parsed.blob;
      // A still batch runs no timer, so each arriving frame paints its own tile
      // as it lands. VHS dribbles a batch out a frame at a time (its throttle
      // sends only as many as the elapsed time allows), which is exactly what
      // made a single slot flicker between unrelated images.
      if (!sequence.timer) paintVhsLatentSequence(sequence);
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
          let recoverableJobIds = useQueueStore
            .getState()
            .detectRecoverableJobs(completedPromptIds);
          // The loaded history window is small (10 newest by default), so a job
          // that completed while the UI was closed can be pushed past it and
          // wrongly flagged. Confirm each candidate against its own backend
          // history entry before treating it as lost.
          if (recoverableJobIds.length > 0) {
            recoverableJobIds = await useQueueStore
              .getState()
              .verifyRecoverableJobsAgainstHistory();
          }

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
              .setError(getBackendReconnectMessage(reconnectedAfterMs), 'backend-connection');
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
      clearVhsLatentSequences();
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
      // Do NOT clear infiniteLoopAwaitingRun here. A live prompt for this
      // session may be a pre-existing manual run that was already queued when
      // infinite mode was armed — clearing on that would make arming look like
      // an active loop and auto-start generation once those items drain. Only an
      // actual loop Run (queueWorkflow) clears the guard, so existing queue
      // items finish first and the loop starts only when the user hits Run.
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
