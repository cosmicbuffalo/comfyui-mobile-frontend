import { create } from "zustand";
import type { NodeTypes, Workflow, WorkflowNode } from "@/api/types";
import * as api from "@/api/client";
import { useWorkflowStore } from "@/hooks/useWorkflow";
import { getWidgetIndexForInput } from "@/utils/seedUtils";
import { resolveComboOption, resolveSource } from "@/utils/workflowInputs";
import { makeLocationPointer } from "@/utils/mobileLayout";
import {
  applyLoraValuesToText,
  extractLoraList,
  findLoraListIndex,
  isLoraChainProviderNodeType,
  isLoraCyclerNodeType,
  isLoraDirectProviderNodeType,
  isLoraLoaderNodeType,
  isLoraManagerNodeType,
  mergeLoras,
} from "@/utils/loraManager";
import {
  buildTriggerWordListFromMessage,
  extractTriggerWordList,
  extractTriggerWordListLoose,
  extractTriggerWordMessage,
  findTriggerWordListIndex,
  findTriggerWordMessageIndex,
  isTriggerWordToggleNodeType,
} from "@/utils/triggerWordToggle";

const MOBILE_ORIGIN_KEY = "__mobile_origin";

type MobileOrigin =
  | { scope: "root"; nodeId: number }
  | { scope: "subgraph"; subgraphId: string; nodeId: number };

interface LoraManagerState {
  isLoraManagerAvailable: boolean;
  refreshLoraManagerAvailability: () => boolean;
  applyLoraCodeUpdate: (payload: Record<string, unknown>) => void;
  applyTriggerWordUpdate: (payload: Record<string, unknown>) => void;
  applyWidgetUpdate: (payload: Record<string, unknown>) => void;
  syncTriggerWordsForNode: (nodeId: number, graphId?: string | null) => void;
  registerLoraManagerNodes: () => Promise<void>;
}

function getMobileOrigin(node: WorkflowNode | undefined): MobileOrigin | null {
  if (!node) return null;
  const props = node.properties as Record<string, unknown> | undefined;
  const origin = props?.[MOBILE_ORIGIN_KEY];
  if (!origin || typeof origin !== "object") return null;
  const scope = (origin as { scope?: string }).scope;
  if (scope === "root") {
    const nodeId = (origin as { nodeId?: number }).nodeId;
    return typeof nodeId === "number" ? { scope: "root", nodeId } : null;
  }
  if (scope === "subgraph") {
    const nodeId = (origin as { nodeId?: number }).nodeId;
    const subgraphId = (origin as { subgraphId?: string }).subgraphId;
    if (typeof nodeId === "number" && typeof subgraphId === "string") {
      return { scope: "subgraph", subgraphId, nodeId };
    }
  }
  return null;
}

function matchesNodeReference(
  node: WorkflowNode,
  nodeId: number,
  graphId: string | null,
): boolean {
  const normalizedGraphId = graphId ?? "root";
  const origin = getMobileOrigin(node);
  if (origin?.scope === "subgraph") {
    return (
      normalizedGraphId !== "root" &&
      origin.subgraphId === normalizedGraphId &&
      origin.nodeId === nodeId
    );
  }
  if (origin?.scope === "root") {
    return normalizedGraphId === "root" && origin.nodeId === nodeId;
  }
  return normalizedGraphId === "root" && node.id === nodeId;
}

function getNodePointerFromWorkflowNode(node: WorkflowNode): string {
  const origin = getMobileOrigin(node);
  return makeLocationPointer({
    type: "node",
    nodeId: node.id,
    subgraphId: origin?.scope === "subgraph" ? origin.subgraphId : null,
  });
}

function resolveNodeTypeKey(nodeTypes: NodeTypes | null, nodeType: string): string | null {
  if (!nodeTypes) return null;
  if (nodeTypes[nodeType]) return nodeType;
  const match = Object.entries(nodeTypes).find(
    ([, def]) => def.display_name === nodeType || def.name === nodeType,
  );
  return match ? match[0] : null;
}

function isLoraManagerRelevantNodeType(nodeType: string): boolean {
  return (
    isLoraManagerNodeType(nodeType) ||
    isLoraLoaderNodeType(nodeType) ||
    isLoraDirectProviderNodeType(nodeType) ||
    isLoraChainProviderNodeType(nodeType) ||
    isTriggerWordToggleNodeType(nodeType)
  );
}

function hasLoraManagerSupport(workflow: Workflow | null, nodeTypes: NodeTypes | null): boolean {
  if (workflow?.nodes.some((node) => isLoraManagerRelevantNodeType(node.type))) {
    return true;
  }
  if (!nodeTypes) return false;
  return Object.entries(nodeTypes).some(([key, def]) => {
    const candidates = [key, def.name, def.display_name].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    return candidates.some((value) => isLoraManagerRelevantNodeType(value));
  });
}

export const useLoraManagerStore = create<LoraManagerState>((set, get) => {
  const refreshAvailability = (): boolean => {
    const { workflow, nodeTypes } = useWorkflowStore.getState();
    const available = hasLoraManagerSupport(workflow, nodeTypes);
    if (get().isLoraManagerAvailable !== available) {
      set({ isLoraManagerAvailable: available });
    }
    return available;
  };

  const getStableKeyForNode = (node: WorkflowNode): string | null => {
    if (typeof node.stableKey === "string" && node.stableKey) {
      return node.stableKey;
    }
    const pointer = getNodePointerFromWorkflowNode(node);
    return useWorkflowStore.getState().stableKeyByPointer[pointer] ?? null;
  };

  const parsePayloadNodeId = (rawNodeId: unknown): number | null => {
    if (typeof rawNodeId === "number") return rawNodeId;
    if (typeof rawNodeId === "string") {
      const parsed = Number(rawNodeId);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const resolvePayloadTargets = (
    workflow: Workflow,
    payload: Record<string, unknown>,
    options?: { allowBroadcastToLoraNodes?: boolean },
  ): WorkflowNode[] => {
    const rawNodeId = payload.node_id ?? payload.id;
    const graphId = typeof payload.graph_id === "string" ? payload.graph_id : null;
    const numericId = parsePayloadNodeId(rawNodeId);
    if (numericId === null) return [];
    const isBroadcast = numericId === -1;

    if (isBroadcast && options?.allowBroadcastToLoraNodes) {
      return workflow.nodes.filter((node) => isLoraManagerNodeType(node.type));
    }

    return workflow.nodes.filter((node) => matchesNodeReference(node, numericId, graphId));
  };

  const syncTriggerWordsForNode: LoraManagerState["syncTriggerWordsForNode"] = (
    nodeId,
    graphId = null,
  ) => {
    if (!refreshAvailability()) return;

    const { workflow, nodeTypes } = useWorkflowStore.getState();
    if (!workflow) return;

    const sourceNode = workflow.nodes.find((node) =>
      matchesNodeReference(node, nodeId, graphId),
    );
    if (!sourceNode) return;

    const isLoader = isLoraLoaderNodeType(sourceNode.type);
    const isChainProvider = isLoraChainProviderNodeType(sourceNode.type);
    const isDirectProvider = isLoraDirectProviderNodeType(sourceNode.type);

    if (!isLoader && !isChainProvider && !isDirectProvider) return;

    const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
    const linkMap = new Map(workflow.links.map((link) => [link[0], link]));
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value);

    const isNodeActive = (node: WorkflowNode): boolean =>
      node.mode === undefined || node.mode === 0 || node.mode === 3;

    const getNodeReference = (node: WorkflowNode): api.TriggerWordTargetReference => {
      const origin = getMobileOrigin(node);
      return {
        node_id: origin?.nodeId ?? node.id,
        graph_id: origin?.scope === "subgraph" ? origin.subgraphId : "root",
      };
    };

    const getConnectedTriggerToggleNodes = (node: WorkflowNode): WorkflowNode[] => {
      const connected: WorkflowNode[] = [];
      for (const output of node.outputs ?? []) {
        const links = output.links ?? [];
        for (const linkId of links) {
          const link = linkMap.get(linkId);
          if (!link) continue;
          const targetNode = nodesById.get(link[3]);
          if (targetNode && isTriggerWordToggleNodeType(targetNode.type)) {
            connected.push(targetNode);
          }
        }
      }
      return connected;
    };

    const updateConnectedTriggerWords = (
      node: WorkflowNode,
      loraNames: Set<string>,
    ) => {
      const connectedNodes = getConnectedTriggerToggleNodes(node);
      if (connectedNodes.length === 0) return;

      const references: api.TriggerWordTargetReference[] = [];
      const seen = new Set<string>();
      for (const target of connectedNodes) {
        const ref = getNodeReference(target);
        const key = `${ref.graph_id}:${ref.node_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        references.push(ref);
      }

      if (references.length === 0) return;

      void api.requestTriggerWords(Array.from(loraNames), references).catch((error) => {
        console.warn("[LoraManager] Failed to request trigger words:", error);
      });
    };

    const getActiveLorasFromNode = (node: WorkflowNode): Set<string> => {
      const names = new Set<string>();

      if (isLoraCyclerNodeType(node.type)) {
        if (!Array.isArray(node.widgets_values)) return names;
        const widgetValues = node.widgets_values;
        let config: unknown = null;
        if (nodeTypes) {
          const configIndex = getWidgetIndexForInput(
            workflow,
            nodeTypes,
            node,
            "cycler_config",
          );
          if (configIndex !== null) {
            config = widgetValues[configIndex];
          }
        }
        if (!config) {
          config = widgetValues.find(
            (value) =>
              isRecord(value) &&
              (typeof value.current_lora_filename === "string" ||
                typeof value.current_lora_name === "string"),
          );
        }
        if (isRecord(config)) {
          const name =
            typeof config.current_lora_filename === "string"
              ? config.current_lora_filename
              : typeof config.current_lora_name === "string"
                ? config.current_lora_name
                : "";
          if (name) names.add(name);
        }
        return names;
      }

      if (!Array.isArray(node.widgets_values)) return names;
      const textIndex = nodeTypes
        ? getWidgetIndexForInput(workflow, nodeTypes, node, "text")
        : null;
      const listIndex = findLoraListIndex(node, textIndex);
      if (listIndex === null) return names;
      const rawList = node.widgets_values[listIndex];
      const list =
        extractLoraList(rawList) ??
        (Array.isArray(rawList)
          ? (rawList as Array<{ name?: string; active?: boolean }>)
          : null);
      if (!list) return names;
      list.forEach((entry) => {
        if (!entry || typeof entry.name !== "string") return;
        if (entry.active === false) return;
        names.add(entry.name);
      });
      return names;
    };

    const getConnectedInputStackers = (node: WorkflowNode): WorkflowNode[] => {
      const connected: WorkflowNode[] = [];
      for (const input of node.inputs ?? []) {
        if (input.name !== "lora_stack" || input.link == null) continue;
        const resolved = resolveSource(workflow, input.link);
        if (!resolved) continue;
        const source = nodesById.get(resolved.nodeId);
        if (source && isLoraChainProviderNodeType(source.type)) {
          connected.push(source);
        }
      }
      return connected;
    };

    const collectActiveLorasFromChain = (
      node: WorkflowNode,
      visited = new Set<number>(),
    ): Set<string> => {
      if (visited.has(node.id)) return new Set<string>();
      visited.add(node.id);

      const names = new Set<string>();
      if (isNodeActive(node)) {
        const localNames = getActiveLorasFromNode(node);
        localNames.forEach((name) => names.add(name));
      }

      const stackers = getConnectedInputStackers(node);
      for (const stacker of stackers) {
        const stackerNames = collectActiveLorasFromChain(stacker, visited);
        stackerNames.forEach((name) => names.add(name));
      }

      return names;
    };

    const updateDownstreamLoaders = (
      startNode: WorkflowNode,
      visited = new Set<number>(),
    ) => {
      if (visited.has(startNode.id)) return;
      visited.add(startNode.id);

      for (const output of startNode.outputs ?? []) {
        const links = output.links ?? [];
        for (const linkId of links) {
          const link = linkMap.get(linkId);
          if (!link) continue;
          const targetNode = nodesById.get(link[3]);
          if (!targetNode) continue;

          if (isLoraLoaderNodeType(targetNode.type)) {
            const names = collectActiveLorasFromChain(targetNode);
            updateConnectedTriggerWords(targetNode, names);
            continue;
          }

          if (isLoraChainProviderNodeType(targetNode.type)) {
            updateDownstreamLoaders(targetNode, visited);
            continue;
          }

          if (targetNode.type === "Reroute" || targetNode.mode === 4) {
            updateDownstreamLoaders(targetNode, visited);
          }
        }
      }
    };

    if (isLoader) {
      const names = collectActiveLorasFromChain(sourceNode);
      updateConnectedTriggerWords(sourceNode, names);
      return;
    }

    if (isChainProvider) {
      const names = isNodeActive(sourceNode)
        ? getActiveLorasFromNode(sourceNode)
        : new Set<string>();
      updateConnectedTriggerWords(sourceNode, names);
      updateDownstreamLoaders(sourceNode);
      return;
    }

    if (isDirectProvider) {
      const names = isNodeActive(sourceNode)
        ? getActiveLorasFromNode(sourceNode)
        : new Set<string>();
      updateConnectedTriggerWords(sourceNode, names);
    }
  };

  const syncTriggerWordsForWorkflowNode = (node: WorkflowNode) => {
    const origin = getMobileOrigin(node);
    const targetNodeId = origin?.nodeId ?? node.id;
    const graphId = origin?.scope === "subgraph" ? origin.subgraphId : "root";
    syncTriggerWordsForNode(targetNodeId, graphId);
  };

  const applyLoraCodeUpdate: LoraManagerState["applyLoraCodeUpdate"] = (payload) => {
    if (!refreshAvailability()) return;

    const { workflow, nodeTypes, updateNodeWidgets } = useWorkflowStore.getState();
    if (!workflow) return;

    const loraCode = typeof payload.lora_code === "string" ? payload.lora_code : "";
    const mode = payload.mode === "replace" ? "replace" : "append";
    if (!loraCode) return;

    const targets = resolvePayloadTargets(workflow, payload, {
      allowBroadcastToLoraNodes: true,
    });

    targets.forEach((node) => {
      const textIndex = nodeTypes
        ? getWidgetIndexForInput(workflow, nodeTypes, node, "text")
        : null;
      const listIndex = findLoraListIndex(node, textIndex);
      if (textIndex === null && listIndex === null) return;

      const widgetValues = Array.isArray(node.widgets_values) ? node.widgets_values : [];
      const currentText = textIndex !== null ? String(widgetValues[textIndex] ?? "") : "";
      const nextText =
        mode === "replace"
          ? loraCode
          : currentText.trim()
            ? `${currentText.trim()} ${loraCode}`
            : loraCode;
      const currentList =
        listIndex !== null && Array.isArray(widgetValues[listIndex])
          ? widgetValues[listIndex]
          : [];
      const mergedList = mergeLoras(
        nextText,
        currentList as Array<{ name: string; strength: number | string }>,
      );

      const updates: Record<number, unknown> = {};
      if (textIndex !== null) updates[textIndex] = nextText;
      if (listIndex !== null) updates[listIndex] = mergedList;
      if (Object.keys(updates).length > 0) {
        const stableKey = getStableKeyForNode(node);
        if (!stableKey) return;
        updateNodeWidgets(stableKey, updates);
        syncTriggerWordsForWorkflowNode(node);
      }
    });
  };

  const applyTriggerWordUpdate: LoraManagerState["applyTriggerWordUpdate"] = (payload) => {
    if (!refreshAvailability()) return;

    const { workflow, nodeTypes, updateNodeWidgets } = useWorkflowStore.getState();
    if (!workflow || !nodeTypes) return;

    if (typeof payload.message !== "string") return;
    const message = payload.message;
    const targets = resolvePayloadTargets(workflow, payload);

    targets.forEach((node) => {
      if (!isTriggerWordToggleNodeType(node.type)) return;
      if (!Array.isArray(node.widgets_values)) return;

      const groupModeIndex = getWidgetIndexForInput(
        workflow,
        nodeTypes,
        node,
        "group_mode",
      );
      const defaultActiveIndex = getWidgetIndexForInput(
        workflow,
        nodeTypes,
        node,
        "default_active",
      );
      const allowStrengthIndex = getWidgetIndexForInput(
        workflow,
        nodeTypes,
        node,
        "allow_strength_adjustment",
      );
      const groupMode = groupModeIndex !== null ? Boolean(node.widgets_values[groupModeIndex]) : true;
      const defaultActive =
        defaultActiveIndex !== null ? Boolean(node.widgets_values[defaultActiveIndex]) : true;
      const allowStrength =
        allowStrengthIndex !== null ? Boolean(node.widgets_values[allowStrengthIndex]) : false;

      const mappedListIndex = getWidgetIndexForInput(
        workflow,
        nodeTypes,
        node,
        "toggle_trigger_words",
      );
      const listIndex =
        mappedListIndex !== null ? mappedListIndex : findTriggerWordListIndex(node);
      if (listIndex === null) return;

      const currentList =
        extractTriggerWordList(node.widgets_values[listIndex]) ??
        extractTriggerWordListLoose(node.widgets_values[listIndex]) ??
        [];
      const nextList = buildTriggerWordListFromMessage(message, {
        groupMode,
        defaultActive,
        allowStrengthAdjustment: allowStrength,
        existingList: currentList,
      });

      const updates: Record<number, unknown> = { [listIndex]: nextList };
      const nodeWidgetMap = workflow.widget_idx_map?.[String(node.id)];
      const mappedMessageIndex =
        nodeWidgetMap?.originalMessage ?? nodeWidgetMap?.orinalMessage;
      const messageIndex =
        mappedMessageIndex !== undefined
          ? mappedMessageIndex
          : findTriggerWordMessageIndex(node, listIndex);
      if (messageIndex !== null) {
        const currentMessage = extractTriggerWordMessage(node.widgets_values[messageIndex]);
        if (currentMessage !== message) {
          updates[messageIndex] = message;
        }
      }

      const stableKey = getStableKeyForNode(node);
      if (!stableKey) return;
      updateNodeWidgets(stableKey, updates);
    });
  };

  const applyWidgetUpdate: LoraManagerState["applyWidgetUpdate"] = (payload) => {
    if (!refreshAvailability()) return;

    const { workflow, nodeTypes, updateNodeWidget, updateNodeWidgets } = useWorkflowStore.getState();
    if (!workflow) return;

    const widgetName = typeof payload.widget_name === "string" ? payload.widget_name : "";
    const rawValue = payload.value;
    if (!widgetName) return;

    const targets = resolvePayloadTargets(workflow, payload);

    targets.forEach((node) => {
      const stableKey = getStableKeyForNode(node);
      if (!stableKey) return;

      const resolveWidgetIndex = (name: string): number | null => {
        let index: number | null = null;
        if (nodeTypes) {
          index = getWidgetIndexForInput(workflow, nodeTypes, node, name);
        }
        if (index === null) {
          const map = workflow.widget_idx_map?.[String(node.id)];
          const mapped = map?.[name];
          index = mapped !== undefined ? mapped : null;
        }
        if (index === null && name === "loras") {
          index = findLoraListIndex(node);
        }
        return index;
      };

      let nextValue = rawValue;
      if (nodeTypes) {
        const typeDef = nodeTypes[node.type];
        const inputDef =
          typeDef?.input?.required?.[widgetName] ||
          typeDef?.input?.optional?.[widgetName];
        const typeOrOptions = inputDef?.[0];
        if (Array.isArray(typeOrOptions)) {
          const resolved = resolveComboOption(rawValue, typeOrOptions);
          if (resolved !== undefined) {
            nextValue = resolved;
          }
        }
      }

      if (!Array.isArray(node.widgets_values)) {
        updateNodeWidget(stableKey, 0, nextValue, widgetName);
        return;
      }

      const index = resolveWidgetIndex(widgetName);
      const isLoraManagerNode = isLoraManagerNodeType(node.type);

      if (isLoraManagerNode && widgetName === "text" && typeof nextValue === "string") {
        const listIndex = findLoraListIndex(node, index);
        if (listIndex !== null) {
          const currentList = Array.isArray(node.widgets_values[listIndex])
            ? node.widgets_values[listIndex]
            : [];
          const mergedList = mergeLoras(
            nextValue,
            currentList as Array<{ name: string; strength: number | string }>,
          );
          const updates: Record<number, unknown> = {};
          if (index !== null) updates[index] = nextValue;
          updates[listIndex] = mergedList;
          updateNodeWidgets(stableKey, updates);
          syncTriggerWordsForWorkflowNode(node);
          return;
        }
      }

      if (isLoraManagerNode && widgetName === "loras") {
        const listIndex = index;
        const listValue =
          extractLoraList(nextValue) ?? (Array.isArray(nextValue) ? nextValue : null);
        const textIndex = resolveWidgetIndex("text");
        const updates: Record<number, unknown> = {};

        if (listIndex !== null) {
          updates[listIndex] = nextValue;
        }

        if (textIndex !== null && listValue) {
          const currentText =
            typeof node.widgets_values[textIndex] === "string"
              ? (node.widgets_values[textIndex] as string)
              : "";
          updates[textIndex] = applyLoraValuesToText(
            currentText,
            listValue as Array<{ name: string; strength: number | string }>,
          );
        }

        if (Object.keys(updates).length > 0) {
          updateNodeWidgets(stableKey, updates);
          syncTriggerWordsForWorkflowNode(node);
          return;
        }
      }

      if (index !== null) {
        updateNodeWidget(stableKey, index, nextValue, widgetName);
        if (
          isLoraManagerNode &&
          (widgetName === "cycler_config" || widgetName === "randomizer_config")
        ) {
          syncTriggerWordsForWorkflowNode(node);
        }
      }
    });
  };

  const registerLoraManagerNodes: LoraManagerState["registerLoraManagerNodes"] = async () => {
    if (!refreshAvailability()) return;

    const { workflow, nodeTypes } = useWorkflowStore.getState();
    if (!workflow) return;

    const targetWidgetNames = new Set(["ckpt_name", "unet_name"]);
    const nodesToRegister: api.LoraManagerRegistryNode[] = [];

    workflow.nodes.forEach((node) => {
      const origin = getMobileOrigin(node);
      const nodeId = origin?.nodeId ?? node.id;
      const graphId = origin?.scope === "subgraph" ? origin.subgraphId : "root";
      const supportsLora = isLoraManagerNodeType(node.type);
      const resolvedType = resolveNodeTypeKey(nodeTypes, node.type);
      const typeDef = resolvedType ? nodeTypes?.[resolvedType] : null;

      const widgetNames = new Set<string>();
      const requiredInputs = typeDef?.input?.required ?? {};
      const optionalInputs = typeDef?.input?.optional ?? {};
      Object.keys(requiredInputs).forEach((name) => widgetNames.add(name));
      Object.keys(optionalInputs).forEach((name) => widgetNames.add(name));
      if (supportsLora) {
        widgetNames.add("loras");
      }

      const hasTargetWidget = Array.from(widgetNames).some((name) =>
        targetWidgetNames.has(name),
      );
      if (!supportsLora && !hasTargetWidget) return;

      const directTitle = (node as { title?: unknown }).title;
      const titleFromProps = (node.properties as Record<string, unknown> | undefined)?.title;
      const title =
        typeof directTitle === "string" && directTitle.trim()
          ? directTitle.trim()
          : typeof titleFromProps === "string" && titleFromProps.trim()
            ? titleFromProps.trim()
            : node.type;

      nodesToRegister.push({
        node_id: nodeId,
        graph_id: graphId,
        graph_name: null,
        bgcolor: node.bgcolor ?? node.color ?? null,
        title,
        type: node.type,
        comfy_class: node.type,
        capabilities: {
          supports_lora: supportsLora,
          widget_names: Array.from(widgetNames),
        },
      });
    });

    if (nodesToRegister.length === 0) return;

    try {
      await api.registerLoraManagerNodes(nodesToRegister);
    } catch (error) {
      console.warn("[LoraManager] Failed to register nodes:", error);
    }
  };

  return {
    isLoraManagerAvailable: false,
    refreshLoraManagerAvailability: refreshAvailability,
    applyLoraCodeUpdate,
    applyTriggerWordUpdate,
    applyWidgetUpdate,
    syncTriggerWordsForNode,
    registerLoraManagerNodes,
  };
});
