import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/modals/Dialog';
import type { WorkflowGroup, WorkflowNode } from '@/api/types';
import {
  collectBypassGroupTargetNodes,
  useWorkflowStore
} from '@/hooks/useWorkflow';
import { themeColors } from '@/theme/colors';
import {
  cssColorToHex,
  hexToHsl,
  normalizeColorTokens,
  normalizeHexColor
} from '@/utils/colorUtils';
import { requireHierarchicalKey } from '@/utils/itemKeys';

interface FastGroupsBypasserControlsProps {
  node: WorkflowNode;
  isBypassed: boolean;
  showFastGroupConfig: boolean;
  setShowFastGroupConfig: (open: boolean) => void;
}

interface FastGroupToggleEntry {
  key: string;
  label: string;
  itemKey: string;
  color?: string;
  isEngaged: boolean;
  isDisabled: boolean;
  group: WorkflowGroup;
}

interface FastGroupDraft {
  matchColors: string;
  matchTitle: string;
  showAllGraphs: boolean;
  sort: string;
  customSortAlphabet: string;
  toggleRestriction: string;
  showNav: boolean;
}

function readStringProperty(
  properties: Record<string, unknown>,
  fallback: string,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'string') return value;
  }
  return fallback;
}

function readBooleanProperty(
  properties: Record<string, unknown>,
  fallback: boolean,
  ...keys: string[]
): boolean {
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === 'boolean') return value;
  }
  return fallback;
}

function buildFastGroupDraft(properties: Record<string, unknown>): FastGroupDraft {
  return {
    matchColors: readStringProperty(properties, '', 'matchColors', 'match_colors'),
    matchTitle: readStringProperty(properties, '', 'matchTitle', 'match_title'),
    showAllGraphs: readBooleanProperty(properties, true, 'showAllGraphs', 'show_all_graphs'),
    sort: readStringProperty(properties, 'position', 'sort', 'sort_mode') || 'position',
    customSortAlphabet: readStringProperty(properties, '', 'customSortAlphabet', 'custom_sort_alphabet'),
    toggleRestriction: readStringProperty(properties, 'default', 'toggleRestriction', 'toggle_restriction') || 'default',
    showNav: readBooleanProperty(properties, false, 'showNav', 'show_nav'),
  };
}

export function FastGroupsBypasserControls({
  node,
  isBypassed,
  showFastGroupConfig,
  setShowFastGroupConfig
}: FastGroupsBypasserControlsProps) {
  const workflow = useWorkflowStore((state) => state.workflow);
  const scopeStack = useWorkflowStore((state) => state.scopeStack);
  const updateNodeProperties = useWorkflowStore((state) => state.updateNodeProperties);
  const bypassAllInContainer = useWorkflowStore((state) => state.bypassAllInContainer);
  const nodeHierarchicalKey = requireHierarchicalKey(node.itemKey, `node ${node.id}`);
  const [fastGroupDraft, setFastGroupDraft] = useState<FastGroupDraft>(() =>
    buildFastGroupDraft((node.properties ?? {}) as Record<string, unknown>)
  );

  const fastGroupToggles = useMemo<FastGroupToggleEntry[]>(() => {
    if (!workflow) return [];

    const props = (node.properties ?? {}) as Record<string, unknown>;
    // Support both camelCase and snake_case keys because serialized custom-node properties
    // can vary across extension/backend versions and previously saved workflows.
    const matchColors = readStringProperty(props, '', 'matchColors', 'match_colors');
    const matchTitle = readStringProperty(props, '', 'matchTitle', 'match_title');
    const showAllGraphs = readBooleanProperty(props, true, 'showAllGraphs', 'show_all_graphs');
    const sortMode = readStringProperty(props, 'position', 'sort', 'sort_mode') || 'position';
    const customSortAlphabet = readStringProperty(props, '', 'customSortAlphabet', 'custom_sort_alphabet');

    const comfyGroupColors: Record<string, string> = themeColors.workflow.fastGroupBypassColors;

    const filterColors = matchColors
      .split(',')
      .map((color) => color.trim())
      .filter(Boolean)
      .flatMap((color) => normalizeColorTokens(color, comfyGroupColors));
    const filterColorSet = new Set(filterColors);
    const filterHueMatchers = filterColors
      .map((token) => normalizeHexColor(token) ?? cssColorToHex(token))
      .filter((hex): hex is string => Boolean(hex))
      .map((hex) => hexToHsl(hex))
      .filter((hsl): hsl is { h: number; s: number; l: number } => Boolean(hsl));

    let titleRegex: RegExp | null = null;
    if (matchTitle.trim()) {
      try {
        titleRegex = new RegExp(matchTitle, 'i');
      } catch (error) {
        console.error(error);
        return [];
      }
    }

    let customAlphabet: string[] | null = null;
    if (sortMode === 'custom alphabet') {
      const trimmed = customSortAlphabet.replace(/\n/g, '').trim().toLowerCase();
      if (trimmed) {
        customAlphabet = trimmed.includes(',')
          ? trimmed.split(',').map((entry) => entry.trim()).filter(Boolean)
          : trimmed.split('');
      }
      if (!customAlphabet?.length) {
        customAlphabet = null;
      }
    }

    const rootNodesById = new Map(workflow.nodes.map((workflowNode) => [workflowNode.id, workflowNode]));
    const subgraphNodesById = new Map<string, Map<number, WorkflowNode>>();
    for (const subgraph of workflow.definitions?.subgraphs ?? []) {
      subgraphNodesById.set(
        subgraph.id,
        new Map((subgraph.nodes ?? []).map((workflowNode) => [workflowNode.id, workflowNode]))
      );
    }

    const resolveNode = (nodeId: number, subgraphId: string | null): WorkflowNode | undefined => {
      if (subgraphId) {
        return subgraphNodesById.get(subgraphId)?.get(nodeId) ?? rootNodesById.get(nodeId);
      }
      return rootNodesById.get(nodeId);
    };

    const shouldIncludeGroup = (group: WorkflowGroup) => {
      if (filterColorSet.size > 0) {
        const groupTokens = group.color ? normalizeColorTokens(group.color, comfyGroupColors) : [];
        const groupHex = group.color ? normalizeHexColor(group.color) : null;
        const groupHsl = groupHex ? hexToHsl(groupHex) : null;
        const hasExactMatch = groupTokens.some((token) => filterColorSet.has(token)) ||
          (groupHex ? filterColorSet.has(groupHex) : false);
        const hasHueMatch = Boolean(
          groupHsl &&
            filterHueMatchers.some((matcher) => {
              const delta = Math.abs(matcher.h - groupHsl.h);
              const hueDelta = Math.min(delta, 360 - delta);
              return hueDelta <= 25;
            })
        );
        if (!hasExactMatch && !hasHueMatch) {
          return false;
        }
      }
      if (titleRegex && !titleRegex.test(group.title || '')) {
        return false;
      }
      return true;
    };

    const entries: FastGroupToggleEntry[] = [];
    const pushGroup = (group: WorkflowGroup, subgraphId: string | null) => {
      if (!shouldIncludeGroup(group)) return;
      const itemKey = requireHierarchicalKey(
        group.itemKey,
        `group ${group.id}${subgraphId ? ` in subgraph ${subgraphId}` : ' in root graph'}`
      );
      const targetNodes = collectBypassGroupTargetNodes(workflow, group.id, subgraphId);
      let isEngaged = false;
      for (const target of targetNodes) {
        const targetNode = resolveNode(target.nodeId, target.subgraphId);
        if (!targetNode || targetNode.mode === 4) continue;
        isEngaged = true;
        break;
      }
      entries.push({
        key: `${subgraphId ?? 'root'}-${group.id}`,
        label: group.title?.trim() || `Group ${group.id}`,
        itemKey,
        color: group.color,
        isEngaged,
        isDisabled: targetNodes.length === 0,
        group
      });
    };

    const currentScope = scopeStack[scopeStack.length - 1];
    const originScope = currentScope?.type === 'subgraph' ? currentScope.id : null;

    if (showAllGraphs) {
      for (const group of workflow.groups ?? []) {
        pushGroup(group, null);
      }
      for (const subgraph of workflow.definitions?.subgraphs ?? []) {
        for (const group of subgraph.groups ?? []) {
          pushGroup(group, subgraph.id);
        }
      }
    } else if (originScope) {
      const subgraph = workflow.definitions?.subgraphs?.find((entry) => entry.id === originScope);
      for (const group of subgraph?.groups ?? []) {
        pushGroup(group, originScope);
      }
    } else {
      for (const group of workflow.groups ?? []) {
        pushGroup(group, null);
      }
    }

    if (sortMode === 'alphanumeric') {
      entries.sort((a, b) => a.label.localeCompare(b.label));
    } else if (customAlphabet?.length) {
      entries.sort((a, b) => {
        const aLabel = a.label.toLowerCase();
        const bLabel = b.label.toLowerCase();
        let aIndex = -1;
        let bIndex = -1;
        for (const [index, alpha] of customAlphabet.entries()) {
          if (aIndex < 0 && aLabel.startsWith(alpha)) aIndex = index;
          if (bIndex < 0 && bLabel.startsWith(alpha)) bIndex = index;
          if (aIndex > -1 && bIndex > -1) break;
        }
        if (aIndex > -1 && bIndex > -1) {
          const result = aIndex - bIndex;
          return result === 0 ? aLabel.localeCompare(bLabel) : result;
        }
        if (aIndex > -1) return -1;
        if (bIndex > -1) return 1;
        return aLabel.localeCompare(bLabel);
      });
    } else {
      entries.sort((a, b) => {
        const aBound = a.group.bounding;
        const bBound = b.group.bounding;
        if (aBound[1] !== bBound[1]) return aBound[1] - bBound[1];
        return aBound[0] - bBound[0];
      });
    }

    return entries;
  }, [node.properties, node.id, scopeStack, workflow]);

  useEffect(() => {
    setFastGroupDraft(buildFastGroupDraft((node.properties ?? {}) as Record<string, unknown>));
  }, [node.properties]);

  const handleFastGroupToggle = (entry: FastGroupToggleEntry) => () => {
    if (isBypassed || entry.isDisabled) return;
    bypassAllInContainer(entry.itemKey, entry.isEngaged);
  };

  const applyFastGroupConfig = () => {
    if (isBypassed) return;
    updateNodeProperties(nodeHierarchicalKey, {
      matchColors: fastGroupDraft.matchColors,
      match_colors: fastGroupDraft.matchColors,
      matchTitle: fastGroupDraft.matchTitle,
      match_title: fastGroupDraft.matchTitle,
      showAllGraphs: fastGroupDraft.showAllGraphs,
      show_all_graphs: fastGroupDraft.showAllGraphs,
      sort: fastGroupDraft.sort,
      sort_mode: fastGroupDraft.sort,
      customSortAlphabet: fastGroupDraft.customSortAlphabet,
      custom_sort_alphabet: fastGroupDraft.customSortAlphabet,
      toggleRestriction: fastGroupDraft.toggleRestriction,
      toggle_restriction: fastGroupDraft.toggleRestriction,
      showNav: fastGroupDraft.showNav,
      show_nav: fastGroupDraft.showNav,
    });
    setShowFastGroupConfig(false);
  };

  if (fastGroupToggles.length === 0 && !showFastGroupConfig) return null;

  return (
    <>
      {fastGroupToggles.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-gray-400 dark:text-gray-300 mb-1.5 uppercase tracking-wide">
            Groups
          </div>
          <div className="space-y-2">
            {fastGroupToggles.map((entry) => (
              <div
                key={entry.key}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${!entry.isEngaged && !entry.isDisabled ? 'bg-purple-50/60 dark:bg-purple-900/20 border-purple-300 dark:border-purple-400/30' : `bg-gray-50/40 dark:bg-gray-900/60 ${entry.isDisabled ? 'border-gray-200 dark:border-white/10 opacity-60' : 'border-gray-200 dark:border-white/15'}`}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: entry.color || themeColors.workflow.defaultGroupDot,
                    }}
                  />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {entry.label}
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={entry.isEngaged}
                  onClick={handleFastGroupToggle(entry)}
                  disabled={isBypassed || entry.isDisabled}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                    entry.isEngaged ? 'bg-emerald-500' : 'bg-gray-300'
                  } ${(isBypassed || entry.isDisabled) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${
                      entry.isEngaged ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      {showFastGroupConfig && (
        <Dialog
          onClose={() => setShowFastGroupConfig(false)}
          title="Edit bypasser config"
          description={(
            <div className="mt-3 space-y-3 text-left">
              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Match colors
                </div>
                <input
                  type="text"
                  value={fastGroupDraft.matchColors}
                  onChange={(event) => setFastGroupDraft((current) => ({ ...current, matchColors: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  placeholder="Green, Yellow, #8A8"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Match title
                </div>
                <input
                  type="text"
                  value={fastGroupDraft.matchTitle}
                  onChange={(event) => setFastGroupDraft((current) => ({ ...current, matchTitle: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  placeholder="ALGO"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Sort
                </div>
                <select
                  value={fastGroupDraft.sort}
                  onChange={(event) => setFastGroupDraft((current) => ({ ...current, sort: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  <option value="position">Position</option>
                  <option value="alphanumeric">Alphanumeric</option>
                  <option value="custom alphabet">Custom alphabet</option>
                </select>
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Custom alphabet
                </div>
                <input
                  type="text"
                  value={fastGroupDraft.customSortAlphabet}
                  onChange={(event) => setFastGroupDraft((current) => ({ ...current, customSortAlphabet: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  placeholder="ABCDEF or A,B,C"
                />
              </label>
              <label className="block">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Toggle restriction
                </div>
                <input
                  type="text"
                  value={fastGroupDraft.toggleRestriction}
                  onChange={(event) => setFastGroupDraft((current) => ({ ...current, toggleRestriction: event.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700"
                  placeholder="default"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-white/15 px-3 py-2 text-slate-700 dark:text-gray-100">
                <span className="text-sm font-medium text-slate-700 dark:text-gray-100">Show all graphs</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-blue-600"
                  checked={fastGroupDraft.showAllGraphs}
                  onChange={(event) => setFastGroupDraft((current) => ({ ...current, showAllGraphs: event.target.checked }))}
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-white/15 px-3 py-2 text-slate-700 dark:text-gray-100">
                <span className="text-sm font-medium text-slate-700 dark:text-gray-100">Show nav</span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-blue-600"
                  checked={fastGroupDraft.showNav}
                  onChange={(event) => setFastGroupDraft((current) => ({ ...current, showNav: event.target.checked }))}
                />
              </label>
            </div>
          )}
          actions={[
            {
              label: 'Cancel',
              onClick: () => setShowFastGroupConfig(false),
              variant: 'secondary',
            },
            {
              label: 'Confirm',
              onClick: applyFastGroupConfig,
              variant: 'primary',
              className: isBypassed ? 'cursor-not-allowed opacity-60' : undefined,
            },
          ]}
        />
      )}
    </>
  );
}
