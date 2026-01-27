import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { HistoryOutputImage, Workflow, WorkflowNode, WorkflowSubgraphDefinition, NodeTypes } from '@/api/types';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useWorkflowErrorsStore, type NodeError } from '@/hooks/useWorkflowErrors';
import * as api from '@/api/client';
import { useQueueStore } from '@/hooks/useQueue';
import { useNavigationStore } from '@/hooks/useNavigation';
import { usePinnedWidgetStore } from '@/hooks/usePinnedWidget';
import { useSeedStore } from '@/hooks/useSeed';
import {
  buildWorkflowPromptInputs,
  getWorkflowWidgetIndexMap,
  getWidgetValue,
  normalizeWidgetValue
} from '@/utils/workflowInputs';
import { buildWorkflowCacheKey } from '@/utils/workflowCacheKey';
import { expandWorkflowSubgraphs } from '@/utils/expandWorkflowSubgraphs';
import {
  type SeedMode,
  SPECIAL_SEED_RANDOM,
  SPECIAL_SEED_INCREMENT,
  SPECIAL_SEED_DECREMENT,
  DEFAULT_SPECIAL_SEED_RANGE,
  isSpecialSeedValue,
  getSpecialSeedMode,
  getSpecialSeedValueForMode,
  getWidgetIndexForInput,
  findSeedWidgetIndex,
  getSeedStep,
  getSeedRandomBounds,
  generateSeedFromNode,
  resolveSpecialSeedToUse
} from '@/utils/seedUtils';
import {
  getWidgetDefinitions,
  getInputWidgetDefinitions
} from '@/utils/widgetDefinitions';
import { findConnectedNode } from '@/utils/nodeOrdering';

// Re-export utilities for external consumers
export type { SeedMode };
export {
  SPECIAL_SEED_RANDOM,
  SPECIAL_SEED_INCREMENT,
  SPECIAL_SEED_DECREMENT,
  DEFAULT_SPECIAL_SEED_RANGE,
  isSpecialSeedValue,
  getSpecialSeedMode,
  getSpecialSeedValueForMode,
  findSeedWidgetIndex,
  getSeedStep,
  getSeedRandomBounds,
  generateSeedFromNode,
  resolveSpecialSeedToUse,
  getWidgetIndexForInput,
  getWidgetDefinitions,
  getInputWidgetDefinitions
};

// Internal type alias
type SeedModeType = SeedMode;
type SeedLastValues = Record<number, number | null>;
type MobileOrigin =
  | { scope: 'root'; nodeId: number }
  | { scope: 'subgraph'; subgraphId: string; nodeId: number };
const MOBILE_ORIGIN_KEY = '__mobile_origin';
const MOBILE_SUBGRAPH_GROUP_MAP_KEY = '__mobile_subgraph_group_map';

// Per-node UI state that we want to preserve
interface SavedNodeState {
  mode?: number; // bypass state
  flags?: { collapsed?: boolean };
  widgets_values?: unknown[] | Record<string, unknown>;
}

// Per-workflow saved state
interface SavedWorkflowState {
  nodes: Record<number, SavedNodeState>;
  seedModes: Record<number, SeedMode>;
  collapsedGroups?: Record<number, boolean>;
  hiddenGroups?: Record<number, boolean>;
  collapsedSubgraphs?: Record<string, boolean>;
  hiddenSubgraphs?: Record<string, boolean>;
  bookmarkedNodeIds?: number[];
}

// Node output images from execution
interface NodeOutputImage {
  filename: string;
  subfolder: string;
  type: string;
}

// Track where the workflow was loaded from for reload functionality
export type WorkflowSource =
  | { type: 'user'; filename: string }
  | { type: 'history'; promptId: string }
  | { type: 'template'; moduleName: string; templateName: string }
  | { type: 'other' };

interface WorkflowState {
  // Workflow source tracking for reload functionality
  workflowSource: WorkflowSource | null;

  // Workflow data
  workflow: Workflow | null;
  embedWorkflow: Workflow | null;
  originalWorkflow: Workflow | null; // For dirty check
  currentFilename: string | null;
  currentWorkflowKey: string | null;
  nodeTypes: NodeTypes | null;
  isLoading: boolean;

  // Per-workflow saved states (keyed by deterministic workflow cache key)
  savedWorkflowStates: Record<string, SavedWorkflowState>;

  // Execution state
  isExecuting: boolean;
  executingNodeId: string | null;
  executingPromptId: string | null; // Track the ID of the prompt being executed
  progress: number;
  executionStartTime: number | null;
  currentNodeStartTime: number | null;
  nodeDurationStats: Record<string, { avgMs: number; count: number }>;
  workflowDurationStats: Record<string, { avgMs: number; count: number }>;

  // Node output images (keyed by node ID)
  nodeOutputs: Record<string, NodeOutputImage[]>;
  // Prompt output images (keyed by prompt ID)
  promptOutputs: Record<string, HistoryOutputImage[]>;
  runCount: number;
  followQueue: boolean;
  workflowLoadedAt: number;
  connectionHighlightModes: Record<number, 'off' | 'inputs' | 'outputs' | 'both'>;
  connectionButtonsVisible: boolean;
  manuallyHiddenNodes: Record<number, boolean>;
  searchQuery: string;
  searchOpen: boolean;

  // Group state
  collapsedGroups: Record<number, boolean>;
  hiddenGroups: Record<number, boolean>;

  // Subgraph state
  collapsedSubgraphs: Record<string, boolean>;
  hiddenSubgraphs: Record<string, boolean>;


  // Actions
  loadWorkflow: (workflow: Workflow, filename?: string, options?: { fresh?: boolean; source?: WorkflowSource }) => void;
  unloadWorkflow: () => void;
  setSavedWorkflow: (workflow: Workflow, filename: string) => void;
  updateNodeWidget: (nodeId: number, widgetIndex: number, value: unknown, widgetName?: string) => void;
  updateNodeWidgets: (nodeId: number, updates: Record<number, unknown>) => void;
  updateNodeTitle: (nodeId: number, title: string | null) => void;
  toggleBypass: (nodeId: number) => void;
  toggleNodeFold: (nodeId: number) => void;
  setNodeFold: (nodeId: number, collapsed: boolean) => void;
  scrollToNode: (nodeId: number, label?: string) => void;
  ensureNodeExpanded: (nodeId: number) => void;
  setNodeTypes: (types: NodeTypes) => void;
  setExecutionState: (executing: boolean, nodeId: string | null, promptId: string | null, progress: number) => void;
  queueWorkflow: (count: number) => Promise<void>;
  saveCurrentWorkflowState: () => void;
  setNodeOutput: (nodeId: string, images: NodeOutputImage[]) => void;
  clearNodeOutputs: () => void;
  addPromptOutputs: (promptId: string, images: HistoryOutputImage[]) => void;
  clearPromptOutputs: (promptId?: string) => void;
  setRunCount: (count: number) => void;
  setFollowQueue: (followQueue: boolean) => void;
  cycleConnectionHighlight: (nodeId: number) => void;
  setConnectionHighlightMode: (nodeId: number, mode: 'off' | 'inputs' | 'outputs' | 'both') => void;
  toggleConnectionButtonsVisible: () => void;
  setConnectionButtonsVisible: (visible: boolean) => void;
  hideNode: (nodeId: number) => void;
  setNodeHidden: (nodeId: number, hidden: boolean) => void;
  revealNodeWithParents: (nodeId: number) => void;
  showAllHiddenNodes: () => void;
  toggleGroupCollapse: (groupId: number) => void;
  setGroupCollapsed: (groupId: number, collapsed: boolean) => void;
  toggleGroupHidden: (groupId: number) => void;
  setGroupHidden: (groupId: number, hidden: boolean) => void;
  toggleSubgraphHidden: (subgraphId: string) => void;
  setSubgraphHidden: (subgraphId: string, hidden: boolean) => void;
  bypassAllInGroup: (groupId: number, bypass: boolean, subgraphId?: string | null) => void;
  updateGroupTitle: (groupId: number, title: string, subgraphId?: string | null) => void;
  updateSubgraphTitle: (subgraphId: string, title: string) => void;
  showAllHiddenGroups: () => void;
  toggleSubgraphCollapse: (subgraphId: string) => void;
  setSubgraphCollapsed: (subgraphId: string, collapsed: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
  updateWorkflowDuration: (signature: string, durationMs: number) => void;
  clearWorkflowCache: () => void;
  applyControlAfterGenerate: () => void;
}

function normalizeWorkflowNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => ({
    ...node,
    widgets_values: node.widgets_values ?? [],
    inputs: node.inputs ?? [],
    outputs: node.outputs ?? [],
    flags: node.flags ?? {},
    properties: node.properties ?? {},
    mode: node.mode ?? 0,
    order: node.order ?? 0
  }));
}

function normalizeWorkflowForEmbed(workflow: Workflow): Workflow {
  const cloned = JSON.parse(JSON.stringify(workflow)) as Workflow;
  cloned.nodes = normalizeWorkflowNodes(cloned.nodes ?? []);
  cloned.links = cloned.links ?? [];
  cloned.groups = cloned.groups ?? [];
  cloned.config = cloned.config ?? {};
  if (cloned.definitions?.subgraphs) {
    cloned.definitions.subgraphs = cloned.definitions.subgraphs.map((subgraph) => ({
      ...subgraph,
      nodes: normalizeWorkflowNodes(subgraph.nodes ?? []),
      links: subgraph.links ?? []
    }));
  }
  cloned.last_node_id = cloned.last_node_id ?? Math.max(0, ...cloned.nodes.map((n) => n.id));
  cloned.last_link_id = cloned.last_link_id ?? 0;
  cloned.version = cloned.version ?? 0.4;
  return cloned;
}

function getMobileOrigin(node: WorkflowNode | undefined): MobileOrigin | null {
  if (!node) return null;
  const props = node.properties as Record<string, unknown> | undefined;
  const origin = props?.[MOBILE_ORIGIN_KEY];
  if (!origin || typeof origin !== 'object') return null;
  const scope = (origin as { scope?: string }).scope;
  if (scope === 'root') {
    const nodeId = (origin as { nodeId?: number }).nodeId;
    return typeof nodeId === 'number' ? { scope: 'root', nodeId } : null;
  }
  if (scope === 'subgraph') {
    const nodeId = (origin as { nodeId?: number }).nodeId;
    const subgraphId = (origin as { subgraphId?: string }).subgraphId;
    if (typeof nodeId === 'number' && typeof subgraphId === 'string') {
      return { scope: 'subgraph', subgraphId, nodeId };
    }
  }
  return null;
}

function computeNodeGroupsFor(
  nodes: WorkflowNode[],
  groups: Workflow['groups']
): Map<number, number> {
  const nodeToGroup = new Map<number, number>();
  if (!groups || groups.length === 0) return nodeToGroup;

  const sortedGroups = [...groups].sort((a, b) => a.id - b.id);
  for (const node of nodes) {
    const [nodeX, nodeY] = node.pos;
    const [nodeWidth, nodeHeight] = node.size;
    const centerX = nodeX + nodeWidth / 2;
    const centerY = nodeY + nodeHeight / 2;

    for (const group of sortedGroups) {
      const [groupX, groupY, groupWidth, groupHeight] = group.bounding;
      if (
        centerX >= groupX &&
        centerX <= groupX + groupWidth &&
        centerY >= groupY &&
        centerY <= groupY + groupHeight
      ) {
        nodeToGroup.set(node.id, group.id);
        break;
      }
    }
  }

  return nodeToGroup;
}

function collectDescendantSubgraphs(
  startIds: Iterable<string>,
  childMap: Map<string, Set<string>>
): Set<string> {
  const result = new Set<string>();
  const stack = Array.from(startIds);
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || result.has(current)) continue;
    result.add(current);
    const children = childMap.get(current);
    if (children) {
      for (const child of children) {
        if (!result.has(child)) stack.push(child);
      }
    }
  }
  return result;
}

function buildSubgraphParentMap(
  subgraphs: WorkflowSubgraphDefinition[]
): Map<string, Array<{ parentId: string; nodeId: number }>> {
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  const map = new Map<string, Array<{ parentId: string; nodeId: number }>>();
  for (const subgraph of subgraphs) {
    for (const node of subgraph.nodes ?? []) {
      if (!subgraphIds.has(node.type)) continue;
      const entry = map.get(node.type) ?? [];
      entry.push({ parentId: subgraph.id, nodeId: node.id });
      map.set(node.type, entry);
    }
  }
  return map;
}

function getGroupIdForNode(
  targetNodeId: number,
  nodes: WorkflowNode[],
  groups: Workflow['groups']
): number | null {
  if (!groups || groups.length === 0) return null;
  const nodeToGroup = computeNodeGroupsFor(nodes, groups);
  return nodeToGroup.get(targetNodeId) ?? null;
}

export function collectBypassGroupTargetNodeIds(
  workflow: Workflow,
  groupId: number,
  subgraphId: string | null = null
): Set<number> {
  const nodes = workflow.nodes ?? [];
  const groups = workflow.groups ?? [];
  const subgraphs = workflow.definitions?.subgraphs ?? [];

  const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));
  const subgraphIds = new Set(subgraphs.map((sg) => sg.id));
  const nodesBySubgraph = new Map<string, WorkflowNode[]>();
  const rootNodes: WorkflowNode[] = [];

  for (const node of nodes) {
    const origin = getMobileOrigin(node);
    if (origin?.scope === 'subgraph') {
      const bucket = nodesBySubgraph.get(origin.subgraphId);
      if (bucket) {
        bucket.push(node);
      } else {
        nodesBySubgraph.set(origin.subgraphId, [node]);
      }
    } else {
      rootNodes.push(node);
    }
  }

  const subgraphChildMap = new Map<string, Set<string>>();
  for (const subgraph of subgraphs) {
    const children = new Set<string>();
    for (const node of subgraph.nodes ?? []) {
      if (subgraphIds.has(node.type)) {
        children.add(node.type);
      }
    }
    if (children.size > 0) {
      subgraphChildMap.set(subgraph.id, children);
    }
  }

  const targetNodeIds = new Set<number>();

  if (subgraphId) {
    const subgraph = subgraphById.get(subgraphId);
    if (!subgraph) return targetNodeIds;
    const subgraphGroups = subgraph.groups ?? [];
    const group = subgraphGroups.find((g) => g.id === groupId);
    if (!group) return targetNodeIds;

    const subgraphNodes = subgraph.nodes ?? [];
    const nodeToGroup = computeNodeGroupsFor(subgraphNodes, subgraphGroups);
    const nestedSubgraphIds = new Set<string>();
    const directNodeOriginIds = new Set<number>();

    for (const node of subgraphNodes) {
      if (nodeToGroup.get(node.id) !== groupId) continue;
      if (subgraphIds.has(node.type)) {
        nestedSubgraphIds.add(node.type);
      } else {
        directNodeOriginIds.add(node.id);
      }
    }

    const scopedNodes = nodesBySubgraph.get(subgraphId) ?? [];
    for (const node of scopedNodes) {
      const origin = getMobileOrigin(node);
      if (origin?.scope !== 'subgraph') continue;
      if (directNodeOriginIds.has(origin.nodeId)) {
        targetNodeIds.add(node.id);
      }
    }

    const descendantSubgraphs = collectDescendantSubgraphs(
      nestedSubgraphIds,
      subgraphChildMap
    );
    for (const nestedId of descendantSubgraphs) {
      const nestedNodes = nodesBySubgraph.get(nestedId) ?? [];
      for (const node of nestedNodes) {
        targetNodeIds.add(node.id);
      }
    }
  } else {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return targetNodeIds;

    const nodeToGroup = computeNodeGroupsFor(rootNodes, groups);
    for (const node of rootNodes) {
      if (nodeToGroup.get(node.id) === groupId) {
        targetNodeIds.add(node.id);
      }
    }

    const rawSubgraphGroupMap =
      (workflow.extra as Record<string, unknown> | undefined)?.[
        MOBILE_SUBGRAPH_GROUP_MAP_KEY
      ];
    const directSubgraphIds = new Set<string>();
    if (rawSubgraphGroupMap && typeof rawSubgraphGroupMap === 'object') {
      for (const [key, value] of Object.entries(
        rawSubgraphGroupMap as Record<string, unknown>
      )) {
        if (value === groupId) {
          directSubgraphIds.add(key);
        }
      }
    }

    const descendantSubgraphs = collectDescendantSubgraphs(
      directSubgraphIds,
      subgraphChildMap
    );
    for (const subgraphId of descendantSubgraphs) {
      const subgraphNodes = nodesBySubgraph.get(subgraphId) ?? [];
      for (const node of subgraphNodes) {
        targetNodeIds.add(node.id);
      }
    }
  }

  return targetNodeIds;
}

function updateNodeWidgetValues(
  node: WorkflowNode,
  widgetIndex: number,
  value: unknown,
  widgetName?: string
): WorkflowNode {
  if (!Array.isArray(node.widgets_values)) {
    const nextValues = { ...(node.widgets_values || {}) } as Record<string, unknown>;
    if (widgetName) {
      nextValues[widgetName] = value;
      if (node.type === 'VHS_VideoCombine' && widgetName === 'save_image' && 'save_output' in nextValues) {
        nextValues.save_output = value;
      }
    } else if (widgetIndex >= 0) {
      nextValues[String(widgetIndex)] = value;
    }
    return { ...node, widgets_values: nextValues };
  }

  let newWidgetValues = [...node.widgets_values];
  if (widgetIndex >= newWidgetValues.length) {
    newWidgetValues.push(value);
  } else {
    newWidgetValues[widgetIndex] = value;
  }

  if (node.type === 'Power Lora Loader (rgthree)') {
    newWidgetValues = newWidgetValues.filter((v) => v !== null);
  }

  return { ...node, widgets_values: newWidgetValues };
}

function updateNodeWidgetsValues(
  node: WorkflowNode,
  updates: Record<number, unknown>
): WorkflowNode {
  if (!Array.isArray(node.widgets_values)) {
    return node;
  }
  const newWidgetValues = [...node.widgets_values];
  for (const [idxStr, value] of Object.entries(updates)) {
    const idx = parseInt(idxStr, 10);
    newWidgetValues[idx] = value;
  }
  return { ...node, widgets_values: newWidgetValues };
}

function updateEmbedWorkflowFromExpandedNode(
  embedWorkflow: Workflow,
  expandedNode: WorkflowNode
): Workflow {
  const origin = getMobileOrigin(expandedNode) ?? { scope: 'root', nodeId: expandedNode.id };

  if (origin.scope === 'root') {
    const nextNodes = embedWorkflow.nodes.map((node) =>
      node.id === origin.nodeId ? { ...node, widgets_values: expandedNode.widgets_values ?? [] } : node
    );
    return { ...embedWorkflow, nodes: nextNodes };
  }

  const subgraphs = embedWorkflow.definitions?.subgraphs;
  if (!subgraphs) return embedWorkflow;

  const nextSubgraphs = subgraphs.map((subgraph) => {
    if (subgraph.id !== origin.subgraphId) return subgraph;
    const nextNodes = subgraph.nodes.map((node) =>
      node.id === origin.nodeId ? { ...node, widgets_values: expandedNode.widgets_values ?? [] } : node
    );
    return { ...subgraph, nodes: nextNodes };
  });

  return {
    ...embedWorkflow,
    definitions: {
      ...embedWorkflow.definitions,
      subgraphs: nextSubgraphs
    }
  };
}

function inferSeedMode(workflow: Workflow, nodeTypes: NodeTypes, node: WorkflowNode): SeedModeType {
  const validModes = ['fixed', 'randomize', 'increment', 'decrement'];
  if (Array.isArray(node.widgets_values)) {
    const modeValue = node.widgets_values.find((value) =>
      typeof value === 'string' && validModes.includes(value.toLowerCase())
    );
    if (typeof modeValue === 'string') {
      const lowered = modeValue.toLowerCase();
      if (validModes.includes(lowered)) {
        return lowered as SeedMode;
      }
    }
  }

  const seedIndex = findSeedWidgetIndex(workflow, nodeTypes, node);
  if (seedIndex !== null && Array.isArray(node.widgets_values)) {
    const seedValue = Number(node.widgets_values[seedIndex]);
    const specialMode = getSpecialSeedMode(seedValue);
    if (specialMode) {
      return specialMode;
    }
    const outputs = node.outputs ?? [];
    const hasSeedOutput = outputs.some((output) =>
      String(output.name || '').toLowerCase().includes('seed') &&
      String(output.type || '').toUpperCase().includes('INT')
    );
    const trailingWidgets = node.widgets_values.slice(seedIndex + 1);
    const hasEmptyTrailingWidgets = trailingWidgets.length > 0 &&
      trailingWidgets.every((value) => value === '' || value === null || value === undefined);
    const hasSeedRangeProps = node.properties && ('randomMin' in node.properties || 'randomMax' in node.properties);
    if (hasSeedOutput && hasEmptyTrailingWidgets && hasSeedRangeProps) {
      return 'randomize';
    }
  }

  return 'fixed';
}

function collectWorkflowLoadErrors(
  workflow: Workflow,
  nodeTypes: NodeTypes
): Record<string, NodeError[]> {
  const errors: Record<string, NodeError[]> = {};

  for (const node of workflow.nodes) {
    const typeDef = nodeTypes[node.type];
    if (!typeDef?.input) continue;

    const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
    const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
    const orderedInputs = [...requiredOrder, ...optionalOrder];

    for (const name of orderedInputs) {
      const inputDef = typeDef.input.required?.[name] || typeDef.input.optional?.[name];
      if (!inputDef) continue;

      const [typeOrOptions] = inputDef;
      if (!Array.isArray(typeOrOptions)) continue;
      if (typeOrOptions.length === 0) continue;

      const inputEntry = node.inputs.find((input) => input.name === name);
      if (inputEntry?.link != null) continue;

      const widgetIndex = getWidgetIndexForInput(workflow, nodeTypes, node, name);
      if (widgetIndex === null) continue;

      const rawValue = getWidgetValue(node, name, widgetIndex);
      if (rawValue === undefined || rawValue === null) continue;

      const normalized = normalizeWidgetValue(rawValue, typeOrOptions, { comboIndexToValue: true });
      const normalizedString = String(normalized);
      const normalizedBase = normalizedString.split(/[\\/]/).pop() ?? normalizedString;
      const hasMatch = typeOrOptions.some((opt) => {
        const optString = String(opt);
        return optString === normalizedString || optString === normalizedBase;
      });

      if (!hasMatch) {
        const nodeId = String(node.id);
        if (!errors[nodeId]) {
          errors[nodeId] = [];
        }
        errors[nodeId].push({
          type: 'workflow_load',
          message: `Missing value: ${normalizedString}`,
          details: 'Not found on server.',
          inputName: name
        });
      }
    }
  }

  return errors;
}


export const useWorkflowStore = create<WorkflowState>()(
  persist(
    (set, get) => {
      const applyNodeErrors = (errors: Record<string, NodeError[]>) => {
        const { manuallyHiddenNodes } = get();
        const errorNodeIds = Object.keys(errors);
        const nodesToUnhide = errorNodeIds.filter((id) => manuallyHiddenNodes[Number(id)]);
        if (nodesToUnhide.length > 0) {
          const newHiddenNodes = { ...manuallyHiddenNodes };
          for (const id of nodesToUnhide) {
            delete newHiddenNodes[Number(id)];
          }
          set({ manuallyHiddenNodes: newHiddenNodes });
        }
        useWorkflowErrorsStore.getState().setNodeErrors(errors);
      };

      return {
      workflowSource: null,
      workflow: null,
      embedWorkflow: null,
      originalWorkflow: null,
      currentFilename: null,
      currentWorkflowKey: null,
      nodeTypes: null,
      isLoading: false,
      savedWorkflowStates: {},
      isExecuting: false,
      executingNodeId: null,
      executingPromptId: null,
      progress: 0,
      executionStartTime: null,
      currentNodeStartTime: null,
      nodeDurationStats: {},
      workflowDurationStats: {},
      nodeOutputs: {},
      promptOutputs: {},
      runCount: 1,
      followQueue: false,
      workflowLoadedAt: 0,
      connectionHighlightModes: {},
      connectionButtonsVisible: true,
      manuallyHiddenNodes: {},
      searchQuery: '',
      searchOpen: false,
      collapsedGroups: {},
      hiddenGroups: {},
      collapsedSubgraphs: {},
      hiddenSubgraphs: {},

      setNodeOutput: (nodeId, images) => {
        set((state) => ({
          nodeOutputs: {
            ...state.nodeOutputs,
            [nodeId]: images,
          },
        }));
      },

      clearNodeOutputs: () => {
        set({ nodeOutputs: {} });
      },

      addPromptOutputs: (promptId, images) => {
        if (!promptId || images.length === 0) return;
        set((state) => ({
          promptOutputs: {
            ...state.promptOutputs,
            [promptId]: [...(state.promptOutputs[promptId] ?? []), ...images]
          }
        }));
      },

      clearPromptOutputs: (promptId) => {
        if (!promptId) {
          set({ promptOutputs: {} });
          return;
        }
        set((state) => {
          if (!state.promptOutputs[promptId]) return state;
          const next = { ...state.promptOutputs };
          delete next[promptId];
          return { promptOutputs: next };
        });
      },



      setRunCount: (count) => {
        set({ runCount: Math.max(1, Math.floor(count)) });
      },

      setFollowQueue: (followQueue) => {
        set({ followQueue });
      },


      cycleConnectionHighlight: (nodeId) => {
        set((state) => {
          const current = state.connectionHighlightModes[nodeId] ?? 'off';
          const next = current === 'off'
            ? 'inputs'
            : current === 'inputs'
              ? 'outputs'
              : current === 'outputs'
                ? 'both'
                : 'off';
          return {
            connectionHighlightModes: {
              ...state.connectionHighlightModes,
              [nodeId]: next
            }
          };
        });
      },

      setConnectionHighlightMode: (nodeId, mode) => {
        set((state) => ({
          connectionHighlightModes: {
            ...state.connectionHighlightModes,
            [nodeId]: mode
          }
        }));
      },

      toggleConnectionButtonsVisible: () => {
        set((state) => ({ connectionButtonsVisible: !state.connectionButtonsVisible }));
      },

      setConnectionButtonsVisible: (visible) => {
        set({ connectionButtonsVisible: visible });
      },

      hideNode: (nodeId) => {
        set((state) => ({
          manuallyHiddenNodes: {
            ...state.manuallyHiddenNodes,
            [nodeId]: true
          }
        }));
      },

      setNodeHidden: (nodeId, hidden) => {
        set((state) => {
          const next = { ...state.manuallyHiddenNodes };
          if (hidden) {
            next[nodeId] = true;
          } else {
            delete next[nodeId];
          }
          return { manuallyHiddenNodes: next };
        });
      },

      revealNodeWithParents: (nodeId) => {
        const { workflow } = get();
        if (!workflow) return;
        const subgraphs = workflow.definitions?.subgraphs ?? [];
        console.log('[revealNodeWithParents] start', {
          nodeId,
          rootNodeCount: workflow.nodes?.length ?? 0,
          subgraphCount: subgraphs.length
        });
        let node = workflow.nodes.find((entry) => entry.id === nodeId);
        if (!node) {
          for (const subgraph of subgraphs) {
            const found = subgraph.nodes?.find((entry) => entry.id === nodeId);
            if (found) {
              node = found;
              break;
            }
          }
        }
        if (!node) {
          console.log('[revealNodeWithParents] node not found', {
            nodeId,
            rootIds: workflow.nodes?.slice(0, 5).map((n) => n.id),
            subgraphSummaries: subgraphs.map((sg) => ({
              id: sg.id,
              nodeCount: sg.nodes?.length ?? 0,
              sampleIds: sg.nodes?.slice(0, 5).map((n) => n.id) ?? []
            }))
          });
          return;
        }

        const subgraphById = new Map(subgraphs.map((sg) => [sg.id, sg]));
        const parentMap = buildSubgraphParentMap(subgraphs);
        const origin = getMobileOrigin(node);
        const rootNodes = workflow.nodes.filter(
          (entry) => getMobileOrigin(entry)?.scope !== 'subgraph'
        );
        const startingNodeId = origin?.scope === 'subgraph' ? origin.nodeId : node.id;
        const collectParentIds = () => {
          const parents = new Set<number>();
          const stack = [startingNodeId];
          if (origin?.scope === 'subgraph') {
            const subgraph = subgraphById.get(origin.subgraphId);
            const incoming = new Map<number, number[]>();
            subgraph?.links?.forEach((link) => {
              const list = incoming.get(link.target_id) ?? [];
              list.push(link.origin_id);
              incoming.set(link.target_id, list);
            });
            while (stack.length > 0) {
              const current = stack.pop();
              if (current === undefined) continue;
              const parentList = incoming.get(current) ?? [];
              parentList.forEach((parentId) => {
                if (parents.has(parentId)) return;
                parents.add(parentId);
                stack.push(parentId);
              });
            }
            return parents;
          }
          while (stack.length > 0) {
            const current = stack.pop();
            if (current === undefined) continue;
            const currentNode = workflow.nodes.find((entry) => entry.id === current);
            if (!currentNode) continue;
            currentNode.inputs?.forEach((input, index) => {
              if (input.link === null) return;
              const connected = findConnectedNode(workflow, current, index);
              if (!connected) return;
              const parentId = connected.node.id;
              if (parents.has(parentId)) return;
              parents.add(parentId);
              stack.push(parentId);
            });
          }
          return parents;
        };
        const parentIds = collectParentIds();
        console.log('[revealNodeWithParents] parents', {
          nodeId,
          parentCount: parentIds.size,
          parents: Array.from(parentIds).slice(0, 20)
        });
        console.log('[revealNodeWithParents] found node', {
          nodeId: node.id,
          origin,
          hasGroups: (workflow.groups?.length ?? 0) > 0,
          hiddenNodeCount: Object.keys(get().manuallyHiddenNodes ?? {}).length
        });

        set((state) => {
          const nextHiddenNodes = { ...state.manuallyHiddenNodes };
          delete nextHiddenNodes[nodeId];
          parentIds.forEach((parentId) => {
            delete nextHiddenNodes[parentId];
          });
          const nextHiddenGroups = { ...state.hiddenGroups };
          const nextHiddenSubgraphs = { ...state.hiddenSubgraphs };
          const nextCollapsedGroups = { ...state.collapsedGroups };
          const nextCollapsedSubgraphs = { ...state.collapsedSubgraphs };

          const revealGroup = (groupId: number | null | undefined) => {
            if (groupId === null || groupId === undefined) return;
            delete nextHiddenGroups[groupId];
            nextCollapsedGroups[groupId] = false;
          };

          const expandSubgraph = (subgraphId: string | null | undefined) => {
            if (!subgraphId) return;
            nextCollapsedSubgraphs[subgraphId] = false;
            delete nextHiddenSubgraphs[subgraphId];
          };

          if (!origin || origin.scope === 'root') {
            const groupId = getGroupIdForNode(node.id, rootNodes, workflow.groups ?? []);
            console.log('[revealNodeWithParents] root origin', {
              nodeId,
              groupId
            });
            revealGroup(groupId);
            parentIds.forEach((parentId) => {
              const parentGroupId = getGroupIdForNode(parentId, rootNodes, workflow.groups ?? []);
              revealGroup(parentGroupId);
            });
          } else {
            expandSubgraph(origin.subgraphId);
            const subgraph = subgraphById.get(origin.subgraphId);
            if (subgraph) {
              const groupId = getGroupIdForNode(
                origin.nodeId,
                subgraph.nodes ?? [],
                subgraph.groups ?? []
              );
              console.log('[revealNodeWithParents] subgraph origin', {
                nodeId,
                subgraphId: origin.subgraphId,
                groupId
              });
              revealGroup(groupId);
            }

            const rawSubgraphGroupMap =
              (workflow.extra as Record<string, unknown> | undefined)?.[
                MOBILE_SUBGRAPH_GROUP_MAP_KEY
              ];
            const rootGroupId =
              rawSubgraphGroupMap && typeof rawSubgraphGroupMap === 'object'
                ? (rawSubgraphGroupMap as Record<string, unknown>)[origin.subgraphId]
                : undefined;
            if (typeof rootGroupId === 'number') {
              console.log('[revealNodeWithParents] root group mapping', {
                subgraphId: origin.subgraphId,
                rootGroupId
              });
              revealGroup(rootGroupId);
            }

            if (subgraph) {
              parentIds.forEach((parentId) => {
                const parentGroupId = getGroupIdForNode(
                  parentId,
                  subgraph.nodes ?? [],
                  subgraph.groups ?? []
                );
                revealGroup(parentGroupId);
              });
            }

            const stack = [origin.subgraphId];
            const visited = new Set<string>();
            while (stack.length > 0) {
              const current = stack.pop();
              if (!current || visited.has(current)) continue;
              visited.add(current);
              const parents = parentMap.get(current) ?? [];
              console.log('[revealNodeWithParents] parent chain', {
                current,
                parentCount: parents.length
              });
              for (const parent of parents) {
                expandSubgraph(parent.parentId);
                const parentDef = subgraphById.get(parent.parentId);
                if (parentDef) {
                  const parentGroupId = getGroupIdForNode(
                    parent.nodeId,
                    parentDef.nodes ?? [],
                    parentDef.groups ?? []
                  );
                  console.log('[revealNodeWithParents] parent expand', {
                    parentId: parent.parentId,
                    parentNodeId: parent.nodeId,
                    parentGroupId
                  });
                  revealGroup(parentGroupId);
                }
                if (!visited.has(parent.parentId)) {
                  stack.push(parent.parentId);
                }
              }
            }
          }

          return {
            manuallyHiddenNodes: nextHiddenNodes,
            hiddenGroups: nextHiddenGroups,
            hiddenSubgraphs: nextHiddenSubgraphs,
            collapsedGroups: nextCollapsedGroups,
            collapsedSubgraphs: nextCollapsedSubgraphs
          };
        });
      },

      showAllHiddenNodes: () => {
        set({
          manuallyHiddenNodes: {},
          hiddenGroups: {},
          hiddenSubgraphs: {}
        });
      },

      toggleGroupCollapse: (groupId) => {
        set((state) => {
          const isCollapsed = state.collapsedGroups[groupId] ?? true;
          return {
            collapsedGroups: {
              ...state.collapsedGroups,
              [groupId]: !isCollapsed
            }
          };
        });
      },

      setGroupCollapsed: (groupId, collapsed) => {
        set((state) => {
          const next = { ...state.collapsedGroups };
          if (collapsed) {
            next[groupId] = true;
          } else {
            delete next[groupId];
          }
          return { collapsedGroups: next };
        });
      },

      toggleGroupHidden: (groupId) => {
        set((state) => ({
          hiddenGroups: {
            ...state.hiddenGroups,
            [groupId]: !state.hiddenGroups[groupId]
          }
        }));
      },

      setGroupHidden: (groupId, hidden) => {
        set((state) => {
          const next = { ...state.hiddenGroups };
          if (hidden) {
            next[groupId] = true;
          } else {
            delete next[groupId];
          }
          return { hiddenGroups: next };
        });
      },

      toggleSubgraphHidden: (subgraphId) => {
        set((state) => ({
          hiddenSubgraphs: {
            ...state.hiddenSubgraphs,
            [subgraphId]: !state.hiddenSubgraphs[subgraphId]
          }
        }));
      },

      setSubgraphHidden: (subgraphId, hidden) => {
        set((state) => {
          const next = { ...state.hiddenSubgraphs };
          if (hidden) {
            next[subgraphId] = true;
          } else {
            delete next[subgraphId];
          }
          return { hiddenSubgraphs: next };
        });
      },

      updateGroupTitle: (groupId, title, subgraphId) => {
        const { workflow } = get();
        if (!workflow) return;
        const nextTitle = title.trim();
        if (subgraphId) {
          const subgraphs = workflow.definitions?.subgraphs ?? [];
          const nextSubgraphs = subgraphs.map((subgraph) => {
            if (subgraph.id !== subgraphId) return subgraph;
            const groups = subgraph.groups ?? [];
            const nextGroups = groups.map((group) =>
              group.id === groupId ? { ...group, title: nextTitle } : group
            );
            return { ...subgraph, groups: nextGroups };
          });
          useWorkflowErrorsStore.getState().setError(null);
          set({
            workflow: {
              ...workflow,
              definitions: { ...(workflow.definitions ?? {}), subgraphs: nextSubgraphs }
            }
          });
          return;
        }
        const nextGroups = (workflow.groups ?? []).map((group) =>
          group.id === groupId ? { ...group, title: nextTitle } : group
        );
        set({ workflow: { ...workflow, groups: nextGroups } });
      },

      updateSubgraphTitle: (subgraphId, title) => {
        const { workflow } = get();
        if (!workflow) return;
        const nextTitle = title.trim();
        const subgraphs = workflow.definitions?.subgraphs ?? [];
        const nextSubgraphs = subgraphs.map((subgraph) =>
          subgraph.id === subgraphId ? { ...subgraph, name: nextTitle } : subgraph
        );
        set({
          workflow: {
            ...workflow,
            definitions: { ...(workflow.definitions ?? {}), subgraphs: nextSubgraphs }
          }
        });
      },

      bypassAllInGroup: (groupId, bypass, subgraphId = null) => {
        const { workflow } = get();
        if (!workflow) return;

        const targetNodeIds = collectBypassGroupTargetNodeIds(
          workflow,
          groupId,
          subgraphId
        );
        if (targetNodeIds.size === 0) return;

        const mode = bypass ? 4 : 0;
        const newNodes = (workflow.nodes ?? []).map((node) =>
          targetNodeIds.has(node.id) ? { ...node, mode } : node
        );

        set({ workflow: { ...workflow, nodes: newNodes } });
      },

      showAllHiddenGroups: () => {
        set({ hiddenGroups: {} });
      },

      toggleSubgraphCollapse: (subgraphId) => {
        set((state) => ({
          collapsedSubgraphs: {
            ...state.collapsedSubgraphs,
            [subgraphId]: !(state.collapsedSubgraphs[subgraphId] ?? true)
          }
        }));
      },

      setSubgraphCollapsed: (subgraphId, collapsed) => {
        set((state) => ({
          collapsedSubgraphs: {
            ...state.collapsedSubgraphs,
            [subgraphId]: collapsed
          }
        }));
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      setSearchOpen: (open) => {
        set({ searchOpen: open });
      },

      updateWorkflowDuration: (signature, durationMs) => {
        if (!signature || durationMs <= 0) return;
        set((state) => {
          const prev = state.workflowDurationStats[signature];
          const count = (prev?.count ?? 0) + 1;
          const avgMs = prev ? (prev.avgMs * prev.count + durationMs) / count : durationMs;
          return {
            workflowDurationStats: {
              ...state.workflowDurationStats,
              [signature]: { avgMs, count }
            }
          };
        });
      },

      clearWorkflowCache: () => {
        const { currentWorkflowKey, savedWorkflowStates, originalWorkflow, nodeTypes } = get();
        const nextSavedStates = { ...savedWorkflowStates };
        if (currentWorkflowKey) {
          delete nextSavedStates[currentWorkflowKey];
          usePinnedWidgetStore.getState().clearPinnedWidgetForKey(currentWorkflowKey);
        } else {
          usePinnedWidgetStore.getState().clearCurrentPin();
        }

        if (!originalWorkflow) {
          useSeedStore.getState().setSeedModes({});
          useSeedStore.getState().setSeedLastValues({});
          set({
            savedWorkflowStates: nextSavedStates,
          });
          return;
        }

        const seedModes: Record<number, SeedMode> = {};
        if (nodeTypes) {
          for (const node of originalWorkflow.nodes) {
            const seedWidgetIndex = findSeedWidgetIndex(originalWorkflow, nodeTypes, node);
            if (seedWidgetIndex !== null) {
              seedModes[node.id] = inferSeedMode(originalWorkflow, nodeTypes, node);
            }
          }
        }

        useSeedStore.getState().setSeedModes(seedModes);
        useSeedStore.getState().setSeedLastValues({});
        useWorkflowErrorsStore.getState().setError(null);
        set({
          workflow: JSON.parse(JSON.stringify(originalWorkflow)),
          savedWorkflowStates: nextSavedStates,
          runCount: 1,
          workflowLoadedAt: Date.now(),
        });
      },

      saveCurrentWorkflowState: () => {
        const { workflow, currentWorkflowKey, savedWorkflowStates, collapsedGroups, hiddenGroups, collapsedSubgraphs, hiddenSubgraphs } = get();
        const seedModes = useSeedStore.getState().seedModes;
        if (!workflow || !currentWorkflowKey) return;
        const savedBookmarks = savedWorkflowStates[currentWorkflowKey]?.bookmarkedNodeIds ?? [];

        // Save current workflow's UI state
        const nodeStates: Record<number, SavedNodeState> = {};
        for (const node of workflow.nodes) {
          nodeStates[node.id] = {
            mode: node.mode,
            flags: node.flags ? { collapsed: Boolean(node.flags.collapsed) } : undefined,
            widgets_values: node.widgets_values,
          };
        }

        set({
          savedWorkflowStates: {
            ...savedWorkflowStates,
            [currentWorkflowKey]: {
              nodes: nodeStates,
              seedModes: { ...seedModes },
              collapsedGroups: { ...collapsedGroups },
              hiddenGroups: { ...hiddenGroups },
              collapsedSubgraphs: { ...collapsedSubgraphs },
              hiddenSubgraphs: { ...hiddenSubgraphs },
              bookmarkedNodeIds: [...savedBookmarks],
            },
          },
        });
      },

      loadWorkflow: (workflow, filename, options) => {
        const { currentFilename, savedWorkflowStates, nodeTypes } = get();
        const fresh = options?.fresh ?? false;
        const source = options?.source ?? { type: 'other' as const };
        const expandedWorkflow = expandWorkflowSubgraphs(workflow);
        const normalizedEmbedWorkflow = normalizeWorkflowForEmbed(workflow);

        // Normalize workflow to ensure required fields exist
        const normalizedNodes = normalizeWorkflowNodes(expandedWorkflow.nodes);

        const normalizedWorkflow: Workflow = {
          ...expandedWorkflow,
          nodes: normalizedNodes,
          links: expandedWorkflow.links ?? [],
          groups: expandedWorkflow.groups ?? [],
          config: expandedWorkflow.config ?? {},
          last_node_id: expandedWorkflow.last_node_id ?? Math.max(0, ...normalizedNodes.map(n => n.id)),
          last_link_id: expandedWorkflow.last_link_id ?? 0,
          version: expandedWorkflow.version ?? 0.4,
        };
        const workflowKey = buildWorkflowCacheKey(normalizedWorkflow, nodeTypes);
        const pinnedStore = usePinnedWidgetStore.getState();
        const legacyPin = filename ? pinnedStore.pinnedWidgets[filename] : undefined;
        if (legacyPin && !pinnedStore.pinnedWidgets[workflowKey]) {
          pinnedStore.setPinnedWidget(legacyPin, workflowKey);
        }
        pinnedStore.restorePinnedWidgetForWorkflow(workflowKey, normalizedWorkflow);

        // Save current workflow state before switching
        if (currentFilename) {
          get().saveCurrentWorkflowState();
        }

        // If loading fresh, clear any saved state for this workflow
        if (fresh && savedWorkflowStates[workflowKey]) {
          const newSavedStates = { ...savedWorkflowStates };
          delete newSavedStates[workflowKey];
          set({ savedWorkflowStates: newSavedStates });
        }

        // Initialize seed modes from workflow
        const seedModes: Record<number, SeedMode> = {};
        if (nodeTypes) {
          for (const node of normalizedWorkflow.nodes) {
            const seedWidgetIndex = findSeedWidgetIndex(normalizedWorkflow, nodeTypes, node);
            if (seedWidgetIndex !== null) {
              seedModes[node.id] = inferSeedMode(normalizedWorkflow, nodeTypes, node);
            }
          }
        }

        // Check if we have saved state for this workflow (skip if loading fresh)
        let savedState = (!fresh) ? savedWorkflowStates[workflowKey] : null;
        if (!savedState && !fresh && filename && savedWorkflowStates[filename]) {
          savedState = savedWorkflowStates[filename];
          set({
            savedWorkflowStates: {
              ...savedWorkflowStates,
              [workflowKey]: savedWorkflowStates[filename],
            }
          });
        }

        // Initialize all subgraphs as collapsed by default
        const subgraphs = workflow.definitions?.subgraphs ?? [];
        const defaultCollapsedSubgraphs: Record<string, boolean> = {};
        for (const sg of subgraphs) {
          defaultCollapsedSubgraphs[sg.id] = true;
        }

        const defaultCollapsedGroups: Record<number, boolean> = {};
        for (const group of normalizedWorkflow.groups ?? []) {
          defaultCollapsedGroups[group.id] = true;
        }
        for (const sg of subgraphs) {
          for (const group of sg.groups ?? []) {
            defaultCollapsedGroups[group.id] = true;
          }
        }

        let finalWorkflow = normalizedWorkflow;

        if (savedState) {
          // Restore saved UI state
          const restoredNodes = normalizedWorkflow.nodes.map((node) => {
            const savedNodeState = savedState.nodes[node.id];
            if (!savedNodeState) return node;

            return {
              ...node,
              mode: savedNodeState.mode ?? node.mode,
              flags: savedNodeState.flags ?? node.flags,
              widgets_values: savedNodeState.widgets_values ?? node.widgets_values,
            };
          });

          const restoredWorkflow = { ...normalizedWorkflow, nodes: restoredNodes };
          finalWorkflow = restoredWorkflow;
          let syncedEmbedWorkflow = normalizedEmbedWorkflow;
          if (syncedEmbedWorkflow) {
            for (const node of restoredNodes) {
              syncedEmbedWorkflow = updateEmbedWorkflowFromExpandedNode(syncedEmbedWorkflow, node);
            }
          }

          set({
            workflowSource: source,
            workflow: restoredWorkflow,
            embedWorkflow: syncedEmbedWorkflow,
            originalWorkflow: JSON.parse(JSON.stringify(normalizedWorkflow)), // Keep original for dirty check
            currentFilename: filename || null,
            currentWorkflowKey: workflowKey,
            collapsedGroups: {
              ...defaultCollapsedGroups,
              ...(savedState.collapsedGroups ?? {})
            },
            hiddenGroups: savedState.hiddenGroups ?? {},
            collapsedSubgraphs: { ...defaultCollapsedSubgraphs, ...(savedState.collapsedSubgraphs ?? {}) },
            hiddenSubgraphs: savedState.hiddenSubgraphs ?? {},
            runCount: 1,
            followQueue: false,
            workflowLoadedAt: Date.now(),
          });
          useSeedStore.getState().setSeedModes({ ...seedModes, ...savedState.seedModes });
          useSeedStore.getState().setSeedLastValues({});
          useNavigationStore.getState().setCurrentPanel('workflow');
          useImageViewerStore.getState().setViewerState({
            viewerOpen: false,
            viewerImages: [],
            viewerIndex: 0,
            viewerScale: 1,
            viewerTranslate: { x: 0, y: 0 },
          });
        } else {
          useWorkflowErrorsStore.getState().setError(null);
          set({
            workflowSource: source,
            workflow: normalizedWorkflow,
            embedWorkflow: normalizedEmbedWorkflow,
            originalWorkflow: JSON.parse(JSON.stringify(normalizedWorkflow)),
            currentFilename: filename || null,
            currentWorkflowKey: workflowKey,
            collapsedGroups: defaultCollapsedGroups,
            hiddenGroups: {},
            collapsedSubgraphs: defaultCollapsedSubgraphs,
            hiddenSubgraphs: {},
            runCount: 1,
            followQueue: false,
            workflowLoadedAt: Date.now(),
          });
          useSeedStore.getState().setSeedModes(seedModes);
          useSeedStore.getState().setSeedLastValues({});
          useNavigationStore.getState().setCurrentPanel('workflow');
          useImageViewerStore.getState().setViewerState({
            viewerOpen: false,
            viewerImages: [],
            viewerIndex: 0,
            viewerScale: 1,
            viewerTranslate: { x: 0, y: 0 },
          });
        }

        if (nodeTypes) {
          const loadErrors = collectWorkflowLoadErrors(finalWorkflow, nodeTypes);
          const loadErrorCount = Object.values(loadErrors)
            .reduce((total, nodeErrs) => total + nodeErrs.length, 0);

          if (loadErrorCount > 0) {
            applyNodeErrors(loadErrors);
            useWorkflowErrorsStore
              .getState()
              .setError(`Workflow load error: ${loadErrorCount} input${loadErrorCount === 1 ? '' : 's'} reference missing options.`);
          } else {
            useWorkflowErrorsStore.getState().clearNodeErrors();
          }
        }
      },

      unloadWorkflow: () => {
        const { currentWorkflowKey, savedWorkflowStates } = get();

        // Clear saved state for this workflow
        if (currentWorkflowKey) {
          const newSavedStates = { ...savedWorkflowStates };
          delete newSavedStates[currentWorkflowKey];
          set({ savedWorkflowStates: newSavedStates });
        }

        useWorkflowErrorsStore.getState().setError(null);
        set({
          workflowSource: null,
          workflow: null,
          embedWorkflow: null,
          originalWorkflow: null,
          currentFilename: null,
          currentWorkflowKey: null,
          collapsedGroups: {},
          hiddenGroups: {},
          collapsedSubgraphs: {},
          hiddenSubgraphs: {},
          runCount: 1,
          nodeOutputs: {},
          promptOutputs: {},
          followQueue: false,
          workflowLoadedAt: Date.now(),
          connectionHighlightModes: {},
          manuallyHiddenNodes: {},
        });
        useSeedStore.getState().clearSeedState();
        usePinnedWidgetStore.getState().clearCurrentPin();
        useNavigationStore.getState().setCurrentPanel('workflow');
        useImageViewerStore.getState().setViewerState({
          viewerOpen: false,
          viewerImages: [],
          viewerIndex: 0,
          viewerScale: 1,
          viewerTranslate: { x: 0, y: 0 },
        });
      },

      setSavedWorkflow: (workflow, filename) => {
        useWorkflowErrorsStore.getState().setError(null);
        const workflowKey = buildWorkflowCacheKey(workflow, get().nodeTypes);
        set({
          workflow,
          embedWorkflow: normalizeWorkflowForEmbed(workflow),
          originalWorkflow: JSON.parse(JSON.stringify(workflow)),
          currentFilename: filename,
          currentWorkflowKey: workflowKey,
        });
      },

      updateNodeWidget: (nodeId, widgetIndex, value, widgetName) => {
        const { workflow, embedWorkflow } = get();
        if (!workflow) return;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
            return updateNodeWidgetValues(node, widgetIndex, value, widgetName);
          }
          return node;
        });

        const updatedNode = newNodes.find((node) => node.id === nodeId);
        const nextEmbedWorkflow = embedWorkflow && updatedNode
          ? updateEmbedWorkflowFromExpandedNode(embedWorkflow, updatedNode)
          : embedWorkflow;

        set({ workflow: { ...workflow, nodes: newNodes }, embedWorkflow: nextEmbedWorkflow });
      },

      updateNodeWidgets: (nodeId, updates) => {
        const { workflow, embedWorkflow } = get();
        if (!workflow) return;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
            return updateNodeWidgetsValues(node, updates);
          }
          return node;
        });

        const updatedNode = newNodes.find((node) => node.id === nodeId);
        const nextEmbedWorkflow = embedWorkflow && updatedNode
          ? updateEmbedWorkflowFromExpandedNode(embedWorkflow, updatedNode)
          : embedWorkflow;

        set({ workflow: { ...workflow, nodes: newNodes }, embedWorkflow: nextEmbedWorkflow });
      },

      updateNodeTitle: (nodeId, title) => {
        const { workflow } = get();
        if (!workflow) return;
        const normalized = title?.trim() ?? '';
        const nextNodes = workflow.nodes.map((node) => {
          if (node.id !== nodeId) return node;
          const nextProps = { ...(node.properties ?? {}) } as Record<string, unknown>;
          const nextNode = { ...node, properties: nextProps } as WorkflowNode & { title?: string };
          if (normalized) {
            nextNode.title = normalized;
            nextProps.title = normalized;
          } else {
            delete nextNode.title;
            delete nextProps.title;
          }
          return nextNode;
        });
        set({ workflow: { ...workflow, nodes: nextNodes } });
      },

      toggleBypass: (nodeId) => {
        const { workflow } = get();
        if (!workflow) return;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
            const currentMode = node.mode || 0;
            const newMode = currentMode === 4 ? 0 : 4;
            return { ...node, mode: newMode };
          }
          return node;
        });

        set({ workflow: { ...workflow, nodes: newNodes } });
      },

      toggleNodeFold: (nodeId) => {
        const { workflow } = get();
        if (!workflow) return;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
            const currentFlags = node.flags || {};
            const collapsed = currentFlags.collapsed;
            return {
              ...node,
              flags: { ...currentFlags, collapsed: !collapsed }
            };
          }
          return node;
        });

        set({ workflow: { ...workflow, nodes: newNodes } });
      },

      setNodeFold: (nodeId, collapsed) => {
        const { workflow } = get();
        if (!workflow) return;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
            const currentFlags = node.flags || {};
            return {
              ...node,
              flags: { ...currentFlags, collapsed }
            };
          }
          return node;
        });

        set({ workflow: { ...workflow, nodes: newNodes } });
      },

      ensureNodeExpanded: (nodeId) => {
        const { workflow } = get();
        if (!workflow) return;
        const node = workflow.nodes.find((n) => n.id === nodeId);
        if (!node?.flags?.collapsed) return;
        const newNodes = workflow.nodes.map((n) => {
          if (n.id === nodeId) {
            return { ...n, flags: { ...n.flags, collapsed: false } };
          }
          return n;
        });
        set({ workflow: { ...workflow, nodes: newNodes } });
      },

      scrollToNode: (nodeId, label) => {
        const { manuallyHiddenNodes } = get();
        const { searchOpen, searchQuery, collapsedGroups, hiddenGroups, collapsedSubgraphs, hiddenSubgraphs } = get();
        console.log('[scrollToNode] start', {
          nodeId,
          hidden: Boolean(manuallyHiddenNodes[nodeId]),
          searchOpen,
          searchQuery,
          collapsedGroups: Object.keys(collapsedGroups ?? {}).length,
          hiddenGroups: Object.keys(hiddenGroups ?? {}).length,
          collapsedSubgraphs: Object.keys(collapsedSubgraphs ?? {}).length,
          hiddenSubgraphs: Object.keys(hiddenSubgraphs ?? {}).length
        });
        if (manuallyHiddenNodes[nodeId]) {
          get().setNodeHidden(nodeId, false);
        }
        if (document.body.dataset.textareaFocus === 'true') {
          return;
        }
        get().ensureNodeExpanded(nodeId);
        const attemptScroll = (attemptsLeft: number, delayedAttemptsLeft: number) => {
          const anchor = document.getElementById(`node-anchor-${nodeId}`) ?? document.getElementById(`node-${nodeId}`);
          const nodeEl = document.getElementById(`node-card-${nodeId}`) ?? document.getElementById(`node-${nodeId}`);
          if (!anchor || !nodeEl) {
            console.log('[scrollToNode] missing elements', {
              nodeId,
              attemptsLeft,
              hasAnchor: Boolean(anchor),
              hasNode: Boolean(nodeEl)
            });
            if (attemptsLeft > 0) {
              requestAnimationFrame(() => attemptScroll(attemptsLeft - 1, delayedAttemptsLeft));
            } else if (delayedAttemptsLeft > 0) {
              setTimeout(() => attemptScroll(10, delayedAttemptsLeft - 1), 200);
            }
            return;
          }
          const container = anchor.closest<HTMLElement>('[data-node-list="true"]');
          console.log('[scrollToNode] found elements', {
            nodeId,
            hasContainer: Boolean(container)
          });
          if (container) {
            const anchorRect = anchor.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const offset = anchorRect.top - containerRect.top;
            const targetTop = Math.max(0, container.scrollTop + offset);
            container.scrollTo({ top: targetTop, behavior: 'smooth' });
          } else {
            anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }

          const scrollContainer = container || window;
          let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;

          const highlight = () => {
            document.querySelectorAll('.highlight-pulse').forEach((el) => el.classList.remove('highlight-pulse'));
            nodeEl.classList.add('highlight-pulse');
            setTimeout(() => nodeEl.classList.remove('highlight-pulse'), 1200);
            if ('vibrate' in navigator) navigator.vibrate(10);

            if (label) {
              window.dispatchEvent(new CustomEvent('node-show-label', { detail: { nodeId, label } }));
            }
          };

          const handleScroll = () => {
            if (scrollEndTimeout) clearTimeout(scrollEndTimeout);
            scrollEndTimeout = setTimeout(() => {
              cleanup();
              highlight();
            }, 120);
          };

          const cleanup = () => {
            if (scrollEndTimeout) {
              clearTimeout(scrollEndTimeout);
              scrollEndTimeout = null;
            }
            scrollContainer.removeEventListener('scroll', handleScroll as EventListener);
          };

          scrollContainer.addEventListener('scroll', handleScroll as EventListener, { passive: true });
          scrollEndTimeout = setTimeout(() => {
            cleanup();
            highlight();
          }, 200);
        };

        attemptScroll(10, 2);
      },

      setNodeTypes: (types) => {
        set({ nodeTypes: types });
        const { workflow, currentWorkflowKey, currentFilename, savedWorkflowStates } = get();
        if (!workflow) return;
        const nextKey = buildWorkflowCacheKey(workflow, types);
        if (currentWorkflowKey === nextKey) return;

        const nextSavedStates = { ...savedWorkflowStates };
        if (currentWorkflowKey && nextSavedStates[currentWorkflowKey] && !nextSavedStates[nextKey]) {
          nextSavedStates[nextKey] = nextSavedStates[currentWorkflowKey];
          delete nextSavedStates[currentWorkflowKey];
        } else if (!currentWorkflowKey && currentFilename && nextSavedStates[currentFilename] && !nextSavedStates[nextKey]) {
          nextSavedStates[nextKey] = nextSavedStates[currentFilename];
        }

        const pinnedStore = usePinnedWidgetStore.getState();
        const legacyPin = currentFilename ? pinnedStore.pinnedWidgets[currentFilename] : undefined;
        const existingPin = currentWorkflowKey ? pinnedStore.pinnedWidgets[currentWorkflowKey] : undefined;
        if (legacyPin && !pinnedStore.pinnedWidgets[nextKey]) {
          pinnedStore.setPinnedWidget(legacyPin, nextKey);
        } else if (existingPin && !pinnedStore.pinnedWidgets[nextKey]) {
          pinnedStore.setPinnedWidget(existingPin, nextKey);
        }

        set({
          currentWorkflowKey: nextKey,
          savedWorkflowStates: nextSavedStates
        });
        pinnedStore.restorePinnedWidgetForWorkflow(nextKey, workflow);
      },

      setExecutionState: (isExecuting, executingNodeId, executingPromptId, progress) => {
        set((state) => {
          const now = Date.now();
          const nextExecutingPromptId = isExecuting
            ? (executingPromptId ?? state.executingPromptId)
            : null;
          const nextExecutingNodeId = isExecuting
            ? (executingNodeId ?? state.executingNodeId)
            : null;
          const nextState: Partial<WorkflowState> = {
            isExecuting,
            executingNodeId: nextExecutingNodeId,
            executingPromptId: nextExecutingPromptId,
            progress
          };

          const updateNodeDuration = (nodeId: string | null, durationMs: number) => {
            if (!nodeId || durationMs <= 0) return state.nodeDurationStats;
            const node = state.workflow?.nodes.find((n) => String(n.id) === nodeId);
            if (node?.mode === 4) return state.nodeDurationStats;
            const key = String(nodeId);
            const prev = state.nodeDurationStats[key];
            const count = (prev?.count ?? 0) + 1;
            const avgMs = prev ? (prev.avgMs * prev.count + durationMs) / count : durationMs;
            return {
              ...state.nodeDurationStats,
              [key]: {
                avgMs,
                count
              }
            };
          };

          if (!isExecuting) {
            if (state.currentNodeStartTime && state.executingNodeId) {
              const durationMs = now - state.currentNodeStartTime;
              nextState.nodeDurationStats = updateNodeDuration(state.executingNodeId, durationMs);
            }
            if (state.executionStartTime && state.workflow) {
              const durationMs = now - state.executionStartTime;
              const signature = getWorkflowSignature(state.workflow);
              const prev = state.workflowDurationStats[signature];
              const count = (prev?.count ?? 0) + 1;
              const avgMs = prev ? (prev.avgMs * prev.count + durationMs) / count : durationMs;
              nextState.workflowDurationStats = {
                ...state.workflowDurationStats,
                [signature]: { avgMs, count }
              };
            }
            nextState.executionStartTime = null;
            nextState.currentNodeStartTime = null;
            return nextState;
          }

          const promptChanged = nextExecutingPromptId && nextExecutingPromptId !== state.executingPromptId;
          const nodeChanged = nextExecutingNodeId && nextExecutingNodeId !== state.executingNodeId;

          if (promptChanged) {
            nextState.executionStartTime = now;
            nextState.currentNodeStartTime = now;
          }

          if (nodeChanged && state.currentNodeStartTime && state.executingNodeId) {
            const durationMs = now - state.currentNodeStartTime;
            nextState.nodeDurationStats = updateNodeDuration(state.executingNodeId, durationMs);
            nextState.currentNodeStartTime = now;
          } else if (!state.currentNodeStartTime) {
            nextState.currentNodeStartTime = now;
          }

          return nextState;
        });
      },

      queueWorkflow: async (count) => {
        const seedStore = useSeedStore.getState();
        const seedModes = seedStore.seedModes;
        const seedLastValues = seedStore.seedLastValues;
        const { workflow, nodeTypes, embedWorkflow } = get();
        if (!workflow || !nodeTypes) {
          useWorkflowErrorsStore
            .getState()
            .setError('Node types are still loading. Try again in a moment.');
          return;
        }

        useWorkflowErrorsStore.getState().setError(null);
        set({ isLoading: true });

        try {
          let currentWorkflow = workflow;
          let currentEmbedWorkflow = embedWorkflow;
          let nextSeedLastValues: SeedLastValues = { ...seedLastValues };

          for (let i = 0; i < count; i++) {
            const seedOverrides: Record<number, number> = {};
            // Handle seed modes for each node
            const updatedNodes = currentWorkflow.nodes.map((node) => {
              const seedIndex = findSeedWidgetIndex(currentWorkflow, nodeTypes, node);
              if (seedIndex === null) return node;
              if (!Array.isArray(node.widgets_values)) return node;

              // Check seed mode - use stored mode, or infer from workflow if not set
              const mode = seedModes[node.id] ?? inferSeedMode(currentWorkflow, nodeTypes, node);
              const controlWidgetIndex = seedIndex + 1;
              const controlValue = node.widgets_values[controlWidgetIndex];
              const hasControlWidget = typeof controlValue === 'string';

              if (hasControlWidget) {
                // Fixed mode or no mode set - don't change the seed
                if (!mode || mode === 'fixed') {
                  return node;
                }

                const currentSeed = Number(node.widgets_values[seedIndex]) || 0;
                let nextSeed: number;

                switch (mode) {
                  case 'randomize':
                    nextSeed = generateSeedFromNode(nodeTypes, node);
                    break;
                  case 'increment':
                    nextSeed = currentSeed + 1;
                    break;
                  case 'decrement':
                    nextSeed = currentSeed - 1;
                    break;
                  default:
                    return node;
                }

                const newWidgetValues = [...node.widgets_values];
                newWidgetValues[seedIndex] = nextSeed;
                return { ...node, widgets_values: newWidgetValues };
              }

              const rawSeed = Number(node.widgets_values[seedIndex]);
              const lastSeed = nextSeedLastValues[node.id] ?? null;
              let seedToUse: number | null = null;
              if (isSpecialSeedValue(rawSeed)) {
                seedToUse = resolveSpecialSeedToUse(rawSeed, lastSeed, nodeTypes, node);
              } else if (mode && mode !== 'fixed') {
                if (mode === 'randomize') {
                  seedToUse = generateSeedFromNode(nodeTypes, node);
                } else if (mode === 'increment') {
                  const base = typeof lastSeed === 'number' ? lastSeed : rawSeed;
                  seedToUse = base + 1;
                } else if (mode === 'decrement') {
                  const base = typeof lastSeed === 'number' ? lastSeed : rawSeed;
                  seedToUse = base - 1;
                }
              }
              if (seedToUse === null) {
                return node;
              }
              seedOverrides[node.id] = seedToUse;
              nextSeedLastValues = { ...nextSeedLastValues, [node.id]: seedToUse };
              return node;
            });

            // Update current workflow with new seeds for this iteration
            currentWorkflow = { ...currentWorkflow, nodes: updatedNodes };
            if (currentEmbedWorkflow) {
              let nextEmbedWorkflow = currentEmbedWorkflow;
              for (const node of updatedNodes) {
                nextEmbedWorkflow = updateEmbedWorkflowFromExpandedNode(nextEmbedWorkflow, node);
              }
              currentEmbedWorkflow = nextEmbedWorkflow;
            }
            seedStore.setSeedLastValues(nextSeedLastValues);
            set({ workflow: currentWorkflow, embedWorkflow: currentEmbedWorkflow });

            const prompt: Record<string, unknown> = {};
            const allowedNodeIds = new Set<number>();
            const classTypeById = new Map<number, string>();

            for (const node of currentWorkflow.nodes) {
              if (node.mode === 4) continue;
              let classType: string | null = null;
              if (nodeTypes[node.type]) {
                  classType = node.type;
              } else {
                  const match = Object.entries(nodeTypes).find(
                      ([, def]) => def.display_name === node.type || def.name === node.type
                  );
                  if (match) classType = match[0];
              }
              if (classType) {
                allowedNodeIds.add(node.id);
                classTypeById.set(node.id, classType);
              }
            }

            for (const node of currentWorkflow.nodes) {
              if (node.mode === 4) continue;
              const classType = classTypeById.get(node.id);
              if (!classType) continue;
              const inputs = buildWorkflowPromptInputs(
                currentWorkflow,
                nodeTypes,
                node,
                classType,
                allowedNodeIds,
                getWorkflowWidgetIndexMap(currentWorkflow, node.id),
                seedOverrides
              );
              prompt[String(node.id)] = { class_type: classType, inputs };
            }

            const response = await fetch(`${api.API_BASE}/api/prompt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  prompt,
                  client_id: api.clientId,
                  extra_data: { extra_pnginfo: { workflow: currentEmbedWorkflow ?? currentWorkflow } }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();

                // Parse node-specific errors if present
                const nodeErrors: Record<string, NodeError[]> = {};
                if (errorData.node_errors) {
                  for (const [nodeId, nodeError] of Object.entries(errorData.node_errors)) {
                    const errorsArray = (nodeError as { errors?: Array<{ type: string; message: string; details: string; extra_info?: { input_name?: string } }> }).errors;
                    if (errorsArray && errorsArray.length > 0) {
                      nodeErrors[nodeId] = errorsArray.map((e) => ({
                        type: e.type,
                        message: e.message,
                        details: e.details,
                        inputName: e.extra_info?.input_name,
                      }));
                    }
                  }
                }

                if (Object.keys(nodeErrors).length > 0) {
                  applyNodeErrors(nodeErrors);
                }

                throw new Error(errorData.error?.message || 'Failed to queue prompt');
            }

            // Clear any previous node errors on successful queue
            useWorkflowErrorsStore.getState().clearNodeErrors();
          }
        } catch (err) {
          useWorkflowErrorsStore
            .getState()
            .setError(err instanceof Error ? err.message : 'Failed to queue workflow');
        } finally {
          useQueueStore.getState().fetchQueue();
          set({ isLoading: false });
        }
      },

      applyControlAfterGenerate: () => {
        const { workflow } = get();
        if (!workflow) return;

        let hasChanges = false;
        const newNodes = workflow.nodes.map((node) => {
          // Handle PrimitiveNode with control_after_generate
          if (node.type === 'PrimitiveNode') {
            if (!Array.isArray(node.widgets_values)) {
              return node;
            }
            const outputType = node.outputs?.[0]?.type;
            const normalizedType = String(outputType).toUpperCase();

            // Only numeric types support control_after_generate
            if (normalizedType !== 'INT' && normalizedType !== 'FLOAT') {
              return node;
            }

            const controlMode = node.widgets_values?.[1] as string | undefined;
            if (!controlMode || controlMode === 'fixed') {
              return node;
            }

            const currentValue = node.widgets_values?.[0];
            if (typeof currentValue !== 'number') {
              return node;
            }

            let newValue = currentValue;
            if (controlMode === 'increment') {
              newValue = normalizedType === 'INT' ? currentValue + 1 : currentValue + 0.01;
            } else if (controlMode === 'decrement') {
              newValue = normalizedType === 'INT' ? currentValue - 1 : currentValue - 0.01;
            } else if (controlMode === 'randomize') {
              // For INT, generate a large random number (like seed)
              // For FLOAT, generate between 0 and 1
              newValue = normalizedType === 'INT'
                ? Math.floor(Math.random() * 0xFFFFFFFFFFFF)
                : Math.random();
            }

            if (newValue !== currentValue) {
              hasChanges = true;
              const newWidgetValues = [...node.widgets_values];
              newWidgetValues[0] = newValue;
              return { ...node, widgets_values: newWidgetValues };
            }
          }

          return node;
        });

        if (hasChanges) {
          set({ workflow: { ...workflow, nodes: newNodes } });
        }
      },

    };
  },
  {
      name: 'workflow-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        workflow: state.workflow,
        embedWorkflow: state.embedWorkflow,
        originalWorkflow: state.originalWorkflow,
        currentFilename: state.currentFilename,
        currentWorkflowKey: state.currentWorkflowKey,
        savedWorkflowStates: state.savedWorkflowStates,
        runCount: state.runCount,
        manuallyHiddenNodes: state.manuallyHiddenNodes,
        collapsedGroups: state.collapsedGroups,
        hiddenGroups: state.hiddenGroups,
        collapsedSubgraphs: state.collapsedSubgraphs,
        hiddenSubgraphs: state.hiddenSubgraphs,
        connectionButtonsVisible: state.connectionButtonsVisible,
        isExecuting: state.isExecuting,
        executingNodeId: state.executingNodeId,
        executingPromptId: state.executingPromptId,
        progress: state.progress,
        executionStartTime: state.executionStartTime,
        currentNodeStartTime: state.currentNodeStartTime,
        nodeDurationStats: state.nodeDurationStats,
        workflowDurationStats: state.workflowDurationStats,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Errors are managed by useWorkflowErrors.
      },
    }
  )
);

export function getWorkflowSignature(workflow: Workflow): string {
  const nodes = [...workflow.nodes]
    .sort((a, b) => a.id - b.id)
    .map((node) => ({
      id: node.id,
      type: node.type,
      mode: node.mode,
      inputs: node.inputs?.map((input) => input.link ?? null) ?? [],
      outputs: node.outputs?.map((output) => output.links ?? []) ?? []
    }));
  return JSON.stringify({
    nodes,
    links: workflow.links ?? []
  });
}
