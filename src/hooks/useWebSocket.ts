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
    const resolveStableNodeKey = (rawNodeId: number | string | null | undefined): string | null => {
      if (rawNodeId == null) return null;
      const idStr = String(rawNodeId);
      const workflowState = useWorkflowStore.getState();
      const workflow = workflowState.workflow;
      if (!workflow) return null;

      // First try the execution expansion map; WS node IDs may be hierarchical keys
      // (e.g. "50:7") or expanded numeric IDs that don't exist in canonical workflow.nodes.
      const mappedKey = workflowState.expandedNodeIdMap[idStr];
      if (mappedKey) return mappedKey;

      // Fast path: non-hierarchical ID — try direct match on root-level canonical nodes
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

    const resolveStableNodeKeysForOutput = (
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

      // Fast path: non-hierarchical ID — try direct match on root-level canonical nodes
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
          }
          break;
        }

        case 'progress': {
          const progressMsg = msg as WSProgressMessage;
          const { value, max, node, prompt_id } = progressMsg.data;
          const progress = Math.round((value / max) * 100);
          setExecutionState(
            true,
            resolveStableNodeKey(node),
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
              resolveStableNodeKey(nodeId),
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
          const itemKey = resolveStableNodeKey(node);
          const itemKeysForOutput = resolveStableNodeKeysForOutput(node);
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
        }
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
