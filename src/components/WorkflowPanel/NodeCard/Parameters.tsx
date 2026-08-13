import { useEffect, useMemo, useState } from 'react';
import { Collapsible } from '@/components/Collapsible';
import { FoldIcon } from '@/components/FoldIcon';
import { ArrowToDownRightIcon } from '@/components/icons';
import { Dialog } from '@/components/modals/Dialog';
import { SectionFoldButton } from './SectionFoldButton';
import { useParameterSectionFoldsStore } from '@/hooks/useParameterSectionFolds';
import { WidgetControl } from '../../InputControls/WidgetControl';
import { widgetControlHasTopPadding } from '../../InputControls/widgetControlSpacing';
import { NumberControl } from '../../InputControls/NumberControl';
import {
  controlNestedSurfaceClassName,
  controlSecondaryButtonClassName,
} from '../../InputControls/controlStyles';
import type { WorkflowNode } from '@/api/types';
import {
  generateSeedFromNode,
  getSpecialSeedMode,
  useWorkflowStore
} from '@/hooks/useWorkflow';
import { useI18n } from '@/i18n';
import { RGTHREE_SEED_NODE_TYPE, hasSeedControlWidget } from '@/utils/seedUtils';
import { useLoraManagerStore } from '@/hooks/useLoraManager';
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
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';
import { FastGroupsBypasserControls } from './FastGroupsBypasserControls';

interface WidgetDescriptor {
  widgetIndex: number;
  name: string;
  inputName?: string;
  type: string;
  value: unknown;
  options?: Record<string, unknown> | unknown[];
  connected?: boolean;
  /** Set by the card for widgets the server owns (e.g. a wildcard node's
   *  populated_text while it is in populate mode), which render read-only. */
  disabled?: boolean;
}

interface RenderWidgetDescriptor extends WidgetDescriptor {
  source: 'input' | 'widget';
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
  onUpdateNodeWidget: (widgetIndex: number, value: unknown, widgetName?: string) => void;
  onUpdateNodeWidgets: (updates: Record<number, unknown>) => void;
  getWidgetIndexForInput: (name: string) => number | null;
  findSeedWidgetIndex: () => number | null;
  findSeedControlWidgetIndex?: () => number | null;
  isPlaceholder?: boolean;
  setSeedMode: (nodeId: number, mode: 'fixed' | 'randomize' | 'increment' | 'decrement') => void;
  isWidgetPinned: (widgetIndex: number) => boolean;
  toggleWidgetPin: (widgetIndex: number, widgetName: string, widgetType: string, options?: Record<string, unknown> | unknown[], inputName?: string) => void;
  resolveWidgetValue?: (widgetIndex: number) => unknown;
  showFastGroupConfig: boolean;
  setShowFastGroupConfig: (open: boolean) => void;
  // Incremented by the parent each time the node card is unfolded; when it
  // changes we reset nested in-Parameters folds (CR-LoRA groups) back to open so
  // unfolding the node reveals every nested section.
  unfoldNonce?: number;
  // Whether an outputs section (comparer / output preview) renders below this
  // section — drives the bottom margin so a trailing section doesn't leave dead
  // space when nothing follows.
  hasOutputsBelow?: boolean;
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
  findSeedControlWidgetIndex,
  isPlaceholder,
  setSeedMode,
  isWidgetPinned,
  toggleWidgetPin,
  resolveWidgetValue,
  showFastGroupConfig,
  setShowFastGroupConfig,
  unfoldNonce,
  hasOutputsBelow = false
}: NodeCardParametersProps) {
  const { t } = useI18n();
  const widgetValues = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  const nodeTypes = useWorkflowStore((state) => state.nodeTypes);
  const popWidgetToPrimitive = useWorkflowStore((state) => state.popWidgetToPrimitive);

  // Parameters section fold (default open; persisted per node key).
  const parametersCollapsed = useParameterSectionFoldsStore(
    (s) => s.collapsedItemKeys.includes(node.itemKey ?? ''),
  );
  const toggleParametersCollapsed = useParameterSectionFoldsStore((s) => s.toggleCollapsed);
  const parametersExpanded = !parametersCollapsed;

  // A non-combo scalar widget can be "popped out" into a matching primitive node
  // when this node type can accept it as an input — whether or not the input
  // slot is already materialized in node.inputs (popWidgetToPrimitive creates it
  // if absent). Checking the type definition (not just node.inputs) keeps the
  // affordance consistent across same-type nodes saved in different formats.
  const canPopOutWidget = (widget: WidgetDescriptor): boolean => {
    if (widget.connected) return false;
    const type = String(widget.type ?? '').toUpperCase();
    if (type !== 'STRING' && type !== 'INT' && type !== 'FLOAT' && type !== 'BOOLEAN') return false;
    const primitiveType = `Primitive${type[0]}${type.slice(1).toLowerCase()}`;
    if (!nodeTypes?.[primitiveType]) return false;
    const hasSlot = node.inputs?.some((inp) => inp.name === widget.name) ?? false;
    const typeDef = nodeTypes?.[node.type];
    const inDef = Boolean(
      typeDef?.input?.required?.[widget.name] ?? typeDef?.input?.optional?.[widget.name],
    );
    return hasSlot || inDef;
  };
  // Pop-out is confirmed via a modal first (it edits the graph), so the button
  // stages the target rather than acting immediately.
  const [popOutTarget, setPopOutTarget] = useState<WidgetDescriptor | null>(null);
  const workflow = useWorkflowStore((state) => state.workflow);
  const scopeStack = useWorkflowStore((state) => state.scopeStack);
  const confirmPopOut = () => {
    const widget = popOutTarget;
    setPopOutTarget(null);
    if (!widget || !node.itemKey || !canPopOutWidget(widget)) return;
    const nodeLabel = resolveWorkflowNodeDisplayName(workflow, node, nodeTypes);
    popWidgetToPrimitive(node.itemKey, widget.name, widget.value, {
      title: `${widget.name} (via ${nodeLabel})`,
    });
  };
  const syncTriggerWordsForNode = useLoraManagerStore((state) => state.syncTriggerWordsForNode);
  const storedSeedMode = useSeedStore((state) => state.seedModes[node.id]);
  const lastSeedValue = useSeedStore((state) => state.seedLastValues[node.id] ?? null);
  const isFastGroupsBypasser = /fast\s+groups/i.test(node.type) && /\(rgthree\)/i.test(node.type);
  const isRgthreeSeedNode = node.type === RGTHREE_SEED_NODE_TYPE;
  const isCrLoraStackNode = /cr\s*lora\s*stack/i.test(node.type);
  // Per-lora fold state for CR-LoRA-Stack-style nodes, keyed by lora group index.
  // Default (absent / false) is unfolded so all controls show until collapsed.
  const [foldedLoras, setFoldedLoras] = useState<Record<number, boolean>>({});
  const toggleLoraFold = (index: number) =>
    setFoldedLoras((prev) => ({ ...prev, [index]: !prev[index] }));
  // When the parent card is unfolded (nonce changes), clear per-group folds so
  // every nested CR-LoRA group returns to its default-open state. Guarded on a
  // truthy nonce so the initial mount (nonce 0/undefined) is a no-op.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset local fold UI when the parent is explicitly unfolded
    if (unfoldNonce) setFoldedLoras({});
  }, [unfoldNonce]);
  const isLoraManagerNode = isLoraManagerNodeType(node.type);
  const isTriggerWordToggleNode = isTriggerWordToggleNodeType(node.type);
  const seedWidgetIndex = !isKSampler && workflowExists && nodeTypesExists
    ? findSeedWidgetIndex()
    : null;
  // Subgraph placeholders never promote a stock control_after_generate widget
  // adjacent to a promoted seed by position (subgraphs don't carry that
  // pairing across the boundary) — the widget right after the seed in
  // widgets_values may be something unrelated (e.g. a model combo). Trust the
  // resolved descriptor list instead of guessing seedIndex + 1.
  const seedControlIndex = seedWidgetIndex === null
    ? null
    : isPlaceholder
      ? (findSeedControlWidgetIndex ? findSeedControlWidgetIndex() : null)
      : seedWidgetIndex + 1;
  const seedControlValue = seedControlIndex !== null
    ? (resolveWidgetValue ? resolveWidgetValue(seedControlIndex) : widgetValues[seedControlIndex])
    : undefined;
  const kSamplerSeedIndex = isKSampler && workflowExists && nodeTypesExists
    ? getWidgetIndexForInput('seed')
    : null;
  const seedInputEntry = node.inputs.find(
    (input) => input.name === 'seed' || input.name === 'noise_seed'
  );
  const rendersSpecializedSeedBlock = kSamplerSeedIndex !== null || (
    !isKSampler &&
    seedWidgetIndex !== null &&
    (seedInputEntry?.link ?? null) === null
  );
  const hasSeedControl = hasSeedControlWidget(node, seedControlValue);
  const hideSeedInputWidget = !isKSampler && seedWidgetIndex !== null && !hasSeedControl;
  const shouldRenderGenericWidget = (widget: WidgetDescriptor) => {
    // A promoted control_after_generate descriptor is still needed to route
    // the specialized Seed control back to its inner subgraph node. Once that
    // control consumes it, do not render the same descriptor again under its
    // raw proxy label (for example "EasySeed: control_after_generate"). Match
    // the resolved index rather than the name so another seed/control pair is
    // not accidentally hidden.
    //
    // Gate on the specialized block actually rendering: it bails out when the
    // seed input is linked, and hiding the descriptor there would drop
    // control_after_generate from the card entirely.
    if (
      rendersSpecializedSeedBlock &&
      hasSeedControl &&
      seedControlIndex !== null &&
      widget.widgetIndex === seedControlIndex
    ) {
      return false;
    }
    // The specialized block renders the seed value itself when it also renders
    // the control, so the generic list must not repeat it.
    if (
      rendersSpecializedSeedBlock &&
      hasSeedControl &&
      seedWidgetIndex !== null &&
      widget.widgetIndex === seedWidgetIndex
    ) {
      return false;
    }
    if (!hideSeedInputWidget) return true;
    const baseName = widget.name.split(': ').pop() ?? widget.name;
    return baseName !== 'seed' && baseName !== 'noise_seed';
  };
  const inputWidgetsToRender = visibleInputWidgets.filter(shouldRenderGenericWidget);
  const widgetsToRender = visibleWidgets.filter(shouldRenderGenericWidget);
  const showParameters = visibleWidgets.length > 0 || visibleInputWidgets.length > 0;
  // A node that is just a single widget with no other input slots (a
  // primitive-like node) gains nothing from popping its only value out, so the
  // pop-out button is suppressed there.
  const isSingleWidgetOnlyNode =
    inputWidgetsToRender.length + widgetsToRender.length === 1 &&
    node.inputs.every((inp) => inp.widget != null);
  const inSubgraphScope = scopeStack[scopeStack.length - 1]?.type === 'subgraph';
  const promotedWidgetNames = useMemo(() => {
    const names = new Set<string>();
    if (!workflow || !inSubgraphScope) return names;
    const currentFrame = scopeStack[scopeStack.length - 1];
    if (!currentFrame || currentFrame.type !== 'subgraph') return names;
    const parentFrame = scopeStack.length > 1 ? scopeStack[scopeStack.length - 2] : null;

    const placeholderNodeId = currentFrame.placeholderNodeId;
    const placeholderNode =
      !parentFrame || parentFrame.type === 'root'
        ? workflow.nodes.find((n) => n.id === placeholderNodeId)
        : workflow.definitions?.subgraphs
            ?.find((sg) => sg.id === parentFrame.id)
            ?.nodes?.find((n) => n.id === placeholderNodeId);
    if (!placeholderNode) return names;

    const proxyWidgets = (placeholderNode.properties as Record<string, unknown> | undefined)?.proxyWidgets;
    if (Array.isArray(proxyWidgets)) {
      for (const entry of proxyWidgets) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const [innerNodeIdRaw, widgetNameRaw] = entry;
        const widgetName = typeof widgetNameRaw === 'string' ? widgetNameRaw : null;
        if (!widgetName) continue;
        const innerNodeId = Number(innerNodeIdRaw);
        if (innerNodeIdRaw === '-1' || innerNodeId === node.id) {
          names.add(widgetName);
        }
      }
    }

    for (const input of placeholderNode.inputs ?? []) {
      const promotedName = input.widget?.name;
      if (typeof promotedName === 'string' && promotedName.trim()) {
        names.add(promotedName.trim());
      }
    }

    return names;
  }, [workflow, inSubgraphScope, scopeStack, node.id]);
  const isPromotedWidget = (widgetName: string): boolean => {
    if (promotedWidgetNames.size === 0) return false;
    const direct = widgetName.trim();
    if (promotedWidgetNames.has(direct)) return true;
    const base = direct.split(': ').pop()?.trim() ?? direct;
    return promotedWidgetNames.has(base);
  };

  const handleSeedModeValue = (newValue: unknown) => {
    const validModes = ['fixed', 'randomize', 'increment', 'decrement'];
    if (typeof newValue === 'string' && validModes.includes(newValue)) {
      setSeedMode(node.id, newValue as 'fixed' | 'randomize' | 'increment' | 'decrement');
    }
  };

  const handleSeedControlChange = (controlIndex: number) => (newValue: unknown) => {
    onUpdateNodeWidget(controlIndex, newValue);
    handleSeedModeValue(newValue);
  };

  const handleSeedValueChange = (seedIndex: number) => (newValue: number) => {
    onUpdateNodeWidget(seedIndex, newValue, 'seed');
    setSeedMode(node.id, 'fixed');
  };

  const handleSeedNewFixedRandomClick = (seedIndex: number) => () => {
    if (!nodeTypes) return;
    const nextSeed = generateSeedFromNode(nodeTypes, node);
    onUpdateNodeWidget(seedIndex, nextSeed, 'seed');
    setSeedMode(node.id, 'fixed');
  };

  const handleSeedUseLastClick = (seedIndex: number) => () => {
    if (typeof lastSeedValue !== 'number') return;
    onUpdateNodeWidget(seedIndex, lastSeedValue, 'seed');
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
    onUpdateNodeWidgets(updates);
    syncTriggerWordsForCurrentNode();
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
    onUpdateNodeWidgets(updates);
  };

  const getCurrentTriggerWordList = (listIndex: number) => {
    if (!Array.isArray(node.widgets_values)) return [];
    const rawValue = node.widgets_values[listIndex];
    return extractTriggerWordList(rawValue) ?? extractTriggerWordListLoose(rawValue) ?? [];
  };

  const getTriggerWordMessage = (listIndex: number) => {
    if (!Array.isArray(node.widgets_values)) return '';
    const widgetIndexMap = workflow?.widget_idx_map?.[String(node.id)];
    const mappedMessageIndex =
      widgetIndexMap?.originalMessage ?? widgetIndexMap?.orinalMessage;
    const messageIndex = mappedMessageIndex !== undefined
      ? mappedMessageIndex
      : findTriggerWordMessageIndex(node, listIndex);
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

  const getTriggerWordListIndex = () => {
    const mappedIndex = getWidgetIndexForInput('toggle_trigger_words');
    if (mappedIndex !== null) return mappedIndex;
    return findTriggerWordListIndex(node);
  };

  const syncTriggerWordsForCurrentNode = () => {
    const scopeStack = useWorkflowStore.getState().scopeStack ?? [];
    const currentScope = scopeStack[scopeStack.length - 1];
    const graphId = currentScope?.type === 'subgraph' ? currentScope.id : 'root';
    syncTriggerWordsForNode(node.id, graphId);
  };

  const handleInputWidgetChange = (inputWidget: WidgetDescriptor) => (newValue: unknown) => {
    onUpdateNodeWidget(
      inputWidget.widgetIndex,
      newValue,
      inputWidget.inputName ?? inputWidget.name,
    );
  };

  const hasWidgetError = (widget: WidgetDescriptor) =>
    errorInputNames.has(widget.inputName ?? widget.name) || errorInputNames.has(widget.name);

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
      const listIndex = getTriggerWordListIndex();
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
      const listIndex = getTriggerWordListIndex();
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
      const listIndex = getTriggerWordListIndex();
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
        onUpdateNodeWidgets({
          [widget.widgetIndex]: newValue,
          [listIndex]: merged
        });
        syncTriggerWordsForCurrentNode();
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
          onUpdateNodeWidgets(updates);
        }
      }
    } else {
      onUpdateNodeWidget(
        widget.widgetIndex,
        newValue,
        widget.inputName ?? widget.name,
      );
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

  const getCrLoraStackGroupMeta = (name: string): { index: number; base: string } | null => {
    const match = name.match(/^(.*?)[_\s-]?(\d+)$/);
    if (!match) return null;
    const index = Number.parseInt(match[2], 10);
    if (!Number.isFinite(index)) return null;
    const base = match[1].trim().replace(/[_\s-]+$/, '').toLowerCase();
    if (!base) return null;
    return { index, base };
  };

  const getCrSwitchValue = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['on', 'true', 'yes', '1'].includes(normalized)) return true;
      if (['off', 'false', 'no', '0'].includes(normalized)) return false;
    }
    return Boolean(value);
  };

  const buildCrSwitchValue = (current: unknown, enabled: boolean): unknown => {
    if (typeof current === 'boolean') return enabled;
    if (typeof current === 'number') return enabled ? 1 : 0;
    if (typeof current === 'string') {
      const normalized = current.trim().toLowerCase();
      if (normalized === 'on' || normalized === 'off') {
        return enabled ? 'On' : 'Off';
      }
      if (normalized === 'true' || normalized === 'false') {
        return enabled ? 'true' : 'false';
      }
      if (normalized === 'yes' || normalized === 'no') {
        return enabled ? 'Yes' : 'No';
      }
    }
    return enabled;
  };

  const applyCrLoraComboDisplayOptions = (widget: RenderWidgetDescriptor): Record<string, unknown> | unknown[] | undefined => {
    if (!isCrLoraStackNode) return widget.options;
    const groupMeta = getCrLoraStackGroupMeta(widget.name);
    const isLoraField = Boolean(groupMeta && groupMeta.base.includes('lora'));
    if (!isLoraField) return widget.options;
    if (Array.isArray(widget.options)) {
      return {
        options: widget.options,
        stripSafetensorsSuffix: true
      };
    }
    if (widget.options && typeof widget.options === 'object') {
      return {
        ...widget.options,
        stripSafetensorsSuffix: true
      };
    }
    return { stripSafetensorsSuffix: true };
  };

  const crStackWidgets = useMemo<RenderWidgetDescriptor[]>(() => (
    [
      ...inputWidgetsToRender.map((widget) => ({ ...widget, source: 'input' as const })),
      ...widgetsToRender.map((widget) => ({ ...widget, source: 'widget' as const }))
    ]
  ), [inputWidgetsToRender, widgetsToRender]);

  const crStackGroupedWidgets = useMemo(() => {
    const grouped = new Map<number, RenderWidgetDescriptor[]>();
    const ungrouped: RenderWidgetDescriptor[] = [];
    for (const widget of crStackWidgets) {
      const meta = getCrLoraStackGroupMeta(widget.name);
      if (!meta) {
        ungrouped.push(widget);
        continue;
      }
      const current = grouped.get(meta.index) ?? [];
      current.push(widget);
      grouped.set(meta.index, current);
    }
    const orderedGroups = Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([index, widgets]) => ({ index, widgets }));
    return { groups: orderedGroups, ungrouped };
  }, [crStackWidgets]);

  const handleCrWidgetChange = (widget: RenderWidgetDescriptor) => (newValue: unknown) => {
    if (widget.source === 'input') {
      handleInputWidgetChange(widget)(newValue);
      return;
    }
    handleWidgetChange(widget)(newValue);
  };

  const firstParameterHasStandardTopPadding = (() => {
    // This custom block renders before every descriptor-backed parameter.
    if (isFastGroupsBypasser) return false;
    if (!showParameters) return false;
    if (rendersSpecializedSeedBlock) return true;

    if (isCrLoraStackNode) {
      // Group cards provide their own padded surface. Only a stack consisting
      // entirely of ungrouped widgets can begin with a standard control.
      if (crStackGroupedWidgets.groups.length > 0) return false;
      const firstWidget = crStackGroupedWidgets.ungrouped[0];
      return firstWidget
        ? widgetControlHasTopPadding(firstWidget.type, firstWidget.options)
        : false;
    }

    const firstWidget = inputWidgetsToRender[0] ?? widgetsToRender[0];
    if (firstWidget) {
      return widgetControlHasTopPadding(firstWidget.type, firstWidget.options);
    }

    // PrimitiveNode can append a synthetic standard combo after its descriptor
    // list. This is mostly defensive for unusual serialized primitives.
    if (node.type === 'PrimitiveNode' && widgetValues.length >= 2) {
      const outputType = String(node.outputs?.[0]?.type).toUpperCase();
      return outputType === 'INT' || outputType === 'FLOAT';
    }
    return false;
  })();

  if (!showParameters && !isFastGroupsBypasser && !showFastGroupConfig) return null;

  return (
    <div className={`node-parameters ${hasOutputsBelow ? 'mb-2' : ''}`}>
      <div className="parameters-section-header grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-1.5 text-xs uppercase tracking-wide text-slate-500">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">{t('Parameters')}</span>
          <span className="h-px min-w-0 flex-1 bg-slate-700" aria-hidden="true" />
        </div>
        <SectionFoldButton
          expanded={parametersExpanded}
          onToggle={() => toggleParametersCollapsed(node.itemKey ?? '')}
          label={t('parameters')}
        />
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-px min-w-0 flex-1 bg-slate-700" aria-hidden="true" />
        </div>
      </div>
      <Collapsible
        open={parametersExpanded}
        className={`parameters-section-content ${firstParameterHasStandardTopPadding ? '-mt-2' : ''}`}
      >
      {isFastGroupsBypasser && (
        <FastGroupsBypasserControls
          node={node}
          isBypassed={isBypassed}
          showFastGroupConfig={showFastGroupConfig}
          setShowFastGroupConfig={setShowFastGroupConfig}
        />
      )}
      {showParameters && (
        <>
          {isKSampler && workflowExists && nodeTypesExists && (() => {
            const seedIndex = kSamplerSeedIndex;
            if (seedIndex === null) return null;
            const seedValue = widgetValues[seedIndex];
            const seedControlIndex = seedIndex + 1;
            const seedControlValue = widgetValues[seedControlIndex];
            const seedControlChoices = ['fixed', 'increment', 'decrement', 'randomize'];
            const noiseSeedInput = node.inputs.find((input) => input.name === 'noise_seed');
            const hideSeedControl = Boolean(noiseSeedInput?.link);

            return (
              <div>
                <WidgetControl
                  name="seed"
                  type="INT"
                  value={seedValue}
                  onChange={(newValue) => onUpdateNodeWidget(seedIndex, newValue, 'seed')}
                  disabled={isBypassed}
                  hasError={errorInputNames.has('seed')}
                  isPromoted={isPromotedWidget('seed')}
                />
                {seedControlIndex < widgetValues.length && !hideSeedControl && (
                  <WidgetControl
                    name={t('Control mode')}
                    type="COMBO"
                    value={seedControlValue}
                    options={seedControlChoices}
                    onChange={handleSeedControlChange(seedControlIndex)}
                    isPromoted={isPromotedWidget('control_after_generate')}
                    compactTrailingControls
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
            if (seedInputEntry?.link != null) return null;

            const seedWidget = visibleInputWidgets.find((widget) =>
              widget.name === 'seed' || widget.name === 'noise_seed'
            );
            const seedOptions = (seedWidget?.options ?? {}) as Record<string, unknown>;
            const min = typeof seedOptions.min === 'number' ? seedOptions.min : undefined;
            const max = typeof seedOptions.max === 'number' ? seedOptions.max : undefined;
            const step = typeof seedOptions.step === 'number' ? seedOptions.step : undefined;
            const rawSeedValue = Number((resolveWidgetValue ? resolveWidgetValue(seedIndex) : widgetValues[seedIndex]) ?? 0);

            if (hasSeedControl) {
              const controlIndex = seedControlIndex ?? seedIndex + 1;
              // The node's own control_after_generate drives the seed, so pair
              // the two: the value sits directly above the control that steps
              // it, the way desktop orders them. Without this the seed stayed
              // down in the generic widget list, detached from its control.
              return (
                <div className="seed-control-widget">
                  <NumberControl
                    name="seed"
                    value={rawSeedValue}
                    onChange={handleSeedValueChange(seedIndex)}
                    disabled={isBypassed}
                    min={min}
                    max={max}
                    step={step}
                    hasError={errorInputNames.has('seed') || errorInputNames.has('noise_seed')}
                    isPromoted={isPromotedWidget('seed')}
                  />
                  <WidgetControl
                    name={t('Seed control')}
                    type="COMBO"
                    value={seedControlValue}
                    options={choices}
                    onChange={handleSeedControlChange(controlIndex)}
                    isPromoted={isPromotedWidget('control_after_generate')}
                    compactTrailingControls
                  />
                </div>
              );
            }

            const specialMode = getSpecialSeedMode(rawSeedValue);
            const seedMode = storedSeedMode ?? specialMode ?? 'fixed';
            // Display the special seed value (-1/-2/-3) directly when in a
            // special mode, matching the desktop rgthree behavior. The actual
            // seed used at queue time is resolved from this special value.
            const displaySeedValue = rawSeedValue;
            const hasSeedError = errorInputNames.has('seed') || errorInputNames.has('noise_seed');

            return (
              <div className="seed-value-widget mb-3">
                <NumberControl
                  name="seed"
                  value={displaySeedValue}
                  onChange={handleSeedValueChange(seedIndex)}
                  disabled={isBypassed}
                  min={min}
                  max={max}
                  step={step}
                  hasError={hasSeedError}
                  isPromoted={isPromotedWidget('seed')}
                />
                {!isRgthreeSeedNode && (
                  <WidgetControl
                    name={t('Seed control')}
                    type="COMBO"
                    value={seedMode}
                    options={baseChoices}
                    onChange={handleSeedModeValue}
                    isPromoted={isPromotedWidget('control_after_generate')}
                    compactTrailingControls
                  />
                )}
                <div className="grid gap-2 mt-2">
                  <button
                    type="button"
                    className={controlSecondaryButtonClassName}
                    onClick={() => setSeedMode(node.id, 'randomize')}
                    disabled={isBypassed}
                  >
                    🎲 Randomize each time
                  </button>
                  <button
                    type="button"
                    className={controlSecondaryButtonClassName}
                    onClick={handleSeedNewFixedRandomClick(seedIndex)}
                    disabled={isBypassed}
                  >
                    🎲 New fixed random
                  </button>
                  <button
                    type="button"
                    className={controlSecondaryButtonClassName}
                    onClick={handleSeedUseLastClick(seedIndex)}
                    disabled={isBypassed || typeof lastSeedValue !== 'number'}
                  >
                    {typeof lastSeedValue === 'number'
                      ? `♻️ Use last queued seed (${lastSeedValue})`
                      : '♻️ Use last queued seed'}
                  </button>
                </div>
              </div>
            );
          })()}
          {isCrLoraStackNode ? (
            <>
              <div className="space-y-3">
                {crStackGroupedWidgets.groups.map(({ index, widgets }) => (
                  <div
                    key={`cr-lora-stack-group-${index}`}
                    className={`p-3 ${controlNestedSurfaceClassName} ${isBypassed ? 'opacity-80' : ''}`}
                  >
                    {(() => {
                      const switchWidget = widgets.find((widget) => {
                        const groupMeta = getCrLoraStackGroupMeta(widget.name);
                        return groupMeta?.base === 'switch';
                      });
                      const bodyWidgets = widgets.filter((widget) => widget !== switchWidget);
                      // Default every LoRA group to open (all foldable things default
                      // to open). Disabling the switch still collapses the group via
                      // the toggle handler below; this only sets the initial state.
                      const switchEnabled = switchWidget ? getCrSwitchValue(switchWidget.value) : true;
                      const folded = foldedLoras[index] ?? false;
                      return (
                        <>
                          <button
                            type="button"
                            aria-expanded={!folded}
                            onClick={() => toggleLoraFold(index)}
                            className="flex w-full items-center gap-1 mb-2 text-left text-cyan-300"
                          >
                            <FoldIcon open={!folded} className="w-5 h-5 shrink-0" />
                            <span className="text-xs font-semibold uppercase tracking-wider">
                              LoRA {index}
                            </span>
                          </button>
                          {switchWidget && (() => {
                            const enabled = switchEnabled;
                            return (
                              <button
                                type="button"
                                aria-pressed={enabled}
                                onClick={() => {
                                  const nextEnabled = !enabled;
                                  handleCrWidgetChange(switchWidget)(buildCrSwitchValue(switchWidget.value, nextEnabled));
                                  // Keep the fold in sync: collapse when disabling, expand when enabling.
                                  setFoldedLoras((prev) => ({ ...prev, [index]: !nextEnabled }));
                                }}
                                className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${enabled ? 'bg-cyan-500 text-slate-950' : 'bg-slate-700 text-slate-200'} ${isBypassed ? 'opacity-60 cursor-not-allowed' : ''}`}
                                disabled={isBypassed}
                              >
                                {enabled ? t('Enabled') : t('Disabled')}
                              </button>
                            );
                          })()}
                          <Collapsible open={!folded} className="space-y-2 pt-2">
                            {bodyWidgets.map((widget) => {
                              const groupMeta = getCrLoraStackGroupMeta(widget.name);
                              const pinAllowed = canPinWidget(widget.type, widget.name);
                              const widgetOptions = applyCrLoraComboDisplayOptions(widget);
                              const displayName = (() => {
                                const base = groupMeta?.base ?? '';
                                if (base.includes('lora_name')) return t('Selected LoRA');
                                if (base.includes('model_weight')) return t('Model Strength');
                                if (base.includes('clip_weight')) return t('Clip Strength');
                                return widget.name;
                              })();
                              // Widget is renamed for display ("Selected LoRA"), so
                              // tell WidgetControl it's a lora picker explicitly.
                              const crModelKind = (groupMeta?.base ?? '').includes('lora_name')
                                ? 'loras'
                                : undefined;
                              return (
                                <div key={getWidgetKey(widget, 'cr-lora-widget')}>
                                  <WidgetControl
                                    name={displayName}
                                    type={widget.type}
                                    value={widget.value}
                                    options={widgetOptions}
                                    modelKind={crModelKind}
                                    onChange={handleCrWidgetChange(widget)}
                                    disabled={isBypassed}
                                    isPinned={pinAllowed ? isWidgetPinned(widget.widgetIndex) : false}
                                    onTogglePin={pinAllowed ? () => toggleWidgetPin(widget.widgetIndex, widget.name, widget.type, widgetOptions, widget.inputName) : undefined}
                                    hasError={hasWidgetError(widget)}
                                    isPromoted={isPromotedWidget(widget.name)}
                                  />
                                </div>
                              );
                            })}
                          </Collapsible>
                        </>
                      );
                    })()}
                  </div>
                ))}
              </div>
              {crStackGroupedWidgets.ungrouped.map((widget) => {
                const pinAllowed = canPinWidget(widget.type, widget.name);
                const widgetOptions = applyCrLoraComboDisplayOptions(widget);
                return (
                  <div key={getWidgetKey(widget, 'cr-lora-ungrouped')} className={isBypassed ? 'opacity-80' : ''}>
                    <WidgetControl
                      name={widget.name}
                      type={widget.type}
                      value={widget.value}
                      options={widgetOptions}
                      onChange={handleCrWidgetChange(widget)}
                      disabled={isBypassed}
                      isPinned={pinAllowed ? isWidgetPinned(widget.widgetIndex) : false}
                      onTogglePin={pinAllowed ? () => toggleWidgetPin(widget.widgetIndex, widget.name, widget.type, widgetOptions, widget.inputName) : undefined}
                      hasError={hasWidgetError(widget)}
                      isPromoted={isPromotedWidget(widget.name)}
                    />
                  </div>
                );
              })}
            </>
          ) : (
            <>
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
                    onTogglePin={canPinWidget(inputWidget.type, inputWidget.name) ? () => toggleWidgetPin(inputWidget.widgetIndex, inputWidget.name, inputWidget.type, inputWidget.options, inputWidget.inputName) : undefined}
                    hasError={hasWidgetError(inputWidget)}
                    isPromoted={isPromotedWidget(inputWidget.name)}
                  />
                </div>
              ))}
              {widgetsToRender.map((widget) => {
                const canPopOut =
                  !isBypassed && !isSingleWidgetOnlyNode && Boolean(node.itemKey) && canPopOutWidget(widget);
                return (
                  <div key={getWidgetKey(widget, 'widget')} className={isBypassed ? 'opacity-80' : ''}>
                    <WidgetControl
                      name={widget.name}
                      type={widget.type}
                      value={widget.value}
                      options={widget.options}
                      onChange={handleWidgetChange(widget)}
                      disabled={isBypassed || widget.disabled === true}
                      isPinned={canPinWidget(widget.type, widget.name) ? isWidgetPinned(widget.widgetIndex) : false}
                      onTogglePin={canPinWidget(widget.type, widget.name) ? () => toggleWidgetPin(widget.widgetIndex, widget.name, widget.type, widget.options, widget.inputName) : undefined}
                      hasError={hasWidgetError(widget)}
                      isPromoted={isPromotedWidget(widget.name)}
                      labelAccessory={canPopOut ? (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPopOutTarget(widget); }}
                          aria-label={t('Pop "{name}" out into a connected input node', { name: widget.name })}
                          title={t('Pop out into a connected input node')}
                          className="widget-popout-button inline-flex items-center gap-0.5 text-slate-400 hover:text-cyan-300 active:scale-95"
                        >
                          {/* A dotted circle (the new connection the value pops
                              into) with the arrow pointing left at its center. */}
                          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeDasharray="0.5 6.5" />
                          </svg>
                          <ArrowToDownRightIcon className="w-4 h-4 rotate-90" />
                        </button>
                      ) : undefined}
                    />
                  </div>
                );
              })}
            </>
          )}
          {node.type === 'PrimitiveNode' && (() => {
            const outputType = node.outputs?.[0]?.type;
            const normalizedType = String(outputType).toUpperCase();
            if (normalizedType !== 'INT' && normalizedType !== 'FLOAT') return null;
            if (widgetValues.length < 2) return null;
            const controlValue = widgetValues[1];
            const controlChoices = ['fixed', 'increment', 'decrement', 'randomize'];
            return (
              <div className="primitive-control-mode-widget mb-3">
                <WidgetControl
                  name={t('Control mode')}
                  type="COMBO"
                  value={controlValue}
                  options={controlChoices}
                  onChange={(newValue) => onUpdateNodeWidget(1, newValue)}
                  disabled={isBypassed}
                  isPromoted={isPromotedWidget('control_after_generate')}
                  compactTrailingControls
                />
              </div>
            );
          })()}
        </>
      )}
      </Collapsible>
      {popOutTarget && (
        <Dialog
          onClose={() => setPopOutTarget(null)}
          title={t('Pop out into an input node?')}
          description={t('This creates a new primitive node for "{name}" directly above this node and connects it to the input. The current value is kept.', { name: popOutTarget.name })}
          actions={[
            { label: t('Cancel'), onClick: () => setPopOutTarget(null), variant: 'secondary' },
            { label: t('Pop out'), onClick: confirmPopOut, variant: 'primary', autoFocus: true },
          ]}
        />
      )}
    </div>
  );
}
