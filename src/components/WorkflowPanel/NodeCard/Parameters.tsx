import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Collapsible } from '@/components/Collapsible';
import { FoldIcon } from '@/components/FoldIcon';
import {
  ArrowDownIcon,
  ArrowToDownRightIcon,
  EditIcon,
  NoEntryIcon,
  PinIconSvg,
  PromotedWidgetIcon,
  QueueStackIcon,
} from '@/components/icons';
import { Dialog } from '@/components/modals/Dialog';
import { WidgetVariationsModal } from '@/components/modals/WidgetVariationsModal';
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
import { RowActionsMenu, type RowMenuAction } from './RowActionsMenu';
import type { PromotableWidget } from '@/utils/promotableWidgets';
import { widgetRowDomId } from '@/utils/workflowJumpTargets';
import type { PromotedWidgetForm } from '@/utils/promotedWidgetForm';
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
import { variationOptionsFor } from '@/utils/widgetVariations';
import { FastGroupsBypasserControls } from './FastGroupsBypasserControls';
import { supportsPinnedWidgetEditor } from '@/utils/pinnedWidgetSupport';
import { promotedWidgetKey, resolvePromotedWidgetKeys } from '@/utils/boundaryPromotion';

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
  /**
   * Which of the node's input slots this widget belongs to, or -1 when it has
   * none. On a placeholder that slot IS a boundary slot, which is what the
   * boundary actions in the widget menu address.
   */
  inputIndex?: number;
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
  /**
   * A promoted seed is edited through the placeholder instance this subgraph
   * was entered from. Its mode control must follow that same instance too.
   */
  promotedSeedModeNodeId?: number;
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
  /** Widgets on this node that could be promoted to the enclosing boundary. */
  promotableWidgets?: PromotableWidget[];
  /** Form of each already-promoted widget, keyed by the widget's input name. */
  promotedWidgetForms?: Record<string, PromotedWidgetForm>;
  /**
   * What the boundary calls each promoted widget, keyed by the widget's input
   * name — shown beside the widget when the two names differ, the same way a
   * connection row names the slot it crosses.
   */
  promotedBoundaryLabels?: Record<string, string>;
  /** On a placeholder: the inner widget names each boundary slot drives. */
  boundaryTargetNames?: Record<number, string[]>;
  /** How many instances share this placeholder's type, for the reorder caution. */
  instanceCount?: number;
  onPromoteWidget?: (widget: PromotableWidget, form: PromotedWidgetForm) => void;
  onChangePromotedForm?: (inputName: string, form: PromotedWidgetForm) => void;
  onDemoteWidget?: (inputName: string) => void;
  /** Unpromote a boundary slot from the placeholder side. */
  onUnpromoteBoundarySlot?: (slotIndex: number) => void;
  /**
   * Placeholder-side boundary editing. The order of promoted widgets is only
   * visible here, on the card that draws them, so this is where moving them
   * lives — not inside the subgraph, where the list is not on screen.
   */
  onMoveBoundarySlot?: (fromSlot: number, toSlot: number) => void;
  onRemoveBoundarySlot?: (slotIndex: number) => void;
  onRenameBoundarySlot?: (slotIndex: number) => void;
  onRenameWidget?: (inputName: string, label: string) => void;
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
  promotedSeedModeNodeId,
  isPlaceholder,
  setSeedMode,
  isWidgetPinned,
  toggleWidgetPin,
  resolveWidgetValue,
  showFastGroupConfig,
  setShowFastGroupConfig,
  unfoldNonce,
  hasOutputsBelow = false,
  promotableWidgets = [],
  promotedWidgetForms = {},
  promotedBoundaryLabels = {},
  boundaryTargetNames = {},
  instanceCount = 1,
  onPromoteWidget,
  onChangePromotedForm,
  onDemoteWidget,
  onUnpromoteBoundarySlot,
  onMoveBoundarySlot,
  onRemoveBoundarySlot,
  onRenameBoundarySlot,
  onRenameWidget
}: NodeCardParametersProps) {
  const { t } = useI18n();
  const widgetValues = Array.isArray(node.widgets_values) ? node.widgets_values : [];
  const nodeTypes = useWorkflowStore((state) => state.nodeTypes);
  const popWidgetToPrimitive = useWorkflowStore((state) => state.popWidgetToPrimitive);
  const setPowerPuterOutputs = useWorkflowStore((state) => state.setPowerPuterOutputs);

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
  const [renameTarget, setRenameTarget] = useState<{ inputName: string; label: string } | null>(null);
  const [variationsTarget, setVariationsTarget] = useState<WidgetDescriptor | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
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
  const seedModeNodeId = promotedSeedModeNodeId ?? node.id;
  const storedSeedMode = useSeedStore((state) => state.seedModes[seedModeNodeId]);
  const lastSeedValue = useSeedStore((state) => state.seedLastValues[seedModeNodeId] ?? null);
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
    : promotedSeedModeNodeId !== undefined
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
    ((seedInputEntry?.link ?? null) === null || promotedSeedModeNodeId !== undefined)
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
    // The specialized block renders the seed value itself, so the generic list
    // must not repeat that same descriptor. Match its stable widget index, not
    // its editable display name: a promoted `seed` labelled
    // `interpolation_seed` is still this exact widget.
    if (
      rendersSpecializedSeedBlock &&
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
  const currentScopeFrame = scopeStack[scopeStack.length - 1];
  const inSubgraphScope = currentScopeFrame?.type === 'subgraph';
  // Node ids repeat across scopes, so a menu key has to name the scope too —
  // otherwise root node 5 and a subgraph's node 5 share one key.
  const menuScopeKey = scopeStack.map((frame) => (frame.type === 'subgraph' ? frame.id : 'root')).join('/');
  // Keyed by inner node as well as widget name: a promotion routed through a
  // boundary input records no owner in proxyWidgets, and matching on the name
  // alone marked every same-named widget in the subgraph as promoted.
  const promotedWidgetKeys = useMemo(() => {
    if (!workflow || !inSubgraphScope) return new Set<string>();
    const currentFrame = scopeStack[scopeStack.length - 1];
    if (!currentFrame || currentFrame.type !== 'subgraph') return new Set<string>();
    const parentFrame = scopeStack.length > 1 ? scopeStack[scopeStack.length - 2] : null;

    const placeholderNodeId = currentFrame.placeholderNodeId;
    const placeholderNode =
      !parentFrame || parentFrame.type === 'root'
        ? workflow.nodes.find((n) => n.id === placeholderNodeId)
        : workflow.definitions?.subgraphs
            ?.find((sg) => sg.id === parentFrame.id)
            ?.nodes?.find((n) => n.id === placeholderNodeId);

    const subgraph = workflow.definitions?.subgraphs?.find((sg) => sg.id === currentFrame.id);
    return resolvePromotedWidgetKeys(placeholderNode, subgraph);
  }, [workflow, inSubgraphScope, scopeStack]);
  const isPromotedWidget = (widgetName: string): boolean => {
    if (promotedWidgetKeys.size === 0) return false;
    const direct = widgetName.trim();
    if (promotedWidgetKeys.has(promotedWidgetKey(node.id, direct))) return true;
    const base = direct.split(': ').pop()?.trim() ?? direct;
    return promotedWidgetKeys.has(promotedWidgetKey(node.id, base));
  };
  // A promoted seed's mode control is synthesized by the mobile UI; it has no
  // separate boundary widget key. Treat the whole pair as promoted whenever
  // this card is routing seed mode through the owning placeholder instance.
  const isPromotedSeedBlock = promotedSeedModeNodeId !== undefined ||
    isPromotedWidget('seed') ||
    isPromotedWidget('noise_seed');

  // The renamed label a widget shows, stored the way the desktop frontend
  // stores it: on the node's input slot.
  const widgetInputFor = (widget: WidgetDescriptor) => {
    // The descriptor already knows WHICH slot it came from. Prefer it: on a
    // placeholder several boundary slots can drive inner widgets sharing one
    // canonical name (three promoted primitives all named `value`), and a
    // name-keyed lookup handed every one of them the first slot's rename.
    const slot = widget.inputIndex ?? -1;
    if (slot >= 0 && node.inputs[slot]) return node.inputs[slot];
    const inputName = widget.inputName ?? widget.name;
    return node.inputs.find(
      (input) => input.widget?.name === inputName || input.name === inputName,
    );
  };
  const widgetDisplayLabel = (widget: WidgetDescriptor): string | undefined => {
    const rename = widgetInputFor(widget)?.label;
    const own = typeof rename === 'string' && rename.trim() ? rename.trim() : widget.name;
    const inputName = widget.inputName ?? widget.name;

    // A promoted widget is drawn under one name and drives a slot with another.
    // Name both, in the same shape a connection row uses for the boundary it
    // crosses — "text ⇠ positive" reads "this text widget is the subgraph's
    // positive input", and on the placeholder "positive ⇢ text" reads
    // "positive drives the inner text widget".
    const boundaryLabel = promotedBoundaryLabels[inputName];
    if (boundaryLabel && boundaryLabel !== own) return `${own} ⇠ ${boundaryLabel}`;

    if (isPlaceholder) {
      const targets = boundaryTargetNames[widget.inputIndex ?? -1] ?? [];
      // A label override is presentation, not a second mapping. Compare the
      // target to the boundary slot's canonical name so renaming `seed` to
      // `interpolation_seed` draws just that label. Preserve the arrow when the
      // boundary really does route between differently named fields (for
      // example `positive` driving an inner `text` widget).
      const boundaryName = node.inputs[widget.inputIndex ?? -1]?.name ?? own;
      const differing = targets.filter((name) => name !== boundaryName);
      if (differing.length > 0) return `${own} ⇢ ${differing.join(', ')}`;
    }

    return typeof rename === 'string' && rename.trim() ? rename.trim() : undefined;
  };

  // What "up" and "down" step through: the ROWS this placeholder draws, in
  // boundary order, each row carrying the boundary slots it occupies. Direct
  // proxy widgets have no boundary slot of their own and sit this out.
  //
  // Rows are not slots. A promoted seed and its control_after_generate are
  // drawn as one specialized block, so a card showing three rows can be
  // standing on four slots. Stepping in slot space moved a widget INTO that
  // pair — between the seed and the control that steps it — which splits one
  // visual row in two: the row does not appear to move, and the values shuffle
  // under it. A promoted model combo showing a different model afterwards is
  // this, not the picker misbehaving.
  // Not memoised: it reads `shouldRenderGenericWidget`, which is rebuilt every
  // render, so a useMemo here would recompute anyway while claiming not to.
  // The work is a couple of passes over a handful of widgets.
  const placeholderRowSlots = ((): number[][] => {
    if (!isPlaceholder) return [];
    const allWidgets = [...visibleInputWidgets, ...visibleWidgets];
    // Only the slots the specialized seed block actually draws move as one
    // row: the resolved seed widget, and its control when the block renders
    // one. "Everything the generic list skips" is a wider set — a second
    // promoted seed hidden by the name rule is skipped too, and folding it in
    // merged unrelated slots into the block, so a move jumped across them.
    const blockSlots = allWidgets
      .filter(
        (widget) =>
          rendersSpecializedSeedBlock &&
          ((seedWidgetIndex !== null && widget.widgetIndex === seedWidgetIndex) ||
            (hasSeedControl &&
              seedControlIndex !== null &&
              widget.widgetIndex === seedControlIndex)),
      )
      .map((widget) => widget.inputIndex ?? -1)
      .filter((index) => index >= 0)
      .sort((left, right) => left - right);
    const blockSet = new Set(blockSlots);

    const rows: number[][] = [];
    let seedRowPlaced = false;
    for (const widget of [...allWidgets].sort(
      (left, right) => (left.inputIndex ?? -1) - (right.inputIndex ?? -1),
    )) {
      const slot = widget.inputIndex ?? -1;
      if (slot < 0) continue;
      if (blockSet.has(slot)) {
        // The whole block occupies one place in the order, at its first slot.
        if (!seedRowPlaced) {
          rows.push(blockSlots);
          seedRowPlaced = true;
        }
        continue;
      }
      // A widget the card does not draw (a seed hidden by the name rule)
      // anchors no row: there is no visible row for a move to start from or
      // land on.
      if (!shouldRenderGenericWidget(widget)) continue;
      rows.push([slot]);
    }
    return rows;
  })();

  /**
   * What to call this widget's type in its menu. The node's own input slot is
   * the authority — a promoted STRING still says STRING — and a combo says what
   * kind of list it is rather than the bare word COMBO.
   */
  const widgetTypeLabel = (widget: WidgetDescriptor): string => {
    const slotType = widgetInputFor(widget)?.type;
    const resolved = typeof slotType === 'string' && slotType ? slotType : widget.type;
    const normalized = String(resolved).toUpperCase();
    if (normalized !== 'COMBO') return normalized;
    const options = widget.options;
    const values = Array.isArray(options)
      ? options
      : Array.isArray((options as Record<string, unknown> | undefined)?.options)
        ? ((options as Record<string, unknown>).options as unknown[])
        : [];
    return values.length > 0 ? `COMBO · ${values.length}` : 'COMBO';
  };

  /**
   * The options an "Enqueue with variations" run could sweep for this widget.
   * Empty — so the action hides — unless the value is genuinely this node's to
   * set: a connected widget reads from its link and a server-owned one is
   * rewritten on execution, so varying `widgets_values` for either would queue
   * a batch of identical runs.
   */
  const variationOptions = (widget: WidgetDescriptor): unknown[] => {
    if (widget.connected || widget.disabled) return [];
    return variationOptionsFor(widget.type, widget.options);
  };

  /**
   * Everything this widget can do, gathered for its "…" menu. Kept in one place
   * so the label row carries a single affordance however many actions apply —
   * promotion alone adds three, and they are all conditional on where the value
   * currently lives.
   */
  const buildWidgetMenu = (widget: WidgetDescriptor, canPopOut: boolean) => {
    const inputName = widget.inputName ?? widget.name;
    const promotable = promotableWidgets.find((candidate) => candidate.inputName === inputName);
    const promotedForm = promotedWidgetForms[inputName];
    // On a placeholder, a widget IS a boundary slot, and the card is where the
    // boundary's order is visible — so reordering, renaming and removing the
    // slot belong to this menu rather than to the view from inside.
    const boundarySlot = (isPlaceholder ? widget.inputIndex : undefined) ?? -1;
    const position = boundarySlot >= 0
      ? placeholderRowSlots.findIndex((row) => row.includes(boundarySlot))
      : -1;
    // Up lands before the previous row's FIRST slot; down lands after the next
    // row's LAST one. For a one-slot row those are the same index and this is
    // the old behaviour; for the seed block they are what steps over the pair
    // instead of into it. `moveBoundarySlot` removes then re-inserts, so a
    // downward move's target index is still correct after the removal shifts
    // everything below it up by one.
    const moveUpTo = position > 0 ? placeholderRowSlots[position - 1][0] : null;
    const nextRow =
      position >= 0 && position < placeholderRowSlots.length - 1
        ? placeholderRowSlots[position + 1]
        : null;
    const moveDownTo = nextRow ? nextRow[nextRow.length - 1] : null;
    const pinAllowed = canPinWidget(widget.type, widget.name, widget.options);
    // The RAW rename, never widgetDisplayLabel: that composes "text ⇠ positive"
    // for display, and seeding the field with it wrote the arrow into the saved
    // label — which then composed again on the next render, and again on the
    // next rename.
    // The RAW rename, never widgetDisplayLabel: that composes "text ⇠ positive"
    // for display, and seeding the field with it wrote the arrow into the saved
    // label — which then composed again on the next render, and again on the
    // next rename.
    const storedLabel = widgetInputFor(widget)?.label;
    const currentLabel = typeof storedLabel === 'string' ? storedLabel : '';

    const widgetActions: RowMenuAction[] = [
      {
        key: 'rename',
        label: t('Rename'),
        icon: <EditIcon className="w-4 h-4" />,
        hidden: isPlaceholder ? !(onRenameBoundarySlot && boundarySlot >= 0) : !onRenameWidget,
        onSelect: () => {
          if (isPlaceholder) {
            onRenameBoundarySlot?.(boundarySlot);
            return;
          }
          setRenameDraft(currentLabel);
          setRenameTarget({ inputName, label: currentLabel });
        },
      },
      {
        key: 'pin',
        label: isWidgetPinned(widget.widgetIndex) ? t('Remove pin') : t('Pin widget'),
        icon: <PinIconSvg className="w-4 h-4" />,
        hidden: !pinAllowed,
        onSelect: () => toggleWidgetPin(
          widget.widgetIndex,
          widget.name,
          widget.type,
          widget.options,
          widget.inputName,
        ),
      },
      {
        key: 'move-up',
        label: t('Move up'),
        icon: <ArrowDownIcon className="w-4 h-4 rotate-180" />,
        // Hidden rather than disabled at the top: there is no move to offer.
        hidden: !(onMoveBoundarySlot && moveUpTo !== null),
        onSelect: () => moveUpTo !== null && onMoveBoundarySlot?.(boundarySlot, moveUpTo),
      },
      {
        key: 'move-down',
        label: t('Move down'),
        icon: <ArrowDownIcon className="w-4 h-4" />,
        hidden: !(onMoveBoundarySlot && moveDownTo !== null),
        onSelect: () => moveDownTo !== null && onMoveBoundarySlot?.(boundarySlot, moveDownTo),
      },
      {
        key: 'enqueue-variations',
        label: t('Enqueue with variations'),
        icon: <QueueStackIcon className="w-4 h-4" />,
        // One option is not a comparison, so there is nothing to offer.
        hidden: variationOptions(widget).length < 2,
        onSelect: () => setVariationsTarget(widget),
      },
    ];

    const routingActions: RowMenuAction[] = [
      {
        key: 'pop-out',
        label: t('Pop out widget'),
        icon: <ArrowToDownRightIcon className="w-4 h-4 rotate-90" />,
        hidden: !canPopOut,
        onSelect: () => setPopOutTarget(widget),
      },
      {
        key: 'promote-widget',
        label: t('Promote as widget'),
        icon: <PromotedWidgetIcon className="w-4 h-4" />,
        hidden: !(inSubgraphScope && promotable && onPromoteWidget && !promotedForm),
        onSelect: () => promotable && onPromoteWidget?.(promotable, 'widget'),
      },
      {
        key: 'promote-input',
        label: t('Promote as input'),
        icon: <ArrowToDownRightIcon className="w-4 h-4 rotate-90" />,
        hidden: !(inSubgraphScope && promotable && onPromoteWidget && !promotedForm),
        onSelect: () => promotable && onPromoteWidget?.(promotable, 'input'),
      },
      {
        key: 'to-input',
        label: t('Switch to input'),
        icon: <ArrowToDownRightIcon className="w-4 h-4 rotate-90" />,
        hidden: !(promotedForm === 'widget' && onChangePromotedForm),
        onSelect: () => onChangePromotedForm?.(inputName, 'input'),
      },
      {
        key: 'to-widget',
        label: t('Switch to widget'),
        icon: <PromotedWidgetIcon className="w-4 h-4" />,
        hidden: !(promotedForm === 'input' && onChangePromotedForm),
        onSelect: () => onChangePromotedForm?.(inputName, 'widget'),
      },
      {
        key: 'demote',
        label: t('Unpromote'),
        icon: <NoEntryIcon className="w-4 h-4" />,
        hidden: !(promotedForm && onDemoteWidget),
        onSelect: () => onDemoteWidget?.(inputName),
      },
      {
        key: 'unpromote-slot',
        label: t('Unpromote'),
        icon: <NoEntryIcon className="w-4 h-4" />,
        hidden: !(isPlaceholder && onUnpromoteBoundarySlot && boundarySlot >= 0),
        onSelect: () => onUnpromoteBoundarySlot?.(boundarySlot),
      },
      {
        key: 'remove-slot',
        label: t('Remove input'),
        icon: <NoEntryIcon className="w-4 h-4" />,
        color: 'danger',
        hidden: !(isPlaceholder && onRemoveBoundarySlot && boundarySlot >= 0),
        onSelect: () => onRemoveBoundarySlot?.(boundarySlot),
      },
    ];

    return { primary: widgetActions, secondary: routingActions };
  };

  /**
   * Identity for one widget row's menu: stable across a reorder (so an open
   * menu survives its row being remounted) but unique per row. `inputName`
   * alone is not — two promoted `text` widgets, or two blank trigger-word
   * rows, share it, and with one shared key both menus open and close as one.
   * The boundary slot name (`name`) splits the first case; the trigger-word
   * list's entryIndex splits the second.
   */
  const rowMenuIdentity = (widget: WidgetDescriptor): string => {
    const options = widget.options;
    const entryIndex =
      options && typeof options === 'object' && !Array.isArray(options)
        && typeof (options as { entryIndex?: unknown }).entryIndex === 'number'
        ? (options as { entryIndex: number }).entryIndex
        : '';
    return `${widget.inputName ?? widget.name}:${widget.name}:${entryIndex}`;
  };

  /**
   * The "…" menu for one widget row. Every render path goes through this rather
   * than assembling the props itself — the seed block, the CR-LoRA rows and the
   * synthetic control-mode widget each had their own WidgetControl call and so
   * each silently had no menu at all.
   */
  const rowMenuFor = (widget: WidgetDescriptor, canPopOut = false) => (
    <RowActionsMenu
      menuKey={`widget:${menuScopeKey}:${node.id}:${rowMenuIdentity(widget)}`}
      rowName={widget.name}
      typeLabel={widgetTypeLabel(widget)}
      note={
        isPlaceholder && instanceCount > 1 && onMoveBoundarySlot
          ? t('Order is shared by all {count} instances', { count: instanceCount })
          : undefined
      }
      sections={buildWidgetMenu(widget, canPopOut)}
    />
  );

  /** A row that the card synthesizes rather than reading from the widget list. */
  const syntheticWidget = (
    widget: Pick<WidgetDescriptor, 'widgetIndex' | 'name' | 'type' | 'value'>
      & Partial<WidgetDescriptor>,
  ): WidgetDescriptor => ({
    inputName: widget.inputName ?? widget.name,
    inputIndex: node.inputs.findIndex(
      (input) => (input.widget?.name ?? input.name) === (widget.inputName ?? widget.name),
    ),
    ...widget,
  });

  const handleSeedModeValue = (newValue: unknown) => {
    const validModes = ['fixed', 'randomize', 'increment', 'decrement'];
    if (typeof newValue === 'string' && validModes.includes(newValue)) {
      setSeedMode(seedModeNodeId, newValue as 'fixed' | 'randomize' | 'increment' | 'decrement');
    }
  };

  const handleSeedControlChange = (controlIndex: number) => (newValue: unknown) => {
    onUpdateNodeWidget(controlIndex, newValue);
    handleSeedModeValue(newValue);
  };

  const handleSeedValueChange = (seedIndex: number) => (newValue: number) => {
    onUpdateNodeWidget(seedIndex, newValue, 'seed');
    setSeedMode(seedModeNodeId, 'fixed');
  };

  const handleSeedNewFixedRandomClick = (seedIndex: number) => () => {
    if (!nodeTypes) return;
    const nextSeed = generateSeedFromNode(nodeTypes, node);
    onUpdateNodeWidget(seedIndex, nextSeed, 'seed');
    setSeedMode(seedModeNodeId, 'fixed');
  };

  const handleSeedUseLastClick = (seedIndex: number) => () => {
    if (typeof lastSeedValue !== 'number') return;
    onUpdateNodeWidget(seedIndex, lastSeedValue, 'seed');
    setSeedMode(seedModeNodeId, 'fixed');
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

  const canPinWidget = (
    widgetType: string,
    widgetName: string,
    options?: Record<string, unknown> | unknown[],
  ) => {
    if (widgetType.startsWith('LM_LORA')) return false;
    if (widgetType.startsWith('TW_')) return false;
    if (isLoraManagerNode && widgetName === 'text') return false;
    return supportsPinnedWidgetEditor(widgetType, options);
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

    // Power Puter's outputs widget doubles as the node's output slot list, so it
    // cannot go through the plain widget-value path: the store action also
    // rebuilds `node.outputs` and drops links left dangling by a removed slot.
    if (widget.type === 'POWER_PUTER_OUTPUTS') {
      if (!node.itemKey || !Array.isArray(newValue)) return;
      const outputs = (newValue as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string' && entry.length > 0,
      );
      if (outputs.length === 0) return;
      setPowerPuterOutputs(node.itemKey, widget.widgetIndex, outputs);
      return;
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

  const promotedSeedBlock: ReactNode =
    !isKSampler && workflowExists && nodeTypesExists
      ? (() => {
          const seedIndex = seedWidgetIndex;
          if (seedIndex === null) return null;
          const baseChoices = ['fixed', 'randomize', 'increment', 'decrement'];
          const choices = typeof seedControlValue === 'string' && !baseChoices.includes(seedControlValue)
            ? [...baseChoices, seedControlValue]
            : baseChoices;
          if (seedInputEntry?.link != null && promotedSeedModeNodeId === undefined) return null;

          const seedWidget = [...visibleInputWidgets, ...visibleWidgets].find(
            (widget) => widget.widgetIndex === seedIndex,
          );
          const seedOptions = (seedWidget?.options ?? {}) as Record<string, unknown>;
          const rawSeedValue = Number((resolveWidgetValue ? resolveWidgetValue(seedIndex) : widgetValues[seedIndex]) ?? 0);
          const seedLabel = seedWidget && (seedWidget.inputIndex ?? -1) >= 0
            ? widgetDisplayLabel(seedWidget) ?? seedWidget.name
            : 'seed';
          const seedMenuWidget = seedWidget
            ? { ...seedWidget, value: rawSeedValue }
            : syntheticWidget({
                widgetIndex: seedIndex,
                name: 'seed',
                inputName: 'seed',
                type: 'INT',
                value: rawSeedValue,
                options: seedOptions,
              });
          const min = typeof seedOptions.min === 'number' ? seedOptions.min : undefined;
          const max = typeof seedOptions.max === 'number' ? seedOptions.max : undefined;
          const step = typeof seedOptions.step === 'number' ? seedOptions.step : undefined;

          if (hasSeedControl) {
            const controlIndex = seedControlIndex ?? seedIndex + 1;
            // The node's own control_after_generate drives the seed, so pair
            // the two: the value sits directly above the control that steps
            // it, the way desktop orders them. Without this the seed stayed
            // down in the generic widget list, detached from its control.
            return (
              <div className="seed-control-widget">
                <NumberControl
                  name={seedLabel}
                  value={rawSeedValue}
                  onChange={handleSeedValueChange(seedIndex)}
                  disabled={isBypassed}
                  labelAccessory={rowMenuFor(seedMenuWidget)}
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
                  labelAccessory={rowMenuFor(syntheticWidget({
                    widgetIndex: controlIndex,
                    name: t('Seed control'),
                    inputName: 'control_after_generate',
                    type: 'COMBO',
                    value: seedControlValue,
                    options: choices,
                  }))}
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
                name={seedLabel}
                value={displaySeedValue}
                onChange={handleSeedValueChange(seedIndex)}
                disabled={isBypassed}
                min={min}
                max={max}
                step={step}
                hasError={hasSeedError}
                isPromoted={isPromotedSeedBlock}
                labelAccessory={rowMenuFor(seedMenuWidget)}
              />
              {!isRgthreeSeedNode && (
                <WidgetControl
                  name={t('Seed control')}
                  type="COMBO"
                  value={seedMode}
                  options={baseChoices}
                  onChange={handleSeedModeValue}
                  isPromoted={isPromotedSeedBlock}
                  compactTrailingControls
                  labelAccessory={rowMenuFor(syntheticWidget({
                    widgetIndex: seedIndex,
                    name: t('Seed control'),
                    inputName: 'control_after_generate',
                    type: 'COMBO',
                    value: seedMode,
                    options: baseChoices,
                  }))}
                />
              )}
              <div className="grid gap-2 mt-2">
                <button
                  type="button"
                  className={controlSecondaryButtonClassName}
                  onClick={() => setSeedMode(seedModeNodeId, 'randomize')}
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
      })()
      : null;

  const placeholderSeedSlot = ((): number => {
    if (!isPlaceholder || !rendersSpecializedSeedBlock || seedWidgetIndex === null) return -1;
    const seedWidget = [...visibleInputWidgets, ...visibleWidgets].find(
      (widget) => widget.widgetIndex === seedWidgetIndex,
    );
    return seedWidget?.inputIndex ?? -1;
  })();
  const seedBlockDrawsInline = placeholderSeedSlot >= 0 && promotedSeedBlock !== null;

  /** One COMBO row. */
  const renderComboRow = (inputWidget: WidgetDescriptor): ReactNode => (
    // Identified so a jump can land on this row rather than on the
    // whole card — an undo of a widget edit goes to the widget.
    // The wrapper carries it, not the control, so combos (which
    // WidgetControl hands off before it draws its own markup) are
    // addressable on the same terms as everything else.
    <div
      key={getWidgetKey(inputWidget, 'input-widget')}
      id={widgetRowDomId(node.id, inputWidget.widgetIndex)}
      className={isBypassed ? 'opacity-80' : ''}
    >
      <WidgetControl
        name={inputWidget.name}
        displayLabel={widgetDisplayLabel(inputWidget)}
        type={inputWidget.type}
        value={inputWidget.value}
        options={inputWidget.options}
        onChange={handleInputWidgetChange(inputWidget)}
        disabled={isBypassed}
        isPinned={canPinWidget(inputWidget.type, inputWidget.name, inputWidget.options) ? isWidgetPinned(inputWidget.widgetIndex) : false}
        onTogglePin={canPinWidget(inputWidget.type, inputWidget.name, inputWidget.options) ? () => toggleWidgetPin(inputWidget.widgetIndex, inputWidget.name, inputWidget.type, inputWidget.options, inputWidget.inputName) : undefined}
        hasError={hasWidgetError(inputWidget)}
        isPromoted={isPromotedWidget(inputWidget.name)}
        labelAccessory={
          <RowActionsMenu
            // Identity, not position: the row is remounted by a
            // reorder, and the menu has to survive that.
            menuKey={`widget:${menuScopeKey}:${node.id}:${rowMenuIdentity(inputWidget)}`}
            rowName={inputWidget.name}
            typeLabel={widgetTypeLabel(inputWidget)}
            sections={buildWidgetMenu(inputWidget, false)}
          />
        }
      />
    </div>
  );

  /** One non-COMBO row. */
  const renderValueRow = (widget: WidgetDescriptor): ReactNode => {
    const canPopOut =
      !isBypassed && !isSingleWidgetOnlyNode && Boolean(node.itemKey) && canPopOutWidget(widget);
    return (
      <div
        key={getWidgetKey(widget, 'widget')}
        id={widgetRowDomId(node.id, widget.widgetIndex)}
        className={isBypassed ? 'opacity-80' : ''}
      >
        <WidgetControl
          name={widget.name}
          displayLabel={widgetDisplayLabel(widget)}
          type={widget.type}
          value={widget.value}
          options={widget.options}
          onChange={handleWidgetChange(widget)}
          disabled={isBypassed || widget.disabled === true}
          isPinned={canPinWidget(widget.type, widget.name, widget.options) ? isWidgetPinned(widget.widgetIndex) : false}
          onTogglePin={canPinWidget(widget.type, widget.name, widget.options) ? () => toggleWidgetPin(widget.widgetIndex, widget.name, widget.type, widget.options, widget.inputName) : undefined}
          hasError={hasWidgetError(widget)}
          isPromoted={isPromotedWidget(widget.name)}
          labelAccessory={
            rowMenuFor(widget, canPopOut)
          }
        />
      </div>
    );
  };

  /**
   * Every row this card draws, in the order the boundary declares.
   *
   * Only placeholders use it. Elsewhere the two lists and the seed block keep
   * their own grouping, which is fine because nothing there is reorderable —
   * but on a placeholder the drawn order IS the boundary order the Move
   * actions step through, so the two have to be one list.
   */
  const orderedPlaceholderRows = ((): ReactNode[] => {
    if (!isPlaceholder) return [];
    const rows: { slot: number; node: ReactNode }[] = [
      ...inputWidgetsToRender.map((widget) => ({
        slot: widget.inputIndex ?? -1,
        node: renderComboRow(widget),
      })),
      ...widgetsToRender.map((widget) => ({
        slot: widget.inputIndex ?? -1,
        node: renderValueRow(widget),
      })),
      // The widget rows carry their own keys; the seed block is a bare
      // element, so it needs one to sit in this list.
      ...(seedBlockDrawsInline
        ? [{
            slot: placeholderSeedSlot,
            node: <Fragment key="promoted-seed-block">{promotedSeedBlock}</Fragment>,
          }]
        : []),
    ];
    return rows.sort((left, right) => left.slot - right.slot).map((row) => row.node);
  })();

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
          label="parameters"
        />
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-px min-w-0 flex-1 bg-slate-700" aria-hidden="true" />
        </div>
      </div>
      <Collapsible
        open={parametersExpanded}
        // The node card's animated wrapper clips overflow. Keep enough room
        // below the trailing widget for its focus ring, matching the horizontal
        // clearance the card already reserves around its expanded content.
        className={`parameters-section-content pb-1 ${firstParameterHasStandardTopPadding ? '-mt-2' : ''}`}
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
                  labelAccessory={rowMenuFor(syntheticWidget({
                    widgetIndex: seedIndex,
                    name: 'seed',
                    type: 'INT',
                    value: seedValue,
                  }))}
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
                    labelAccessory={rowMenuFor(syntheticWidget({
                      widgetIndex: seedControlIndex,
                      name: t('Control mode'),
                      inputName: 'control_after_generate',
                      type: 'COMBO',
                      value: seedControlValue,
                      options: seedControlChoices,
                    }))}
                  />
                )}
              </div>
            );
          })()}
          {!seedBlockDrawsInline && promotedSeedBlock}
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
                              const pinAllowed = canPinWidget(widget.type, widget.name, widget.options);
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
                                    labelAccessory={rowMenuFor(widget)}
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
                const pinAllowed = canPinWidget(widget.type, widget.name, widget.options);
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
                      labelAccessory={rowMenuFor(widget)}
                    />
                  </div>
                );
              })}
            </>
          ) : (
            <>
              {isPlaceholder ? orderedPlaceholderRows : (
                <>
                {inputWidgetsToRender.map((inputWidget) => (
                  // Identified so a jump can land on this row rather than on the
                  // whole card — an undo of a widget edit goes to the widget.
                  // The wrapper carries it, not the control, so combos (which
                  // WidgetControl hands off before it draws its own markup) are
                  // addressable on the same terms as everything else.
                  <div
                    key={getWidgetKey(inputWidget, 'input-widget')}
                    id={widgetRowDomId(node.id, inputWidget.widgetIndex)}
                    className={isBypassed ? 'opacity-80' : ''}
                  >
                    <WidgetControl
                      name={inputWidget.name}
                      displayLabel={widgetDisplayLabel(inputWidget)}
                      type={inputWidget.type}
                      value={inputWidget.value}
                      options={inputWidget.options}
                      onChange={handleInputWidgetChange(inputWidget)}
                      disabled={isBypassed}
                      isPinned={canPinWidget(inputWidget.type, inputWidget.name, inputWidget.options) ? isWidgetPinned(inputWidget.widgetIndex) : false}
                      onTogglePin={canPinWidget(inputWidget.type, inputWidget.name, inputWidget.options) ? () => toggleWidgetPin(inputWidget.widgetIndex, inputWidget.name, inputWidget.type, inputWidget.options, inputWidget.inputName) : undefined}
                      hasError={hasWidgetError(inputWidget)}
                      isPromoted={isPromotedWidget(inputWidget.name)}
                      labelAccessory={
                        <RowActionsMenu
                          // Identity, not position: the row is remounted by a
                          // reorder, and the menu has to survive that.
                          menuKey={`widget:${menuScopeKey}:${node.id}:${rowMenuIdentity(inputWidget)}`}
                          rowName={inputWidget.name}
                          typeLabel={widgetTypeLabel(inputWidget)}
                          sections={buildWidgetMenu(inputWidget, false)}
                        />
                      }
                    />
                  </div>
                ))}
                {widgetsToRender.map((widget) => {
                  const canPopOut =
                    !isBypassed && !isSingleWidgetOnlyNode && Boolean(node.itemKey) && canPopOutWidget(widget);
                  return (
                    <div
                      key={getWidgetKey(widget, 'widget')}
                      id={widgetRowDomId(node.id, widget.widgetIndex)}
                      className={isBypassed ? 'opacity-80' : ''}
                    >
                      <WidgetControl
                        name={widget.name}
                        displayLabel={widgetDisplayLabel(widget)}
                        type={widget.type}
                        value={widget.value}
                        options={widget.options}
                        onChange={handleWidgetChange(widget)}
                        disabled={isBypassed || widget.disabled === true}
                        isPinned={canPinWidget(widget.type, widget.name, widget.options) ? isWidgetPinned(widget.widgetIndex) : false}
                        onTogglePin={canPinWidget(widget.type, widget.name, widget.options) ? () => toggleWidgetPin(widget.widgetIndex, widget.name, widget.type, widget.options, widget.inputName) : undefined}
                        hasError={hasWidgetError(widget)}
                        isPromoted={isPromotedWidget(widget.name)}
                        labelAccessory={
                          rowMenuFor(widget, canPopOut)
                        }
                      />
                    </div>
                  );
                })}
                </>
              )}
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
                  labelAccessory={rowMenuFor(syntheticWidget({
                    widgetIndex: 1,
                    name: t('Control mode'),
                    inputName: 'control_after_generate',
                    type: 'COMBO',
                    value: controlValue,
                    options: controlChoices,
                  }))}
                />
              </div>
            );
          })()}
        </>
      )}
      </Collapsible>
      {renameTarget && onRenameWidget && (
        <Dialog
          onClose={() => setRenameTarget(null)}
          title={t('Rename widget')}
          description={
            <input
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              placeholder={renameTarget.inputName}
              data-swipe-nav-ignore="true"
              className="mt-3 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              autoFocus
            />
          }
          actions={[
            { label: t('Cancel'), onClick: () => setRenameTarget(null), variant: 'secondary' },
            {
              label: t('Rename'),
              onClick: () => {
                onRenameWidget(renameTarget.inputName, renameDraft);
                setRenameTarget(null);
              },
              variant: 'primary',
              autoFocus: true,
            },
          ]}
        />
      )}
      {variationsTarget && (
        <WidgetVariationsModal
          target={{
            nodeId: node.id,
            // The scope the card is being viewed in owns the node: at root that
            // is workflow.nodes, inside a subgraph it is that definition's.
            subgraphId: currentScopeFrame?.type === 'subgraph' ? currentScopeFrame.id : null,
            widgetIndex: variationsTarget.widgetIndex,
          }}
          widgetName={variationsTarget.name}
          nodeName={resolveWorkflowNodeDisplayName(workflow, node, nodeTypes)}
          options={variationOptions(variationsTarget)}
          currentValue={variationsTarget.value}
          onClose={() => setVariationsTarget(null)}
        />
      )}
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
