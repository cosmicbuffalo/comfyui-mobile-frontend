// This module is now a thin re-export hub; the implementation lives in the
// sibling modules grouped by concern. Importers keep working because every
// public symbol is re-exported here unchanged.
export {
  getWidgetValue,
  getWorkflowWidgetIndexMap,
  skipImplicitSeedControlSlot,
  getNodePropertyWidgetIndexMap,
  getNodeWidgetIndexMap,
  isWidgetInputType,
} from './workflowInputs/widgetSlots';
export {
  isV3ComboType,
  isComboType,
  isMultiSelectCombo,
  DYNAMIC_COMBO_V3,
  orderedInputNames,
  getComboOptions,
  getDynamicComboSubInputs,
  normalizeWidgetValue,
  normalizeComboValue,
  isFileLikeToken,
  optionsAreFileLike,
  resolveComboOption,
  isValueCompatible,
} from './workflowInputs/comboValues';
export type { DynamicComboSubInput } from './workflowInputs/comboValues';
export {
  isWidgetBackedInput,
  isConnectionSocketInput,
  getDefaultWidgetValue,
  buildDefaultWidgetValues,
  buildDefaultConnectionInputs,
  getDynamicComboConnectionInputs,
} from './workflowInputs/defaultInputs';
export type { ConnectionInputDefinition } from './workflowInputs/defaultInputs';
export {
  occupiesWidgetSlot,
  getActiveNodeInputDefinitions,
  rebuildDynamicComboWidgetValues,
  rebuildDynamicComboNode,
} from './workflowInputs/dynamicComboRebuild';
export type { ActiveNodeInputDefinition, DynamicComboNodeRebuild } from './workflowInputs/dynamicComboRebuild';
export { resolveSource, buildWorkflowPromptInputs } from './workflowInputs/promptInputs';
