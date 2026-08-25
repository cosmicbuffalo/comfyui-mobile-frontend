import type { Workflow, WorkflowNode } from '@/api/types';
import { collectAllWorkflowNodes } from '@/utils/workflowNodes';
import { getWidgetValue, getWorkflowWidgetIndexMap } from './widgetSlots';

const DATE_PARTS = {
  d: (date: Date) => date.getDate(),
  M: (date: Date) => date.getMonth() + 1,
  h: (date: Date) => date.getHours(),
  m: (date: Date) => date.getMinutes(),
  s: (date: Date) => date.getSeconds(),
};

const DATE_FORMAT_PATTERN =
  Object.keys(DATE_PARTS)
    .map((key) => `${key}${key}?`)
    .join("|") + "|yyy?y?";

const ILLEGAL_FILENAME_CHARS =
  // eslint-disable-next-line no-control-regex
  /[/?<>\\:*|"\x00-\x1F\x7F]/g;

function formatDateToken(text: string, date: Date): string {
  return text.replace(new RegExp(DATE_FORMAT_PATTERN, "g"), (token: string): string => {
    if (token === "yy") return `${date.getFullYear()}`.substring(2);
    if (token === "yyyy") return date.getFullYear().toString();
    if (token[0] in DATE_PARTS) {
      const part = DATE_PARTS[token[0] as keyof typeof DATE_PARTS](date);
      return `${part}`.padStart(token.length, "0");
    }
    return token;
  });
}

function resolveReplacementWidgetValue(
  workflow: Workflow,
  node: WorkflowNode,
  widgetName: string,
): unknown {
  const widgetIndexMap = getWorkflowWidgetIndexMap(workflow, node.id);
  const mappedIndex = widgetIndexMap?.[widgetName];
  if (mappedIndex !== undefined) {
    return getWidgetValue(node, widgetName, mappedIndex);
  }

  return getWidgetValue(node, widgetName, undefined);
}

function applyTextReplacements(workflow: Workflow, value: string): string {
  const allNodes = collectAllWorkflowNodes(workflow);

  return value.replace(/%([^%]+)%/g, (match, text: string) => {
    const split = text.split(".");
    if (split.length !== 2) {
      if (split[0]?.startsWith("date:")) {
        return formatDateToken(split[0].substring(5), new Date());
      }

      if (text !== "width" && text !== "height") {
        console.warn("[workflowInputs] Invalid replacement pattern", text);
      }
      return match;
    }

    let nodes = allNodes.filter(
      (nodeItem) => nodeItem.properties?.["Node name for S&R"] === split[0]
    );
    if (!nodes.length) {
      nodes = allNodes.filter(
        (nodeItem) => (nodeItem as { title?: unknown }).title === split[0]
      );
    }
    if (!nodes.length) {
      console.warn("[workflowInputs] Unable to find node", split[0]);
      return match;
    }
    if (nodes.length > 1) {
      console.warn("[workflowInputs] Multiple nodes matched", split[0], "using first match");
    }

    const node = nodes[0];
    const widgetValue = resolveReplacementWidgetValue(workflow, node, split[1]);
    if (widgetValue === undefined) {
      console.warn(
        "[workflowInputs] Unable to find widget",
        split[1],
        "on node",
        split[0],
        node
      );
      return match;
    }

    return `${widgetValue ?? ""}`.replace(ILLEGAL_FILENAME_CHARS, "_");
  });
}

export function finalizeInputValue(
  workflow: Workflow,
  inputName: string,
  value: unknown,
): unknown {
  if (inputName === "filename_prefix" && typeof value === "string") {
    return applyTextReplacements(workflow, value);
  }
  return value;
}
