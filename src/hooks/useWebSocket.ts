import { useEffect, useRef, useState } from 'react';
import { connectWebSocket, clientId } from '@/api/client';
import { useWorkflowStore } from './useWorkflow';
import { useLoraManagerStore } from './useLoraManager';
import { useQueueStore } from './useQueue';
import { useHistoryStore } from './useHistory';
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
      const numericNodeId = Number(rawNodeId);
      if (!Number.isFinite(numericNodeId)) return null;
      const workflowState = useWorkflowStore.getState();
      const workflow = workflowState.workflow;
      if (!workflow) return null;
      let candidates = workflow.nodes.filter((node) => node.id === numericNodeId);
      if (candidates.length === 0) {
        candidates = workflow.nodes.filter((node) => {
          const origin = (node.properties as Record<string, unknown> | undefined)?.__mobile_origin;
          if (!origin || typeof origin !== 'object') return false;
          const originNodeId = (origin as { nodeId?: unknown }).nodeId;
          return Number(originNodeId) === numericNodeId;
        });
      }
      if (candidates.length === 0) return null;
      const preferred = candidates.find((node) => node.stableKey) ?? candidates[0];
      return preferred?.stableKey ?? null;
    };

    const resolveStableNodeKeysForOutput = (
      rawNodeId: number | string | null | undefined,
    ): string[] => {
      if (rawNodeId == null) return [];
      const numericNodeId = Number(rawNodeId);
      if (!Number.isFinite(numericNodeId)) return [];
      const workflowState = useWorkflowStore.getState();
      const workflow = workflowState.workflow;
      if (!workflow) return [];

      const keys = new Set<string>();
      const byId = workflow.nodes.filter((node) => node.id === numericNodeId);
      byId.forEach((node) => {
        if (node.stableKey) keys.add(node.stableKey);
      });

      const byOrigin = workflow.nodes.filter((node) => {
        const origin = (node.properties as Record<string, unknown> | undefined)?.__mobile_origin;
        if (!origin || typeof origin !== 'object') return false;
        const originNodeId = (origin as { nodeId?: unknown }).nodeId;
        return Number(originNodeId) === numericNodeId;
      });
      byOrigin.forEach((node) => {
        if (node.stableKey) keys.add(node.stableKey);
      });

      // If the executed node is an expanded clone, also mirror output to its origin/root node id.
      for (const node of byId) {
        const origin = (node.properties as Record<string, unknown> | undefined)?.__mobile_origin;
        if (!origin || typeof origin !== 'object') continue;
        const originNodeId = Number((origin as { nodeId?: unknown }).nodeId);
        if (!Number.isFinite(originNodeId)) continue;
        workflow.nodes
          .filter((entry) => entry.id === originNodeId)
          .forEach((entry) => {
            if (entry.stableKey) keys.add(entry.stableKey);
          });
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
          setExecutionState(true, resolveStableNodeKey(node), prompt_id || null, progress);
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
            setExecutionState(true, resolveStableNodeKey(nodeId), promptId || null, 0);
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
          const stableKey = resolveStableNodeKey(node);
          const stableKeysForOutput = resolveStableNodeKeysForOutput(node);
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
               stableKeysForOutput.length > 0
                 ? stableKeysForOutput
                 : (stableKey ? [stableKey] : []);
             targetKeys.forEach((key) => {
               setNodeOutput(key, images);
             });
          }
          const textPreview = extractTextPreviewFromOutput(output as Record<string, unknown>);
          if (textPreview && stableKeysForOutput.length > 0) {
            stableKeysForOutput.forEach((key) => {
              setNodeTextOutput(key, textPreview);
            });
          }
          break;
        }

        case 'execution_error': {
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
