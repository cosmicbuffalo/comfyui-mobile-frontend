import { useEffect, useRef, useState } from 'react';
import { connectWebSocket, clientId } from '@/api/client';
import { useWorkflowStore } from './useWorkflow';
import { useLoraManagerStore } from './useLoraManager';
import { useQueueStore } from './useQueue';
import { useHistoryStore } from './useHistory';
import { useWorkflowErrorsStore, type NodeError } from './useWorkflowErrors';
import type { WSMessage, WSStatusMessage, WSProgressMessage, WSExecutingMessage, WSExecutedMessage, HistoryOutputImage } from '@/api/types';

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

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOutputsRef = useRef<Record<string, HistoryOutputImage[]>>({});

  // Use refs for store actions to avoid recreating callbacks
  const storeActionsRef = useRef({
    setExecutionState: useWorkflowStore.getState().setExecutionState,
    setNodeOutput: useWorkflowStore.getState().setNodeOutput,
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
    addHistoryEntry: useHistoryStore.getState().addHistoryEntry,
    fetchHistory: useHistoryStore.getState().fetchHistory,
  });

  // Update refs when stores change (they shouldn't, but just in case)
  useEffect(() => {
    storeActionsRef.current = {
      setExecutionState: useWorkflowStore.getState().setExecutionState,
      setNodeOutput: useWorkflowStore.getState().setNodeOutput,
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
      addHistoryEntry: useHistoryStore.getState().addHistoryEntry,
      fetchHistory: useHistoryStore.getState().fetchHistory,
    };
  }, []);

  const lastPromptIdRef = useRef<string | null>(null);

  useEffect(() => {
    /** Maps a raw WS node ID (expanded numeric or hierarchical prompt key) to
     *  the canonical hierarchical key used by the store (e.g. "root/node:5" or
     *  "root/subgraph:{uuid}/node:10").
     *
     *  Two lookup paths:
     *  1. expandedNodeIdMap — populated when the mobile frontend queues a prompt.
     *  2. Direct match on workflow.nodes — fallback for prompts queued by the
     *     desktop frontend, where WS node IDs are root-level canonical IDs. */
    const resolveNodeHierarchicalKey = (rawNodeId: number | string | null | undefined): string | null => {
      if (rawNodeId == null) return null;
      const idStr = String(rawNodeId);
      const workflowState = useWorkflowStore.getState();
      const workflow = workflowState.workflow;
      if (!workflow) return null;

      const mappedKey = workflowState.expandedNodeIdMap[idStr];
      if (mappedKey) return mappedKey;

      if (!idStr.includes(':')) {
        const numericNodeId = Number(idStr);
        if (Number.isFinite(numericNodeId)) {
          const directMatch = workflow.nodes.find(
            (node) => node.id === numericNodeId && node.itemKey,
          );
          if (directMatch) return directMatch.itemKey!;
        }
      }

      return null;
    };

    const resolveExecutionNodePath = (
      rawNodeId: number | string | null | undefined,
    ): string | null => {
      if (rawNodeId == null) return null;
      const idStr = String(rawNodeId).trim();
      if (!idStr) return null;
      const workflowState = useWorkflowStore.getState();
      return workflowState.expandedNodePathMap[idStr] ?? idStr;
    };

    /** Like resolveNodeHierarchicalKey but returns ALL matching keys.
     *  Needed for the `executed` handler where a single WS node ID may map to
     *  multiple canonical keys (e.g. same subgraph definition used more than once). */
    const resolveNodeHierarchicalKeysForOutput = (
      rawNodeId: number | string | null | undefined,
    ): string[] => {
      if (rawNodeId == null) return [];
      const idStr = String(rawNodeId);
      const workflowState = useWorkflowStore.getState();
      const workflow = workflowState.workflow;
      if (!workflow) return [];

      const keys = new Set<string>();

      const mappedKey = workflowState.expandedNodeIdMap[idStr];
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

    const handleMessage = (data: unknown) => {
      const {
        setExecutionState,
        setNodeOutput,
        setNodeTextOutput,
        addPromptOutputs,
        clearPromptOutputs,
        updateFromStatus,
        fetchQueue,
        addHistoryEntry,
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

          if (queueRemaining === 0) {
            setExecutionState(false, null, null, 0);
            storeActionsRef.current.clearAllLatentPreviews();
          }
          break;
        }

        case 'progress': {
          const progressMsg = msg as WSProgressMessage;
          const { value, max, node, prompt_id } = progressMsg.data;
          const progress = Math.round((value / max) * 100);
          setExecutionState(
            true,
            resolveNodeHierarchicalKey(node),
            prompt_id || null,
            progress,
            resolveExecutionNodePath(node),
          );
          break;
        }

        case 'executing': {
          const execMsg = msg as WSExecutingMessage;
          const nodeId = execMsg.data.node;
          const promptId = execMsg.data.prompt_id;

          if (nodeId === null) {
            // Execution finished
            setExecutionState(false, null, null, 0);
            storeActionsRef.current.clearAllLatentPreviews();

            // Apply control_after_generate for PrimitiveNodes
            storeActionsRef.current.applyControlAfterGenerate();

            // Optimistically add to history to prevent UI flash
            if (promptId) {
              const runningItem = useQueueStore.getState().running.find(r => r.prompt_id === promptId);
              const images = pendingOutputsRef.current[promptId] || [];

              if (runningItem) {
                 addHistoryEntry({
                    prompt_id: promptId,
                    timestamp: Date.now(),
                    outputs: { images },
                    prompt: runningItem.prompt
                 });
              }
              // Cleanup
              delete pendingOutputsRef.current[promptId];
              clearPromptOutputs(promptId);
            }

            fetchQueue(); // Refresh queue state
            fetchHistory();
          } else {
            // Track new prompt without clearing existing outputs to avoid layout shift.
            if (promptId && promptId !== lastPromptIdRef.current) {
              lastPromptIdRef.current = promptId;
            }

            // Execution started/is continuing for a node
            setExecutionState(
              true,
              resolveNodeHierarchicalKey(nodeId),
              promptId || null,
              0,
              resolveExecutionNodePath(nodeId),
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
          const itemKey = resolveNodeHierarchicalKey(node);
          const itemKeysForOutput = resolveNodeHierarchicalKeysForOutput(node);
          const images = output.images;
          if (images) {
             // Store for history
             if (!pendingOutputsRef.current[prompt_id]) {
               pendingOutputsRef.current[prompt_id] = [];
             }
             pendingOutputsRef.current[prompt_id].push(...images);
             addPromptOutputs(prompt_id, images);

             // Store for node display
             const targetKeys =
               itemKeysForOutput.length > 0
                 ? itemKeysForOutput
                 : (itemKey ? [itemKey] : []);
             targetKeys.forEach((key) => {
               setNodeOutput(key, images);
             });
          }
          const textPreview = extractTextPreviewFromOutput(output as Record<string, unknown>);
          if (textPreview && itemKeysForOutput.length > 0) {
            itemKeysForOutput.forEach((key) => {
              setNodeTextOutput(key, textPreview);
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

          useWorkflowErrorsStore.getState().setError(`${fullMessage}${details ? `\n${details}` : ''}`);
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
          console.error('Execution error:', {
            promptId,
            nodeId,
            nodeType,
            message,
            details,
          });

          setExecutionState(false, null, null, 0);
          storeActionsRef.current.clearAllLatentPreviews();
          clearPromptOutputs();
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
      }
    };

    const handleBinaryMessage = (data: ArrayBuffer) => {
      if (data.byteLength < 8) return;

      const view = new DataView(data);
      const type = view.getUint32(0, false); // big-endian

      // Both type 1 and type 4 preview frames read executingNodeHierarchicalKey
      // directly from the store. Type 1 frames carry no node ID, and type 4
      // metadata node IDs are unreliable for subgraph inner nodes whose canonical
      // ID differs from their expanded prompt ID.
      if (type === 1) {
        // Legacy: [type(4B)][imageType(4B)][imageData]
        const imageType = view.getUint32(4, false);
        const mime = imageType === 2 ? 'image/png' : 'image/jpeg';
        const imageData = data.slice(8);
        const blob = new Blob([imageData], { type: mime });
        const url = URL.createObjectURL(blob);
        const itemKey = useWorkflowStore.getState().executingNodeHierarchicalKey;
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
          const itemKey = useWorkflowStore.getState().executingNodeHierarchicalKey;
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
          const { fetchQueue, fetchHistory, setExecutionState } = storeActionsRef.current;
          await fetchQueue();
          fetchHistory();

          // Sync execution state from queue after reconnect/refresh
          const queueState = useQueueStore.getState();
          const workflowState = useWorkflowStore.getState();
          if (queueState.running.length > 0 && !workflowState.executingPromptId) {
            // There's a running item but we don't have execution state - restore it
            const runningItem = queueState.running[0];
            setExecutionState(true, null, runningItem.prompt_id, 0);
          }
        },
        () => {
          setIsConnected(false);
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
      const queueState = useQueueStore.getState();
      if (queueState.running.length > 0) {
        fetchQueue();
        fetchHistory();
      }
    }, 2000);

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
      clearInterval(pollInterval);
    };
  }, []); // Empty dependency array - only run once on mount

  return { isConnected };
}
