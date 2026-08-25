import { t } from "@/i18n";
import type { NodeTypes, Workflow, WorkflowNode } from "@/api/types";
import type { NodeError } from "@/hooks/useWorkflowErrors";
import { getWidgetIndexForInput } from "@/utils/seedUtils";
import {
  getComboOptions,
  getWidgetValue,
  isMultiSelectCombo,
  isComboType,
  isFileLikeToken,
  optionsAreFileLike,
  normalizeWidgetValue,
  resolveComboOption,
  orderedInputNames,
} from "@/utils/workflowInputs";

/**
 * Widget-value normalization and load-error reporting for imported/restored
 * workflows. Pure functions over the workflow graph — extracted from the
 * useWorkflow store body so they can be unit-tested without instantiating
 * the zustand store (mirrors `./metadataNormalization`).
 */

interface ActiveComboWidget {
  name: string;
  inputOptions: Record<string, unknown> | undefined;
  comboOptions: unknown[];
  widgetIndex: number;
  rawValue: unknown;
}

// Both passes below (missing-value detection and value normalization) must
// visit exactly the same widgets: declared combo inputs that are not already
// linked and that carry a stored value. Sharing the walk means the two can
// never drift apart.
function* iterActiveComboWidgets(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  node: WorkflowNode,
): Generator<ActiveComboWidget> {
  const typeDef = nodeTypes[node.type];
  if (!typeDef?.input) return;
  for (const name of orderedInputNames(typeDef)) {
    const inputDef =
      typeDef.input.required?.[name] || typeDef.input.optional?.[name];
    if (!inputDef) continue;
    const [typeOrOptions, inputOptions] = inputDef;
    if (!isComboType(typeOrOptions)) continue;
    const comboOptions = getComboOptions(typeOrOptions, inputOptions);
    if (comboOptions.length === 0) continue;
    const inputEntry = node.inputs.find((input) => input.name === name);
    if (inputEntry?.link != null) continue;
    const widgetIndex = getWidgetIndexForInput(
      workflow,
      nodeTypes,
      node,
      name,
    );
    if (widgetIndex === null) continue;
    const rawValue = getWidgetValue(node, name, widgetIndex);
    if (rawValue === undefined || rawValue === null) continue;
    yield { name, inputOptions, comboOptions, widgetIndex, rawValue };
  }
}

function collectWorkflowLoadErrors(
  workflow: Workflow,
  nodeTypes: NodeTypes,
): Record<string, NodeError[]> {
  const errors: Record<string, NodeError[]> = {};

  for (const node of workflow.nodes) {
    if (node.mode === 4) continue;

    for (const { name, inputOptions, comboOptions, rawValue } of iterActiveComboWidgets(
      workflow,
      nodeTypes,
      node,
    )) {
      const rawValues = isMultiSelectCombo(inputOptions)
        ? Array.isArray(rawValue) ? rawValue : [rawValue]
        : [rawValue];
      for (const rawEntry of rawValues) {
        const resolved = resolveComboOption(rawEntry, comboOptions);
        const normalized = normalizeWidgetValue(rawEntry, comboOptions, {
          comboIndexToValue: true,
        });
        const normalizedString = String(normalized);
        const normalizedBase =
          normalizedString.split(/[\\/]/).pop() ?? normalizedString;
        const hasMatch =
          resolved !== undefined ||
          comboOptions.some((opt) => {
            const optString = String(opt);
            return optString === normalizedString || optString === normalizedBase;
          });

        // Closed-enum combos are corrected at queue time. File-picker values
        // stay untouched, so report each missing multi-select member separately.
        if (!hasMatch && (optionsAreFileLike(comboOptions) || isFileLikeToken(normalizedString))) {
          const nodeId = String(node.id);
          if (!errors[nodeId]) {
            errors[nodeId] = [];
          }
          errors[nodeId].push({
            type: "workflow_load",
            message: t('Missing value: {value}', { value: normalizedString }),
            details: t("Not found on server."),
            inputName: name,
          });
        }
      }
    }
  }

  return errors;
}

function normalizeWorkflowComboValues(
  workflow: Workflow,
  nodeTypes: NodeTypes
): { workflow: Workflow; changed: boolean } {
  let changed = false;

  const nodes = workflow.nodes.map((node) => {
    if (!Array.isArray(node.widgets_values)) return node;
    let nextValues: unknown[] | null = null;

    for (const { inputOptions, comboOptions, widgetIndex, rawValue } of iterActiveComboWidgets(
      workflow,
      nodeTypes,
      node,
    )) {
      const normalized = isMultiSelectCombo(inputOptions)
        ? (Array.isArray(rawValue) ? rawValue : [rawValue]).map(
            (entry) => resolveComboOption(entry, comboOptions) ?? entry,
          )
        : resolveComboOption(rawValue, comboOptions);
      // Loading may canonicalize a value that genuinely resolves (basename,
      // legacy numeric index, Unicode display equivalent), but an unavailable
      // value must remain intact so the UI can show it as missing. Queue-time
      // normalization remains responsible for closed-enum fallbacks.
      if (normalized === undefined) continue;
      const unchanged = Array.isArray(rawValue) && Array.isArray(normalized)
        ? rawValue.length === normalized.length && rawValue.every(
            (entry, index) => Object.is(entry, normalized[index]),
          )
        : Object.is(rawValue, normalized);
      if (unchanged) continue;

      if (!nextValues) {
        nextValues = [...node.widgets_values];
      }
      nextValues[widgetIndex] = normalized;
      changed = true;
    }

    if (!nextValues) return node;
    return { ...node, widgets_values: nextValues };
  });

  if (!changed) {
    return { workflow, changed: false };
  }

  return {
    workflow: { ...workflow, nodes },
    changed: true
  };
}

export { collectWorkflowLoadErrors, normalizeWorkflowComboValues };
