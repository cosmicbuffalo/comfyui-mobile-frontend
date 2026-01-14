import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { HistoryOutputImage, Workflow, WorkflowNode, NodeTypes, NodeTypeDefinition } from '@/api/types';
import * as api from '@/api/client';
import { useQueueStore } from '@/hooks/useQueue';
import {
  buildWorkflowPromptInputs,
  getWorkflowWidgetIndexMap,
  getWidgetValue,
  isWidgetInputType,
  normalizeWidgetValue
} from '@/utils/workflowInputs';

type SeedMode = 'fixed' | 'randomize' | 'increment' | 'decrement';
type SeedLastValues = Record<number, number | null>;
type ThemeMode = 'dark' | 'light';

// Bookmarked widget for quick access from viewer
interface BookmarkedWidget {
  nodeId: number;
  widgetIndex: number;
  widgetName: string;
  widgetType: string;
  options?: Record<string, unknown> | unknown[];
}

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

// Node-specific error from prompt validation
export interface NodeError {
  type: string;
  message: string;
  details: string;
  inputName?: string; // The input/widget name if error is specific to one
}

interface WorkflowState {
  // Workflow source tracking for reload functionality
  workflowSource: WorkflowSource | null;

  // Workflow data
  workflow: Workflow | null;
  originalWorkflow: Workflow | null; // For dirty check
  currentFilename: string | null;
  nodeTypes: NodeTypes | null;
  isLoading: boolean;
  error: string | null;

  // Per-workflow saved states (keyed by filename)
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
  seedModes: Record<number, SeedMode>; // This should now also be stored in workflow widgets

  // Node output images (keyed by node ID)
  nodeOutputs: Record<string, NodeOutputImage[]>;
  // Prompt output images (keyed by prompt ID)
  promptOutputs: Record<string, HistoryOutputImage[]>;
  theme: ThemeMode;
  previewVisibility: Record<string, boolean>;
  previewVisibilityDefault: boolean;
  runCount: number;
  viewerOpen: boolean;
  viewerImages: Array<{ src: string; alt?: string }>;
  viewerIndex: number;
  viewerScale: number;
  viewerTranslate: { x: number; y: number };
  workflowLoadedAt: number;
  queuePanelOpen: boolean;
  queueItemExpanded: Record<string, boolean>;
  queueItemUserToggled: Record<string, boolean>;
  queueItemHideImages: Record<string, boolean>;
  seedLastValues: SeedLastValues;
  hideStaticNodes: boolean;
  hideBypassedNodes: boolean;
  showQueueMetadata: boolean;
  connectionHighlightModes: Record<number, 'off' | 'inputs' | 'outputs' | 'both'>;
  manuallyHiddenNodes: Record<number, boolean>;

  // Bookmarked widget (per-workflow cache keyed by filename)
  bookmarkedWidgets: Record<string, BookmarkedWidget>;
  bookmarkedWidget: BookmarkedWidget | null; // Current workflow's bookmark (derived from cache)
  bookmarkOverlayOpen: boolean;

  // Node-specific errors from prompt validation (keyed by node ID)
  nodeErrors: Record<string, NodeError[]>;

  // Actions
  loadWorkflow: (workflow: Workflow, filename?: string, options?: { fresh?: boolean; source?: WorkflowSource }) => void;
  unloadWorkflow: () => void;
  setSavedWorkflow: (workflow: Workflow, filename: string) => void;
  updateNodeWidget: (nodeId: number, widgetIndex: number, value: unknown, widgetName?: string) => void;
  updateNodeWidgets: (nodeId: number, updates: Record<number, unknown>) => void;
  toggleBypass: (nodeId: number) => void;
  toggleNodeFold: (nodeId: number) => void;
  setNodeFold: (nodeId: number, collapsed: boolean) => void;
  scrollToNode: (nodeId: number) => void;
  ensureNodeExpanded: (nodeId: number) => void;
  setNodeTypes: (types: NodeTypes) => void;
  setExecutionState: (executing: boolean, nodeId: string | null, promptId: string | null, progress: number) => void;
  queueWorkflow: (count: number) => Promise<void>;
  setSeedMode: (nodeId: number, mode: SeedMode) => void;
  saveCurrentWorkflowState: () => void;
  setNodeOutput: (nodeId: string, images: NodeOutputImage[]) => void;
  clearNodeOutputs: () => void;
  addPromptOutputs: (promptId: string, images: HistoryOutputImage[]) => void;
  clearPromptOutputs: (promptId?: string) => void;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setPreviewVisibility: (promptId: string, visible: boolean) => void;
  togglePreviewVisibility: (promptId: string) => void;
  setPreviewVisibilityDefault: (visible: boolean) => void;
  setRunCount: (count: number) => void;
  setViewerState: (next: Partial<Pick<WorkflowState, 'viewerOpen' | 'viewerImages' | 'viewerIndex' | 'viewerScale' | 'viewerTranslate'>>) => void;
  setQueuePanelOpen: (open: boolean) => void;
  setQueueItemExpanded: (promptId: string, expanded: boolean) => void;
  setQueueItemUserToggled: (promptId: string, toggled: boolean) => void;
  setQueueItemHideImages: (promptId: string, hidden: boolean) => void;
  toggleQueueItemHideImages: (promptId: string) => void;
  setHideStaticNodes: (hidden: boolean) => void;
  toggleHideStaticNodes: () => void;
  setHideBypassedNodes: (hidden: boolean) => void;
  toggleHideBypassedNodes: () => void;
  setShowQueueMetadata: (show: boolean) => void;
  toggleShowQueueMetadata: () => void;
  cycleConnectionHighlight: (nodeId: number) => void;
  setConnectionHighlightMode: (nodeId: number, mode: 'off' | 'inputs' | 'outputs' | 'both') => void;
  hideNode: (nodeId: number) => void;
  showAllHiddenNodes: () => void;
  updateWorkflowDuration: (signature: string, durationMs: number) => void;
  clearWorkflowCache: () => void;
  setError: (message: string | null) => void;
  applyControlAfterGenerate: () => void;
  setBookmarkedWidget: (bookmark: BookmarkedWidget | null) => void;
  setBookmarkOverlayOpen: (open: boolean) => void;
  toggleBookmarkOverlay: () => void;
  setNodeErrors: (errors: Record<string, NodeError[]>) => void;
  clearNodeErrors: () => void;
}

export function getWidgetIndexForInput(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode,
  inputName: string
): number | null {
  if (!nodeTypes) return null;

  const widgetIndexMap = getWorkflowWidgetIndexMap(workflow, node.id);
  const mappedIndex = widgetIndexMap?.[inputName];
  if (mappedIndex !== undefined) {
    return mappedIndex;
  }

  const typeDef = nodeTypes[node.type];
  if (!typeDef?.input) return null;

  const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
  const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
  const orderedInputs = [...requiredOrder, ...optionalOrder];
  let widgetIndex = 0;

  for (const name of orderedInputs) {
    const inputDef = typeDef.input.required?.[name] || typeDef.input.optional?.[name];
    if (!inputDef) continue;

    const [typeOrOptions] = inputDef;
    const inputEntry = node.inputs.find((i) => i.name === name);
    const isConnected = inputEntry?.link != null;
    const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
    const hasSocket = Boolean(inputEntry);
    const isWidgetType = isWidgetInputType(typeOrOptions) || isWidgetToggle || !hasSocket;
    const isWidget = isWidgetType;

    if (isWidget) {
      if (name === inputName) {
        return widgetIndex;
      }
      widgetIndex += 1;

      if (String(typeOrOptions) === 'INT' && (name === 'seed' || name === 'noise_seed')) {
        widgetIndex += 1;
      }
    }
  }

  return null;
}

// Find seed widget index by looking for any INT input containing 'seed' in its name
export function findSeedWidgetIndex(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode
): number | null {
  // First try the standard names
  const standardIndex = getWidgetIndexForInput(workflow, nodeTypes, node, 'seed') ??
    getWidgetIndexForInput(workflow, nodeTypes, node, 'noise_seed');
  if (standardIndex !== null) return standardIndex;

  if (!nodeTypes) {
    const hasSeedOutput = node.outputs?.some((output) =>
      String(output.name || '').toLowerCase().includes('seed') &&
      String(output.type || '').toUpperCase().includes('INT')
    );
    if (hasSeedOutput && Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
      return 0;
    }
    return null;
  }
  const typeDef = nodeTypes[node.type];
  if (!typeDef?.input) {
    const hasSeedOutput = node.outputs?.some((output) =>
      String(output.name || '').toLowerCase().includes('seed') &&
      String(output.type || '').toUpperCase().includes('INT')
    );
    if (hasSeedOutput && Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
      return 0;
    }
    return null;
  }

  const widgetIndexMap = getWorkflowWidgetIndexMap(workflow, node.id);
  const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
  const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
  const orderedInputs = [...requiredOrder, ...optionalOrder];
  let widgetIndex = 0;

  for (const name of orderedInputs) {
    const inputDef = typeDef.input.required?.[name] || typeDef.input.optional?.[name];
    if (!inputDef) continue;

    const [typeOrOptions] = inputDef;
    const inputEntry = node.inputs.find((i) => i.name === name);
    const isConnected = inputEntry?.link != null;
    const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
    const hasSocket = Boolean(inputEntry);
    const isWidgetType = isWidgetInputType(typeOrOptions) || isWidgetToggle || !hasSocket;

    if (isWidgetType) {
      const mappedIndex = widgetIndexMap?.[name];
      const indexToUse = mappedIndex ?? widgetIndex;

      // Check if this is an INT input with 'seed' in its name (case-insensitive)
      if (String(typeOrOptions) === 'INT' && name.toLowerCase().includes('seed')) {
        return indexToUse;
      }

      widgetIndex += 1;
      if (String(typeOrOptions) === 'INT' && (name === 'seed' || name === 'noise_seed')) {
        widgetIndex += 1;
      }
    }
  }

  return null;
}

function inferSeedMode(workflow: Workflow, nodeTypes: NodeTypes, node: WorkflowNode): SeedMode {
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

export const SPECIAL_SEED_RANDOM = -1;
export const SPECIAL_SEED_INCREMENT = -2;
export const SPECIAL_SEED_DECREMENT = -3;
export const DEFAULT_SPECIAL_SEED_RANGE = 1125899906842624;
const SPECIAL_SEED_VALUES = new Set([
  SPECIAL_SEED_RANDOM,
  SPECIAL_SEED_INCREMENT,
  SPECIAL_SEED_DECREMENT
]);

export function isSpecialSeedValue(value: number): boolean {
  return SPECIAL_SEED_VALUES.has(value);
}

export function getSpecialSeedMode(value: number): SeedMode | null {
  if (value === SPECIAL_SEED_RANDOM) return 'randomize';
  if (value === SPECIAL_SEED_INCREMENT) return 'increment';
  if (value === SPECIAL_SEED_DECREMENT) return 'decrement';
  return null;
}

export function getSpecialSeedValueForMode(mode: SeedMode): number | null {
  if (mode === 'randomize') return SPECIAL_SEED_RANDOM;
  if (mode === 'increment') return SPECIAL_SEED_INCREMENT;
  if (mode === 'decrement') return SPECIAL_SEED_DECREMENT;
  return null;
}

export function getSeedStep(nodeTypes: NodeTypes, node: WorkflowNode): number {
  const typeDef = nodeTypes[node.type];
  if (!typeDef?.input) return 1;
  const inputDef = typeDef.input.required?.seed || typeDef.input.optional?.seed;
  const options = inputDef?.[1];
  const step = typeof options?.step === 'number' ? options.step : 1;
  return step > 0 ? step : 1;
}

export function getSeedRandomBounds(node: WorkflowNode): { min: number; max: number } {
  const rawMin = Number(node.properties?.randomMin ?? 0);
  const rawMax = Number(node.properties?.randomMax ?? DEFAULT_SPECIAL_SEED_RANGE);
  const min = Number.isFinite(rawMin) ? Math.max(-DEFAULT_SPECIAL_SEED_RANGE, rawMin) : 0;
  const max = Number.isFinite(rawMax) ? Math.min(DEFAULT_SPECIAL_SEED_RANGE, rawMax) : DEFAULT_SPECIAL_SEED_RANGE;
  return min <= max ? { min, max } : { min: max, max: min };
}

export function generateSeedFromNode(nodeTypes: NodeTypes, node: WorkflowNode): number {
  const step = getSeedStep(nodeTypes, node);
  const { min, max } = getSeedRandomBounds(node);
  const scaledStep = step > 0 ? step / 10 : 1;
  const range = max - min;
  let seed = min + Math.random() * range;
  if (scaledStep > 0) {
    seed = Math.round((seed - min) / scaledStep) * scaledStep + min;
  }
  if (seed > max) seed = max;
  if (seed < min) seed = min;
  if (SPECIAL_SEED_VALUES.has(seed)) {
    seed = 0;
  }
  return seed;
}

export function resolveSpecialSeedToUse(
  inputSeed: number,
  lastSeed: number | null,
  nodeTypes: NodeTypes,
  node: WorkflowNode
): number {
  if (SPECIAL_SEED_VALUES.has(inputSeed)) {
    if (typeof lastSeed === 'number' && !SPECIAL_SEED_VALUES.has(lastSeed)) {
      if (inputSeed === SPECIAL_SEED_INCREMENT) {
        return lastSeed + 1;
      }
      if (inputSeed === SPECIAL_SEED_DECREMENT) {
        return lastSeed - 1;
      }
    }
    return generateSeedFromNode(nodeTypes, node);
  }
  return Number.isFinite(inputSeed) ? inputSeed : 0;
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
    (set, get) => ({
      workflowSource: null,
      workflow: null,
      originalWorkflow: null,
      currentFilename: null,
      nodeTypes: null,
      isLoading: false,
      error: null,
      savedWorkflowStates: {},
      isExecuting: false,
      executingNodeId: null,
      executingPromptId: null,
      progress: 0,
      executionStartTime: null,
      currentNodeStartTime: null,
      nodeDurationStats: {},
      workflowDurationStats: {},
      seedModes: {},
      nodeOutputs: {},
      promptOutputs: {},
      theme: 'dark',
      previewVisibility: {},
      previewVisibilityDefault: false,
      runCount: 1,
      viewerOpen: false,
      viewerImages: [],
      viewerIndex: 0,
      viewerScale: 1,
      viewerTranslate: { x: 0, y: 0 },
      workflowLoadedAt: 0,
      queuePanelOpen: false,
      queueItemExpanded: {},
      queueItemUserToggled: {},
      queueItemHideImages: {},
      seedLastValues: {},
      hideStaticNodes: false,
      hideBypassedNodes: false,
      showQueueMetadata: false,
      connectionHighlightModes: {},
      manuallyHiddenNodes: {},
      bookmarkedWidgets: {},
      bookmarkedWidget: null,
      bookmarkOverlayOpen: false,
      nodeErrors: {},

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

      setTheme: (theme) => {
        set({ theme });
      },

      toggleTheme: () => {
        set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' }));
      },

      setPreviewVisibility: (promptId, visible) => {
        set((state) => ({
          previewVisibility: { ...state.previewVisibility, [promptId]: visible }
        }));
      },

      togglePreviewVisibility: (promptId) => {
        set((state) => ({
          previewVisibility: {
            ...state.previewVisibility,
            [promptId]: !state.previewVisibility[promptId]
          }
        }));
      },

      setPreviewVisibilityDefault: (visible) => {
        set({ previewVisibilityDefault: visible });
      },

      setRunCount: (count) => {
        set({ runCount: Math.max(1, Math.floor(count)) });
      },

      setViewerState: (next) => {
        set((state) => {
          const candidate = { ...state, ...next };
          const unchanged =
            candidate.viewerOpen === state.viewerOpen &&
            candidate.viewerIndex === state.viewerIndex &&
            candidate.viewerScale === state.viewerScale &&
            candidate.viewerTranslate.x === state.viewerTranslate.x &&
            candidate.viewerTranslate.y === state.viewerTranslate.y &&
            candidate.viewerImages === state.viewerImages;
          return unchanged ? state : candidate;
        });
      },

      setQueuePanelOpen: (open) => {
        set({ queuePanelOpen: open });
      },

      setQueueItemExpanded: (promptId, expanded) => {
        set((state) => ({
          queueItemExpanded: { ...state.queueItemExpanded, [promptId]: expanded }
        }));
      },

      setQueueItemUserToggled: (promptId, toggled) => {
        set((state) => ({
          queueItemUserToggled: { ...state.queueItemUserToggled, [promptId]: toggled }
        }));
      },

      setQueueItemHideImages: (promptId, hidden) => {
        set((state) => ({
          queueItemHideImages: { ...state.queueItemHideImages, [promptId]: hidden }
        }));
      },

      toggleQueueItemHideImages: (promptId) => {
        set((state) => ({
          queueItemHideImages: {
            ...state.queueItemHideImages,
            [promptId]: !state.queueItemHideImages[promptId]
          }
        }));
      },

      setHideStaticNodes: (hidden) => {
        set({ hideStaticNodes: hidden });
      },

      toggleHideStaticNodes: () => {
        set((state) => ({ hideStaticNodes: !state.hideStaticNodes }));
      },

      setHideBypassedNodes: (hidden) => {
        set({ hideBypassedNodes: hidden });
      },

      toggleHideBypassedNodes: () => {
        set((state) => ({ hideBypassedNodes: !state.hideBypassedNodes }));
      },

      setShowQueueMetadata: (show) => {
        set({ showQueueMetadata: show });
      },

      toggleShowQueueMetadata: () => {
        set((state) => ({ showQueueMetadata: !state.showQueueMetadata }));
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

      hideNode: (nodeId) => {
        set((state) => ({
          manuallyHiddenNodes: {
            ...state.manuallyHiddenNodes,
            [nodeId]: true
          }
        }));
      },

      showAllHiddenNodes: () => {
        set({
          hideStaticNodes: false,
          hideBypassedNodes: false,
          manuallyHiddenNodes: {}
        });
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

      setError: (message) => {
        set({ error: message });
      },

      clearWorkflowCache: () => {
        const { currentFilename, savedWorkflowStates, originalWorkflow, nodeTypes, bookmarkedWidgets } = get();
        const nextSavedStates = { ...savedWorkflowStates };
        const nextBookmarkedWidgets = { ...bookmarkedWidgets };
        if (currentFilename) {
          delete nextSavedStates[currentFilename];
          delete nextBookmarkedWidgets[currentFilename];
        }

        if (!originalWorkflow) {
          set({
            savedWorkflowStates: nextSavedStates,
            bookmarkedWidgets: nextBookmarkedWidgets,
            bookmarkedWidget: null,
            bookmarkOverlayOpen: false,
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

        set({
          workflow: JSON.parse(JSON.stringify(originalWorkflow)),
          savedWorkflowStates: nextSavedStates,
          bookmarkedWidgets: nextBookmarkedWidgets,
          bookmarkedWidget: null,
          bookmarkOverlayOpen: false,
          seedModes,
          error: null,
          runCount: 1,
          workflowLoadedAt: Date.now(),
        });
      },

      saveCurrentWorkflowState: () => {
        const { workflow, currentFilename, seedModes, savedWorkflowStates } = get();
        if (!workflow || !currentFilename) return;

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
            [currentFilename]: {
              nodes: nodeStates,
              seedModes: { ...seedModes },
            },
          },
        });
      },

      loadWorkflow: (workflow, filename, options) => {
        const { currentFilename, savedWorkflowStates, nodeTypes, bookmarkedWidgets } = get();
        const fresh = options?.fresh ?? false;
        const source = options?.source ?? { type: 'other' as const };

        // Normalize workflow to ensure required fields exist
        const normalizedNodes = workflow.nodes.map((node) => ({
          ...node,
          widgets_values: node.widgets_values ?? [],
          inputs: node.inputs ?? [],
          outputs: node.outputs ?? [],
          flags: node.flags ?? {},
          properties: node.properties ?? {},
          mode: node.mode ?? 0,
          order: node.order ?? 0,
        }));

        const normalizedWorkflow: Workflow = {
          ...workflow,
          nodes: normalizedNodes,
          links: workflow.links ?? [],
          groups: workflow.groups ?? [],
          config: workflow.config ?? {},
          last_node_id: workflow.last_node_id ?? Math.max(0, ...normalizedNodes.map(n => n.id)),
          last_link_id: workflow.last_link_id ?? 0,
          version: workflow.version ?? 0.4,
        };

        // Restore bookmark from cache if valid
        let restoredBookmark: BookmarkedWidget | null = null;
        if (filename && bookmarkedWidgets[filename]) {
          const cachedBookmark = bookmarkedWidgets[filename];
          // Validate that the node still exists in the workflow
          const nodeExists = normalizedWorkflow.nodes.some(n => n.id === cachedBookmark.nodeId);
          if (nodeExists) {
            restoredBookmark = cachedBookmark;
          }
        }

        // Save current workflow state before switching
        if (currentFilename) {
          get().saveCurrentWorkflowState();
        }

        // If loading fresh, clear any saved state for this workflow
        if (fresh && filename && savedWorkflowStates[filename]) {
          const newSavedStates = { ...savedWorkflowStates };
          delete newSavedStates[filename];
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
        const savedState = (!fresh && filename) ? savedWorkflowStates[filename] : null;

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

          set({
            workflowSource: source,
            workflow: restoredWorkflow,
            originalWorkflow: JSON.parse(JSON.stringify(normalizedWorkflow)), // Keep original for dirty check
            currentFilename: filename || null,
            seedModes: { ...seedModes, ...savedState.seedModes },
            error: null,
            runCount: 1,
            queuePanelOpen: false,
            viewerOpen: false,
            viewerImages: [],
            viewerIndex: 0,
            viewerScale: 1,
            viewerTranslate: { x: 0, y: 0 },
            workflowLoadedAt: Date.now(),
            bookmarkedWidget: restoredBookmark,
            bookmarkOverlayOpen: false,
          });
        } else {
          set({
            workflowSource: source,
            workflow: normalizedWorkflow,
            originalWorkflow: JSON.parse(JSON.stringify(normalizedWorkflow)),
            currentFilename: filename || null,
            seedModes,
            error: null,
            runCount: 1,
            queuePanelOpen: false,
            viewerOpen: false,
            viewerImages: [],
            viewerIndex: 0,
            viewerScale: 1,
            viewerTranslate: { x: 0, y: 0 },
            workflowLoadedAt: Date.now(),
            bookmarkedWidget: restoredBookmark,
            bookmarkOverlayOpen: false,
          });
        }

        if (nodeTypes) {
          const loadErrors = collectWorkflowLoadErrors(finalWorkflow, nodeTypes);
          const loadErrorCount = Object.values(loadErrors)
            .reduce((total, nodeErrs) => total + nodeErrs.length, 0);

          if (loadErrorCount > 0) {
            get().setNodeErrors(loadErrors);
            set({
              error: `Workflow load error: ${loadErrorCount} input${loadErrorCount === 1 ? '' : 's'} reference missing options.`
            });
          } else {
            get().clearNodeErrors();
          }
        }
      },

      unloadWorkflow: () => {
        const { currentFilename, savedWorkflowStates } = get();

        // Clear saved state for this workflow
        if (currentFilename) {
          const newSavedStates = { ...savedWorkflowStates };
          delete newSavedStates[currentFilename];
          set({ savedWorkflowStates: newSavedStates });
        }

        set({
          workflowSource: null,
          workflow: null,
          originalWorkflow: null,
          currentFilename: null,
          seedModes: {},
          error: null,
          runCount: 1,
          nodeOutputs: {},
          promptOutputs: {},
          queuePanelOpen: false,
          viewerOpen: false,
          viewerImages: [],
          viewerIndex: 0,
          viewerScale: 1,
          viewerTranslate: { x: 0, y: 0 },
          workflowLoadedAt: Date.now(),
          connectionHighlightModes: {},
          manuallyHiddenNodes: {},
          bookmarkedWidget: null,
          bookmarkOverlayOpen: false,
        });
      },

      setSavedWorkflow: (workflow, filename) => {
        set({
          workflow,
          originalWorkflow: JSON.parse(JSON.stringify(workflow)),
          currentFilename: filename,
          error: null
        });
      },

      updateNodeWidget: (nodeId, widgetIndex, value, widgetName) => {
        const { workflow } = get();
        if (!workflow) return;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
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
              // Append
              newWidgetValues.push(value);
            } else {
              // Update
              newWidgetValues[widgetIndex] = value;
            }

            // Filter out nulls (used for deletion in Power Lora)
            // But only for the specific node types that support dynamic widgets if we want to be safe,
            // or just always filter nulls if ComfyUI widgets shouldn't be null anyway.
            // rgthree nodes use null for "deleted" items in their dynamic lists.
            if (node.type === 'Power Lora Loader (rgthree)') {
              newWidgetValues = newWidgetValues.filter(v => v !== null);
            }

            return { ...node, widgets_values: newWidgetValues };
          }
          return node;
        });

        set({ workflow: { ...workflow, nodes: newNodes } });
      },

      updateNodeWidgets: (nodeId, updates) => {
        const { workflow } = get();
        if (!workflow) return;

        const newNodes = workflow.nodes.map((node) => {
          if (node.id === nodeId) {
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
          return node;
        });

        set({ workflow: { ...workflow, nodes: newNodes } });
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

      scrollToNode: (nodeId) => {
        if (document.body.dataset.textareaFocus === 'true') {
          return;
        }
        get().ensureNodeExpanded(nodeId);
        const anchor = document.getElementById(`node-anchor-${nodeId}`) ?? document.getElementById(`node-${nodeId}`);
        const nodeEl = document.getElementById(`node-${nodeId}`);
        if (anchor) {
          const container = anchor.closest<HTMLElement>('[data-node-list="true"]');
          if (container) {
            const anchorRect = anchor.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const offset = anchorRect.top - containerRect.top;
            const targetTop = Math.max(0, container.scrollTop + offset);
            container.scrollTo({ top: targetTop, behavior: 'smooth' });
          } else {
            anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
        if (nodeEl) {
          const scrollContainer = anchor?.closest<HTMLElement>('[data-node-list="true"]') || window;
          let scrollEndTimeout: ReturnType<typeof setTimeout> | null = null;

          const highlight = () => {
            document.querySelectorAll('.highlight-pulse').forEach((el) => el.classList.remove('highlight-pulse'));
            nodeEl.classList.add('highlight-pulse');
            setTimeout(() => nodeEl.classList.remove('highlight-pulse'), 1200);
            if ('vibrate' in navigator) navigator.vibrate(10);
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
          // In case no scroll occurs, highlight shortly after.
          scrollEndTimeout = setTimeout(() => {
            cleanup();
            highlight();
          }, 200);
        }
      },

      setNodeTypes: (types) => {
        set({ nodeTypes: types });
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
        const { workflow, nodeTypes, seedModes, seedLastValues } = get();
        if (!workflow || !nodeTypes) {
          set({ error: 'Node types are still loading. Try again in a moment.' });
          return;
        }

        set({ isLoading: true, error: null });

        try {
          let currentWorkflow = workflow;
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
            set({ workflow: currentWorkflow, seedLastValues: nextSeedLastValues });

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
                  extra_data: { extra_pnginfo: { workflow: currentWorkflow } }
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
                  get().setNodeErrors(nodeErrors);
                }

                throw new Error(errorData.error?.message || 'Failed to queue prompt');
            }

            // Clear any previous node errors on successful queue
            get().clearNodeErrors();
          }
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Failed to queue workflow' });
        } finally {
          useQueueStore.getState().fetchQueue();
          set({ isLoading: false });
        }
      },

      setSeedMode: (nodeId, mode) => {
        const { workflow, nodeTypes, seedModes, seedLastValues } = get();
        let newWorkflow = workflow;

        if (workflow && nodeTypes) {
          const node = workflow.nodes.find((n) => n.id === nodeId);
          if (node) {
            const seedWidgetIndex = findSeedWidgetIndex(workflow, nodeTypes, node);
            if (seedWidgetIndex !== null && Array.isArray(node.widgets_values)) {
              const controlWidgetIndex = seedWidgetIndex + 1;
              const newWidgetValues = [...node.widgets_values];
              const hasControlWidget = typeof newWidgetValues[controlWidgetIndex] === 'string';

              if (hasControlWidget) {
                newWidgetValues[controlWidgetIndex] = mode;
              } else {
                const specialValue = getSpecialSeedValueForMode(mode);
                if (specialValue !== null && mode !== 'fixed') {
                  newWidgetValues[seedWidgetIndex] = specialValue;
                } else if (mode === 'fixed') {
                  const currentSeed = Number(newWidgetValues[seedWidgetIndex]);
                  if (isSpecialSeedValue(currentSeed)) {
                    const lastSeed = seedLastValues[nodeId];
                    const fallbackSeed = typeof lastSeed === 'number'
                      ? lastSeed
                      : generateSeedFromNode(nodeTypes, node);
                    newWidgetValues[seedWidgetIndex] = fallbackSeed;
                  }
                }
              }

              const newNodes = workflow.nodes.map((n) =>
                n.id === nodeId ? { ...n, widgets_values: newWidgetValues } : n
              );
              newWorkflow = { ...workflow, nodes: newNodes };
            }
          }
        }

        set({
          workflow: newWorkflow,
          seedModes: { ...seedModes, [nodeId]: mode }
        });
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

      setBookmarkedWidget: (bookmark) => {
        const { currentFilename, bookmarkedWidgets } = get();
        if (currentFilename && bookmark) {
          // Save to cache keyed by workflow filename
          set({
            bookmarkedWidget: bookmark,
            bookmarkedWidgets: { ...bookmarkedWidgets, [currentFilename]: bookmark }
          });
        } else if (currentFilename && !bookmark) {
          // Remove from cache
          const newCache = { ...bookmarkedWidgets };
          delete newCache[currentFilename];
          set({
            bookmarkedWidget: null,
            bookmarkedWidgets: newCache
          });
        } else {
          // No filename - just set the current bookmark without caching
          set({ bookmarkedWidget: bookmark });
        }
      },

      setBookmarkOverlayOpen: (open) => {
        set({ bookmarkOverlayOpen: open });
      },

      toggleBookmarkOverlay: () => {
        set((state) => ({ bookmarkOverlayOpen: !state.bookmarkOverlayOpen }));
      },

      setNodeErrors: (errors) => {
        const { manuallyHiddenNodes } = get();
        // Unhide any errored nodes that are currently hidden
        const errorNodeIds = Object.keys(errors);
        const nodesToUnhide = errorNodeIds.filter((id) => manuallyHiddenNodes[Number(id)]);
        if (nodesToUnhide.length > 0) {
          const newHiddenNodes = { ...manuallyHiddenNodes };
          for (const id of nodesToUnhide) {
            delete newHiddenNodes[Number(id)];
          }
          set({ nodeErrors: errors, manuallyHiddenNodes: newHiddenNodes });
        } else {
          set({ nodeErrors: errors });
        }
      },

      clearNodeErrors: () => {
        set({ nodeErrors: {} });
      }
    }),
    {
      name: 'workflow-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        workflow: state.workflow,
        originalWorkflow: state.originalWorkflow,
        currentFilename: state.currentFilename,
        seedModes: state.seedModes,
        savedWorkflowStates: state.savedWorkflowStates,
        theme: state.theme,
        previewVisibility: state.previewVisibility,
        previewVisibilityDefault: state.previewVisibilityDefault,
        runCount: state.runCount,
        // Note: viewerOpen, viewerImages, viewerIndex, viewerScale, viewerTranslate
        // are intentionally NOT persisted to avoid broken state on reload
        queuePanelOpen: state.queuePanelOpen,
        queueItemExpanded: state.queueItemExpanded,
        queueItemUserToggled: state.queueItemUserToggled,
        queueItemHideImages: state.queueItemHideImages,
        hideStaticNodes: state.hideStaticNodes,
        hideBypassedNodes: state.hideBypassedNodes,
        showQueueMetadata: state.showQueueMetadata,
        manuallyHiddenNodes: state.manuallyHiddenNodes,
        bookmarkedWidgets: state.bookmarkedWidgets,
        bookmarkedWidget: state.bookmarkedWidget,
        nodeErrors: state.nodeErrors,
        isExecuting: state.isExecuting,
        executingNodeId: state.executingNodeId,
        executingPromptId: state.executingPromptId,
        progress: state.progress,
        executionStartTime: state.executionStartTime,
        currentNodeStartTime: state.currentNodeStartTime,
        nodeDurationStats: state.nodeDurationStats,
        workflowDurationStats: state.workflowDurationStats,
      }),
    }
  )
);

export function getNodeTypeDefinition(
  nodeTypes: NodeTypes | null,
  nodeType: string
): NodeTypeDefinition | null {
  if (!nodeTypes) return null;
  return nodeTypes[nodeType] || null;
}

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

interface WidgetDefinition {
  name: string;
  type: string;
  options?: Record<string, unknown> | unknown[];
  value: unknown;
  widgetIndex: number;
  isCombo: boolean;
  connected: boolean;
  inputIndex: number;
}

function collectWidgetDefinitions(
  nodeTypes: NodeTypes | null,
  node: WorkflowNode
): WidgetDefinition[] {
  try {
    // Handle PrimitiveNode specially - it's a frontend-only node type
    if (node.type === 'PrimitiveNode') {
      const outputType = node.outputs?.[0]?.type;
      if (!outputType) return [];

      const normalizedType = String(outputType).toUpperCase();
      const value = Array.isArray(node.widgets_values) ? node.widgets_values[0] : undefined;

      // Determine widget name from the output name or connected target
      const outputName = node.outputs?.[0]?.name || 'value';

      return [{
        name: outputName,
        type: normalizedType,
        options: undefined,
        value,
        widgetIndex: 0,
        isCombo: false,
        connected: false,
        inputIndex: -1
      }];
    }

    // Handle Power Lora Loader (rgthree) specially
    if (node.type === 'Power Lora Loader (rgthree)') {
      const definitions: WidgetDefinition[] = [];
      
      const showSeparate = node.properties?.['Show Strengths'] === 'Separate Model & Clip';

      // Try to get Lora options from the standard LoraLoader if available
      let loraOptions: unknown[] = [];
      if (nodeTypes) {
        const standardLoraNode = getNodeTypeDefinition(nodeTypes, 'LoraLoader');
        if (standardLoraNode?.input?.required?.['lora_name']) {
           const [typeOrOptions] = standardLoraNode.input.required['lora_name'];
           if (Array.isArray(typeOrOptions)) {
             loraOptions = typeOrOptions;
           }
        }
      }

      if (Array.isArray(node.widgets_values)) {
        const widgetValues = node.widgets_values;
        const loraIndices: number[] = [];
        widgetValues.forEach((value, index) => {
          if (
            typeof value === 'object' && 
            value !== null &&
            'lora' in value &&
            'strength' in value
          ) {
            loraIndices.push(index);
          }
        });

        if (loraIndices.length > 0) {
          // Add Toggle All header
          definitions.push({
            name: 'Loras',
            type: 'POWER_LORA_HEADER',
            options: { loraIndices },
            value: null,
            widgetIndex: -1,
            isCombo: false,
            connected: false,
            inputIndex: -1
          });

          loraIndices.forEach((index) => {
            const value = widgetValues[index];
            definitions.push({
              name: 'Lora',
              type: 'POWER_LORA',
              options: { 
                choices: loraOptions.length > 0 ? loraOptions : undefined,
                showSeparate
              },
              value,
              widgetIndex: index,
              isCombo: false,
              connected: false,
              inputIndex: -1
            });
          });
        }
        
        // Add the "Add Lora" button at the end
        definitions.push({
          name: 'Add Lora',
          type: 'POWER_LORA_ADD',
          options: undefined,
          value: null,
          widgetIndex: node.widgets_values.length,
          isCombo: false,
          connected: false,
          inputIndex: -1
        });
      }
      return definitions;
    }

    const typeDef = getNodeTypeDefinition(nodeTypes, node.type);
    if (!typeDef?.input) {
      const hasSeedOutput = node.outputs?.some((output) =>
        String(output.name || '').toLowerCase().includes('seed') &&
        String(output.type || '').toUpperCase().includes('INT')
      );
      if (hasSeedOutput && Array.isArray(node.widgets_values) && node.widgets_values.length > 0) {
        return [{
          name: 'seed',
          type: 'INT',
          options: undefined,
          value: node.widgets_values[0],
          widgetIndex: 0,
          isCombo: false,
          connected: false,
          inputIndex: -1
        }];
      }
      return [];
    }

    const requiredOrder = typeDef.input_order?.required || Object.keys(typeDef.input.required || {});
    const optionalOrder = typeDef.input_order?.optional || Object.keys(typeDef.input.optional || {});
    const definitions: WidgetDefinition[] = [];
    let widgetIndex = 0;

    const processInput = (name: string, input: [string | unknown[], Record<string, unknown>?]) => {
      if (!input) return; // Defensive check
      const [typeOrOptions, inputOptions] = input;
      const inputIndex = node.inputs.findIndex((i) => i.name === name);
      const inputEntry = inputIndex >= 0 ? node.inputs[inputIndex] : undefined;
      const isConnected = inputEntry?.link != null;
      const isWidgetToggle = Boolean(inputEntry?.widget) && !isConnected;
      const hasSocket = Boolean(inputEntry);
      const hasDefault = Object.prototype.hasOwnProperty.call(inputOptions ?? {}, 'default');
      const isWidgetType = isWidgetInputType(typeOrOptions) || isWidgetToggle || !hasSocket || hasDefault;
      const isCombo = Array.isArray(typeOrOptions);
      const comboOptions = isCombo
        ? { ...(inputOptions ?? {}), options: typeOrOptions }
        : inputOptions;
      if (isWidgetType) {
        const value = getWidgetValue(node, name, widgetIndex);
        definitions.push({
          name,
          type: isCombo ? 'COMBO' : String(typeOrOptions),
          options: comboOptions,
          value,
          widgetIndex,
          isCombo,
          connected: Boolean(isConnected),
          inputIndex
        });
      }

      if (isWidgetType) {
        widgetIndex += 1;
        if (String(typeOrOptions) === 'INT' && (name === 'seed' || name === 'noise_seed')) {
          widgetIndex += 1;
        }
      }
    };

    for (const name of requiredOrder) {
      const input = typeDef.input.required?.[name];
      if (input) processInput(name, input);
    }

    for (const name of optionalOrder) {
      const input = typeDef.input.optional?.[name];
      if (input) processInput(name, input);
    }

    return definitions;
  } catch (e) {
    console.error(`Error collecting widget definitions for node ${node.id} (${node.type}):`, e);
    return []; // Return empty array on error to prevent crash
  }
}

export function getWidgetDefinitions(
  nodeTypes: NodeTypes | null,
  node: WorkflowNode
): Array<{ name: string; type: string; options?: Record<string, unknown>; value: unknown; widgetIndex: number; connected: boolean; inputIndex: number }> {
  return collectWidgetDefinitions(nodeTypes, node)
    .filter((def) => !def.isCombo)
    .map((def) => ({
      name: def.name,
      type: def.type,
      options: def.options as Record<string, unknown> | undefined,
      value: def.value,
      widgetIndex: def.widgetIndex,
      connected: def.connected,
      inputIndex: def.inputIndex
    }));
}

export function getInputWidgetDefinitions(
  nodeTypes: NodeTypes | null,
  node: WorkflowNode
): Array<{ name: string; type: string; value: unknown; options: Record<string, unknown> | unknown[]; widgetIndex: number; connected: boolean; inputIndex: number }> {
  return collectWidgetDefinitions(nodeTypes, node)
    .filter((def) => def.isCombo)
    .map((def) => ({
      name: def.name,
      type: def.type,
      value: def.value,
      options: def.options as Record<string, unknown> | unknown[],
      widgetIndex: def.widgetIndex,
      connected: def.connected,
      inputIndex: def.inputIndex
    }));
}
