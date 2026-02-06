import { useMemo } from 'react';
import { WidgetControl } from '../../InputControls/WidgetControl';
import { NumberControl } from '../../InputControls/NumberControl';
import type { WorkflowGroup, WorkflowNode } from '@/api/types';
import {
  collectBypassGroupTargetNodeIds,
  generateSeedFromNode,
  getSpecialSeedMode,
  isSpecialSeedValue,
  useWorkflowStore
} from '@/hooks/useWorkflow';
import { useSeedStore } from '@/hooks/useSeed';
import {
  applyLoraValuesToText,
  createDefaultLoraEntry,
  extractLoraList,
  findLoraListIndex,
  isLoraManagerNodeType,
  mergeLoras,
  normalizeLoraEntry
} from '@/utils/loraManager';
import {
  buildTriggerWordListFromMessage,
  extractTriggerWordList,
  extractTriggerWordListLoose,
  extractTriggerWordMessage,
  findTriggerWordListIndex,
  findTriggerWordMessageIndex,
  isTriggerWordToggleNodeType,
  normalizeTriggerWordEntry
} from '@/utils/triggerWordToggle';

interface WidgetDescriptor {
  widgetIndex: number;
  name: string;
  type: string;
  value: unknown;
  options?: Record<string, unknown> | unknown[];
  connected?: boolean;
}

interface NodeCardParametersProps {
  node: WorkflowNode;
  isBypassed: boolean;
  isKSampler: boolean;
  workflowExists: boolean;
  nodeTypesExists: boolean;
  visibleInputWidgets: WidgetDescriptor[];
  visibleWidgets: WidgetDescriptor[];
  errorInputNames: Set<string>;
  onUpdateNodeWidget: (nodeId: number, widgetIndex: number, value: unknown, widgetName?: string) => void;
  onUpdateNodeWidgets: (nodeId: number, updates: Record<number, unknown>) => void;
  getWidgetIndexForInput: (name: string) => number | null;
  findSeedWidgetIndex: () => number | null;
  setSeedMode: (nodeId: number, mode: 'fixed' | 'randomize' | 'increment' | 'decrement') => void;
  isWidgetPinned: (widgetIndex: number) => boolean;
  toggleWidgetPin: (widgetIndex: number, widgetName: string, widgetType: string, options?: Record<string, unknown> | unknown[]) => void;
}

export function NodeCardParameters({
  node,
  isBypassed,
  isKSampler,
  workflowExists,
  nodeTypesExists,
  visibleInputWidgets,
  visibleWidgets,
  errorInputNames,
  onUpdateNodeWidget,
  onUpdateNodeWidgets,
  getWidgetIndexForInput,
  findSeedWidgetIndex,
  setSeedMode,
  isWidgetPinned,
  toggleWidgetPin
}: NodeCardParametersProps) {
  const widgetValues = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  const nodeTypes = useWorkflowStore((state) => state.nodeTypes);
  const workflow = useWorkflowStore((state) => state.workflow);
  const bypassAllInGroup = useWorkflowStore((state) => state.bypassAllInGroup);
  const syncTriggerWordsForNode = useWorkflowStore((state) => state.syncTriggerWordsForNode);
  const storedSeedMode = useSeedStore((state) => state.seedModes[node.id]);
  const lastSeedValue = useSeedStore((state) => state.seedLastValues[node.id] ?? null);
  const isFastGroupsBypasser = node.type === 'Fast Groups Bypasser (rgthree)';
  const isLoraManagerNode = isLoraManagerNodeType(node.type);
  const isTriggerWordToggleNode = isTriggerWordToggleNodeType(node.type);
  const seedWidgetIndex = !isKSampler && workflowExists && nodeTypesExists
    ? findSeedWidgetIndex()
    : null;
  const seedControlIndex = seedWidgetIndex !== null ? seedWidgetIndex + 1 : null;
  const seedControlValue = seedControlIndex !== null ? widgetValues[seedControlIndex] : undefined;
  const hasSeedControlWidget = typeof seedControlValue === 'string';
  const hideSeedInputWidget = !isKSampler && seedWidgetIndex !== null && !hasSeedControlWidget;
  const inputWidgetsToRender = hideSeedInputWidget
    ? visibleInputWidgets.filter((widget) => widget.name !== 'seed' && widget.name !== 'noise_seed')
    : visibleInputWidgets;
  const widgetsToRender = hideSeedInputWidget
    ? visibleWidgets.filter((widget) => widget.name !== 'seed' && widget.name !== 'noise_seed')
    : visibleWidgets;
  const showParameters = visibleWidgets.length > 0 || visibleInputWidgets.length > 0;
  const fastGroupToggles = useMemo(() => {
    if (!isFastGroupsBypasser || !workflow) return [];

    const props = (node.properties ?? {}) as Record<string, unknown>;
    const matchColors = typeof props.matchColors === 'string' ? props.matchColors : '';
    const matchTitle = typeof props.matchTitle === 'string' ? props.matchTitle : '';
    const showAllGraphs = props.showAllGraphs !== false;
    const sortMode = typeof props.sort === 'string' ? props.sort : 'position';
    const customSortAlphabet =
      typeof props.customSortAlphabet === 'string' ? props.customSortAlphabet : '';

    const normalizeHex = (value: string) => {
      const cleaned = value.replace('#', '').trim();
      if (/^[0-9a-f]{3}$/i.test(cleaned)) {
        return `#${cleaned.replace(/(.)/g, '$1$1').toLowerCase()}`;
      }
      if (/^[0-9a-f]{6}$/i.test(cleaned)) {
        return `#${cleaned.toLowerCase()}`;
      }
      return null;
    };

    const cssColorToHex = (value: string) => {
      if (typeof document === 'undefined') return null;
      const target = document.createElement('span');
      target.style.color = value;
      if (!document.body) return null;
      document.body.appendChild(target);
      const computed = getComputedStyle(target).color;
      document.body.removeChild(target);
      const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!match) return null;
      const [, r, g, b] = match.map(Number);
      if ([r, g, b].some((v) => Number.isNaN(v))) return null;
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    };

    const comfyGroupColors: Record<string, string> = {
      nocolor: '#353535',
      red: '#553333',
      brown: '#593930',
      green: '#335533',
      blue: '#333355',
      pale_blue: '#3f5159',
      cyan: '#335555',
      purple: '#553355',
      yellow: '#665533',
      black: '#000000'
    };

    const normalizeColorTokens = (value: string) => {
      const tokens: string[] = [];
      const lowered = value.trim().toLowerCase();
      if (lowered) {
        tokens.push(lowered);
        const mapped = comfyGroupColors[lowered.replace(/\s+/g, '')] ?? comfyGroupColors[lowered];
        if (mapped) {
          tokens.push(mapped);
        }
      }
      const normalizedHex = normalizeHex(value);
      if (normalizedHex) {
        tokens.push(normalizedHex);
        return tokens;
      }
      const cssHex = cssColorToHex(value);
      if (cssHex) tokens.push(cssHex);
      return tokens;
    };

    const hexToHsl = (hex: string) => {
      const cleaned = hex.replace('#', '').trim();
      if (!/^[0-9a-f]{6}$/i.test(cleaned)) return null;
      const r = parseInt(cleaned.slice(0, 2), 16) / 255;
      const g = parseInt(cleaned.slice(2, 4), 16) / 255;
      const b = parseInt(cleaned.slice(4, 6), 16) / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      let h = 0;
      if (delta !== 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
        h = Math.round(h * 60);
        if (h < 0) h += 360;
      }
      const l = (max + min) / 2;
      const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
      return { h, s, l };
    };

    const filterColors = matchColors
      .split(',')
      .map((color) => color.trim())
      .filter(Boolean)
      .flatMap(normalizeColorTokens);
    const filterColorSet = new Set(filterColors);
    const filterHueMatchers = filterColors
      .map((token) => normalizeHex(token) ?? cssColorToHex(token))
      .filter((hex): hex is string => Boolean(hex))
      .map((hex) => hexToHsl(hex))
      .filter((hsl): hsl is { h: number; s: number; l: number } => Boolean(hsl));

    let titleRegex: RegExp | null = null;
    if (matchTitle.trim()) {
      try {
        titleRegex = new RegExp(matchTitle, 'i');
      } catch (e) {
        console.error(e);
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

    const nodesById = new Map(workflow.nodes.map((entry) => [entry.id, entry]));
    const entries: Array<{
      key: string;
      label: string;
      groupId: number;
      subgraphId: string | null;
      color?: string;
      isEngaged: boolean;
      isDisabled: boolean;
      group: WorkflowGroup;
    }> = [];

    const shouldIncludeGroup = (group: WorkflowGroup) => {
      if (filterColorSet.size > 0) {
        const groupTokens = group.color ? normalizeColorTokens(group.color) : [];
        const groupHex = group.color ? normalizeHex(group.color) : null;
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

    const pushGroup = (group: WorkflowGroup, subgraphId: string | null) => {
      if (!shouldIncludeGroup(group)) return;
      const targetNodeIds = collectBypassGroupTargetNodeIds(workflow, group.id, subgraphId);
      let isEngaged = false;
      for (const nodeId of targetNodeIds) {
        const node = nodesById.get(nodeId);
        if (!node || node.mode === 4) continue;
        isEngaged = true;
        break;
      }
      entries.push({
        key: `${subgraphId ?? 'root'}-${group.id}`,
        label: group.title?.trim() || `Group ${group.id}`,
        groupId: group.id,
        subgraphId,
        color: group.color,
        isEngaged,
        isDisabled: targetNodeIds.size === 0,
        group
      });
    };

    const origin = (node.properties as Record<string, unknown> | undefined)?.[
      '__mobile_origin'
    ] as { scope?: string; subgraphId?: string } | undefined;
    const originScope = origin?.scope === 'subgraph' ? origin.subgraphId : null;

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
      const subgraph = workflow.definitions?.subgraphs?.find((sg) => sg.id === originScope);
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
          const ret = aIndex - bIndex;
          return ret === 0 ? aLabel.localeCompare(bLabel) : ret;
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
  }, [isFastGroupsBypasser, node.properties, workflow]);

  const handleFastGroupToggle = (entry: { isDisabled: boolean; groupId: number; isEngaged: boolean; subgraphId?: string | null }) => () => {
    if (entry.isDisabled) return;
    bypassAllInGroup(entry.groupId, entry.isEngaged, entry.subgraphId ?? undefined);
  };

  const handleSeedModeValue = (newValue: unknown) => {
    const validModes = ['fixed', 'randomize', 'increment', 'decrement'];
    if (typeof newValue === 'string' && validModes.includes(newValue)) {
      setSeedMode(node.id, newValue as 'fixed' | 'randomize' | 'increment' | 'decrement');
    }
  };

  const handleSeedControlChange = (controlIndex: number) => (newValue: unknown) => {
    onUpdateNodeWidget(node.id, controlIndex, newValue);
    handleSeedModeValue(newValue);
  };

  const handleSeedValueChange = (seedIndex: number) => (newValue: number) => {
    onUpdateNodeWidget(node.id, seedIndex, newValue, 'seed');
    setSeedMode(node.id, 'fixed');
  };

  const handleSeedNewFixedRandomClick = (seedIndex: number) => () => {
    if (!nodeTypes) return;
    const nextSeed = generateSeedFromNode(nodeTypes, node);
    onUpdateNodeWidget(node.id, seedIndex, nextSeed, 'seed');
    setSeedMode(node.id, 'fixed');
  };

  const handleSeedUseLastClick = (seedIndex: number) => () => {
    if (typeof lastSeedValue !== 'number') return;
    onUpdateNodeWidget(node.id, seedIndex, lastSeedValue, 'seed');
    setSeedMode(node.id, 'fixed');
  };

  const updateLoraManagerList = (listIndex: number, nextList: unknown[]) => {
    const updates: Record<number, unknown> = { [listIndex]: nextList };
    if (workflow && nodeTypes) {
      const textIndex = getWidgetIndexForInput('text');
      if (textIndex !== null && Array.isArray(node.widgets_values)) {
        const currentText = node.widgets_values[textIndex];
        const nextText = applyLoraValuesToText(
          typeof currentText === 'string' ? currentText : '',
          nextList as Array<{ name: string; strength: number | string; clipStrength?: number | string; active?: boolean; expanded?: boolean }>
        );
        updates[textIndex] = nextText;
      }
    }
    onUpdateNodeWidgets(node.id, updates);
    syncTriggerWordsForNode(node.id);
  };

  const getCurrentLoraList = (listIndex: number) => {
    if (!Array.isArray(node.widgets_values)) return [];
    const rawValue = node.widgets_values[listIndex];
    return extractLoraList(rawValue) ?? [];
  };

  const updateTriggerWordList = (
    listIndex: number,
    nextList: unknown[],
    extraUpdates?: Record<number, unknown>
  ) => {
    const updates: Record<number, unknown> = {
      [listIndex]: nextList,
      ...(extraUpdates ?? {})
    };
    onUpdateNodeWidgets(node.id, updates);
  };

  const getCurrentTriggerWordList = (listIndex: number) => {
    if (!Array.isArray(node.widgets_values)) return [];
    const rawValue = node.widgets_values[listIndex];
    return extractTriggerWordList(rawValue) ?? extractTriggerWordListLoose(rawValue) ?? [];
  };

  const getTriggerWordMessage = (listIndex: number) => {
    if (!Array.isArray(node.widgets_values)) return '';
    const messageIndex = findTriggerWordMessageIndex(node, listIndex);
    if (messageIndex === null) return '';
    const rawValue = node.widgets_values[messageIndex];
    return extractTriggerWordMessage(rawValue) ?? '';
  };

  const getTriggerWordSettings = () => {
    const groupModeIndex = getWidgetIndexForInput('group_mode');
    const defaultActiveIndex = getWidgetIndexForInput('default_active');
    const allowStrengthIndex = getWidgetIndexForInput('allow_strength_adjustment');
    const groupMode = groupModeIndex !== null
      ? Boolean(widgetValues[groupModeIndex])
      : true;
    const defaultActive = defaultActiveIndex !== null
      ? Boolean(widgetValues[defaultActiveIndex])
      : true;
    const allowStrengthAdjustment = allowStrengthIndex !== null
      ? Boolean(widgetValues[allowStrengthIndex])
      : false;
    return {
      groupMode,
      defaultActive,
      allowStrengthAdjustment
    };
  };

  const handleInputWidgetChange = (inputWidget: WidgetDescriptor) => (newValue: unknown) => {
    onUpdateNodeWidget(node.id, inputWidget.widgetIndex, newValue, inputWidget.name);
  };

  const canPinWidget = (widgetType: string, widgetName: string) => {
    if (widgetType.startsWith('LM_LORA')) return false;
    if (widgetType.startsWith('TW_')) return false;
    if (isLoraManagerNode && widgetName === 'text') return false;
    return true;
  };

  const handleWidgetChange = (widget: WidgetDescriptor) => (newValue: unknown) => {
    if (widget.type === 'TW_WORD') {
      const listIndex = widget.widgetIndex;
      const entryIndex = (widget.options as { entryIndex?: number } | undefined)?.entryIndex;
      if (entryIndex == null) return;
      const currentList = getCurrentTriggerWordList(listIndex);
      if (!currentList[entryIndex]) return;
      if (typeof newValue === 'object' && newValue) {
        const settings = getTriggerWordSettings();
        const nextList = [...currentList];
        nextList[entryIndex] = normalizeTriggerWordEntry(
          {
            ...nextList[entryIndex],
            ...(newValue as Record<string, unknown>)
          } as { text: string; active: boolean; strength?: number | string | null },
          {
            defaultActive: settings.defaultActive,
            allowStrengthAdjustment: settings.allowStrengthAdjustment
          }
        );
        updateTriggerWordList(listIndex, nextList);
      }
      return;
    }

    if (isTriggerWordToggleNode && widget.name === 'default_active' && typeof newValue === 'boolean') {
      const listIndex = findTriggerWordListIndex(node);
      if (listIndex !== null) {
        const currentList = getCurrentTriggerWordList(listIndex);
        const nextList = currentList.map((entry) => ({
          ...entry,
          active: newValue
        }));
        updateTriggerWordList(listIndex, nextList, {
          [widget.widgetIndex]: newValue
        });
        return;
      }
    }

    if (isTriggerWordToggleNode && widget.name === 'group_mode' && typeof newValue === 'boolean') {
      const listIndex = findTriggerWordListIndex(node);
      if (listIndex !== null) {
        const currentList = getCurrentTriggerWordList(listIndex);
        const settings = getTriggerWordSettings();
        const message = getTriggerWordMessage(listIndex);
        const nextList = message
          ? buildTriggerWordListFromMessage(message, {
              groupMode: newValue,
              defaultActive: settings.defaultActive,
              allowStrengthAdjustment: settings.allowStrengthAdjustment,
              existingList: currentList
            })
          : currentList.map((entry) =>
              normalizeTriggerWordEntry(entry, {
                defaultActive: settings.defaultActive,
                allowStrengthAdjustment: settings.allowStrengthAdjustment
              })
            );
        updateTriggerWordList(listIndex, nextList, {
          [widget.widgetIndex]: newValue
        });
        return;
      }
    }

    if (isTriggerWordToggleNode && widget.name === 'allow_strength_adjustment' && typeof newValue === 'boolean') {
      const listIndex = findTriggerWordListIndex(node);
      if (listIndex !== null) {
        const currentList = getCurrentTriggerWordList(listIndex);
        const settings = getTriggerWordSettings();
        const message = getTriggerWordMessage(listIndex);
        const nextList = message
          ? buildTriggerWordListFromMessage(message, {
              groupMode: settings.groupMode,
              defaultActive: settings.defaultActive,
              allowStrengthAdjustment: newValue,
              existingList: currentList
            })
          : currentList.map((entry) =>
              normalizeTriggerWordEntry(entry, {
                defaultActive: settings.defaultActive,
                allowStrengthAdjustment: newValue
              })
            );
        updateTriggerWordList(listIndex, nextList, {
          [widget.widgetIndex]: newValue
        });
        return;
      }
    }

    if (widget.type === 'LM_LORA_HEADER' && typeof newValue === 'boolean') {
      const listIndex = widget.widgetIndex;
      const currentList = getCurrentLoraList(listIndex);
      if (currentList.length === 0) return;
      const nextList = currentList.map((entry) => ({
        ...entry,
        active: newValue
      }));
      updateLoraManagerList(listIndex, nextList);
      return;
    }

    if (widget.type === 'LM_LORA') {
      const listIndex = widget.widgetIndex;
      const entryIndex = (widget.options as { entryIndex?: number } | undefined)?.entryIndex;
      if (entryIndex == null) return;
      const currentList = getCurrentLoraList(listIndex);
      if (!currentList[entryIndex]) return;
      if (newValue === null) {
        const nextList = currentList.filter((_, idx) => idx !== entryIndex);
        updateLoraManagerList(listIndex, nextList);
        return;
      }
      if (typeof newValue === 'object' && newValue) {
        const nextList = [...currentList];
        nextList[entryIndex] = normalizeLoraEntry({
          ...nextList[entryIndex],
          ...(newValue as Record<string, unknown>)
        } as { name: string; strength: number | string });
        updateLoraManagerList(listIndex, nextList);
      }
      return;
    }

    if (widget.type === 'LM_LORA_ADD') {
      const listIndex = widget.widgetIndex;
      const currentList = getCurrentLoraList(listIndex);
      const entry = typeof newValue === 'object' && newValue
        ? normalizeLoraEntry(newValue as { name: string; strength: number | string })
        : createDefaultLoraEntry((widget.options as { choices?: unknown[] } | undefined)?.choices);
      updateLoraManagerList(listIndex, [...currentList, entry]);
      return;
    }

    if (isLoraManagerNode && widget.name === 'text' && typeof newValue === 'string') {
      const listIndex = findLoraListIndex(node, widget.widgetIndex);
      if (listIndex !== null) {
        const currentList = getCurrentLoraList(listIndex);
        const merged = mergeLoras(newValue, currentList);
        onUpdateNodeWidgets(node.id, {
          [widget.widgetIndex]: newValue,
          [listIndex]: merged
        });
        syncTriggerWordsForNode(node.id);
        return;
      }
    }

    if (widget.type === 'POWER_LORA_HEADER' && typeof newValue === 'boolean') {
      const { loraIndices } = (widget.options || {}) as { loraIndices: number[] };
      if (loraIndices) {
        const updates: Record<number, unknown> = {};
        const widgetValues = node.widgets_values;
        if (Array.isArray(widgetValues)) {
          loraIndices.forEach((idx) => {
            const currentVal = widgetValues[idx] as Record<string, unknown>;
            updates[idx] = { ...currentVal, on: newValue };
          });
          onUpdateNodeWidgets(node.id, updates);
        }
      }
    } else {
      onUpdateNodeWidget(node.id, widget.widgetIndex, newValue, widget.name);
    }
  };

  const getWidgetKey = (widget: WidgetDescriptor, prefix: string) => {
    const options = widget.options;
    let entryIndex: number | null = null;
    if (options && typeof options === 'object' && !Array.isArray(options)) {
      const rawEntry = (options as { entryIndex?: unknown }).entryIndex;
      if (typeof rawEntry === 'number' && Number.isFinite(rawEntry)) {
        entryIndex = rawEntry;
      }
    }
    const keySuffix = entryIndex !== null ? entryIndex : widget.name || widget.type;
    return `${prefix}-${widget.widgetIndex}-${widget.type}-${keySuffix}`;
  };

  if (!showParameters && fastGroupToggles.length === 0) return null;

  return (
    <div className="mb-3">
      {fastGroupToggles.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-gray-400 dark:text-gray-300 mb-1.5 uppercase tracking-wide">
            Groups
          </div>
          <div className="space-y-2">
            {fastGroupToggles.map((entry) => (
              <div
                key={entry.key}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 bg-gray-50/40 dark:bg-gray-900/60 ${entry.isDisabled ? 'border-gray-200 dark:border-white/10 opacity-60' : 'border-gray-200 dark:border-white/15'}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: entry.color || '#9ca3af' }}
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
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                    entry.isEngaged ? 'bg-emerald-500' : 'bg-gray-300'
                  } ${entry.isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
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
      {showParameters && (
        <>
          <div className="text-xs text-gray-500 mb-1.5 uppercase tracking-wide">
            Parameters
          </div>
          {isKSampler && workflowExists && nodeTypesExists && (() => {
            const seedIndex = getWidgetIndexForInput('seed');
            if (seedIndex === null) return null;
            const seedValue = widgetValues[seedIndex];
            const seedControlIndex = seedIndex + 1;
            const seedControlValue = widgetValues[seedControlIndex];
            const seedControlChoices = ['fixed', 'increment', 'decrement', 'randomize'];
            const noiseSeedInput = node.inputs.find((input) => input.name === 'noise_seed');
            const hideSeedControl = Boolean(noiseSeedInput?.link);

            return (
              <div className="mb-3">
                <WidgetControl
                  name="seed"
                  type="INT"
                  value={seedValue}
                  onChange={(newValue) => onUpdateNodeWidget(node.id, seedIndex, newValue, 'seed')}
                  disabled={isBypassed}
                  hasError={errorInputNames.has('seed')}
                />
                {seedControlIndex < widgetValues.length && !hideSeedControl && (
                  <WidgetControl
                    name="Control mode"
                    type="COMBO"
                    value={seedControlValue}
                    options={seedControlChoices}
                    onChange={handleSeedControlChange(seedControlIndex)}
                  />
                )}
              </div>
            );
          })()}
          {!isKSampler && workflowExists && nodeTypesExists && (() => {
            const seedIndex = seedWidgetIndex;
            if (seedIndex === null) return null;
            const baseChoices = ['fixed', 'randomize', 'increment', 'decrement'];
            const choices = typeof seedControlValue === 'string' && !baseChoices.includes(seedControlValue)
              ? [...baseChoices, seedControlValue]
              : baseChoices;
            const seedInputEntry = node.inputs.find(
              (input) => input.name === 'seed' || input.name === 'noise_seed'
            );
            if (seedInputEntry?.link != null) return null;

            if (hasSeedControlWidget) {
              const controlIndex = seedIndex + 1;
              return (
                <div className="mb-3">
                  <WidgetControl
                    name="Seed control"
                    type="COMBO"
                    value={seedControlValue}
                    options={choices}
                    onChange={handleSeedControlChange(controlIndex)}
                  />
                </div>
              );
            }

            const seedWidget = visibleInputWidgets.find((widget) =>
              widget.name === 'seed' || widget.name === 'noise_seed'
            );
            const seedOptions = (seedWidget?.options ?? {}) as Record<string, unknown>;
            const min = typeof seedOptions.min === 'number' ? seedOptions.min : undefined;
            const max = typeof seedOptions.max === 'number' ? seedOptions.max : undefined;
            const step = typeof seedOptions.step === 'number' ? seedOptions.step : undefined;
            const rawSeedValue = Number(widgetValues[seedIndex] ?? 0);
            const specialMode = getSpecialSeedMode(rawSeedValue);
            const seedMode = storedSeedMode ?? specialMode ?? 'fixed';
            const displaySeedValue = isSpecialSeedValue(rawSeedValue)
              ? (typeof lastSeedValue === 'number' ? lastSeedValue : 0)
              : rawSeedValue;
            const hasSeedError = errorInputNames.has('seed') || errorInputNames.has('noise_seed');

            return (
              <div className="mb-3">
                <NumberControl
                  name="seed"
                  value={displaySeedValue}
                  onChange={handleSeedValueChange(seedIndex)}
                  disabled={isBypassed}
                  min={min}
                  max={max}
                  step={step}
                  hasError={hasSeedError}
                />
                <WidgetControl
                  name="Seed control"
                  type="COMBO"
                  value={seedMode}
                  options={baseChoices}
                  onChange={handleSeedModeValue}
                />
                <div className="grid gap-2 mt-2">
                  <button
                    type="button"
                    className="w-full py-2 px-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:text-blue-600 hover:border-blue-500 transition"
                    onClick={() => setSeedMode(node.id, 'randomize')}
                    disabled={isBypassed}
                  >
                    Randomize each time
                  </button>
                  <button
                    type="button"
                    className="w-full py-2 px-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:text-blue-600 hover:border-blue-500 transition"
                    onClick={handleSeedNewFixedRandomClick(seedIndex)}
                    disabled={isBypassed}
                  >
                    New fixed random
                  </button>
                  <button
                    type="button"
                    className="w-full py-2 px-3 border border-gray-200 rounded-lg text-sm font-medium text-gray-600 hover:text-blue-600 hover:border-blue-500 transition"
                    onClick={handleSeedUseLastClick(seedIndex)}
                    disabled={isBypassed || typeof lastSeedValue !== 'number'}
                  >
                    Use last queued seed
                  </button>
                </div>
              </div>
            );
          })()}
          {inputWidgetsToRender.map((inputWidget) => (
            <div key={getWidgetKey(inputWidget, 'input-widget')} className={isBypassed ? 'opacity-80' : ''}>
              <WidgetControl
                name={inputWidget.name}
                type={inputWidget.type}
                value={inputWidget.value}
                options={inputWidget.options}
                onChange={handleInputWidgetChange(inputWidget)}
                disabled={isBypassed}
                isPinned={canPinWidget(inputWidget.type, inputWidget.name) ? isWidgetPinned(inputWidget.widgetIndex) : false}
                onTogglePin={canPinWidget(inputWidget.type, inputWidget.name) ? () => toggleWidgetPin(inputWidget.widgetIndex, inputWidget.name, inputWidget.type, inputWidget.options) : undefined}
                hasError={errorInputNames.has(inputWidget.name)}
              />
            </div>
          ))}
          {widgetsToRender.map((widget) => (
            <div key={getWidgetKey(widget, 'widget')} className={isBypassed ? 'opacity-80' : ''}>
              <WidgetControl
                name={widget.name}
                type={widget.type}
                value={widget.value}
                options={widget.options}
                onChange={handleWidgetChange(widget)}
                disabled={isBypassed}
                isPinned={canPinWidget(widget.type, widget.name) ? isWidgetPinned(widget.widgetIndex) : false}
                onTogglePin={canPinWidget(widget.type, widget.name) ? () => toggleWidgetPin(widget.widgetIndex, widget.name, widget.type, widget.options) : undefined}
                hasError={errorInputNames.has(widget.name)}
              />
            </div>
          ))}
          {node.type === 'PrimitiveNode' && (() => {
            const outputType = node.outputs?.[0]?.type;
            const normalizedType = String(outputType).toUpperCase();
            if (normalizedType !== 'INT' && normalizedType !== 'FLOAT') return null;
            if (widgetValues.length < 2) return null;
            const controlValue = widgetValues[1];
            const controlChoices = ['fixed', 'increment', 'decrement', 'randomize'];
            return (
              <div className="mb-3">
                <WidgetControl
                  name="Control mode"
                  type="COMBO"
                  value={controlValue}
                  options={controlChoices}
                  onChange={(newValue) => onUpdateNodeWidget(node.id, 1, newValue)}
                  disabled={isBypassed}
                />
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
