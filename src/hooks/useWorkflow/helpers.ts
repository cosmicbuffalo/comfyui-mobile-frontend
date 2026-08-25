import { t } from "@/i18n";
import type { Workflow } from "@/api/types";
import type { WorkflowSource } from "./state";

/**
 * Small pure helpers for the useWorkflow store: browser-paint yielding,
 * display-name / queue-label derivation, and the widget-index-map cleanup.
 * Extracted verbatim from `../useWorkflow.ts` (mirrors `./metadataNormalization`).
 */

export function yieldToBrowserPaint(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();

  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.setTimeout(resolve, 0);
      });
      return;
    }

    window.setTimeout(resolve, 0);
  });
}

export function workflowDisplayName(filename: string): string {
  const basename = filename.includes("/")
    ? filename.substring(filename.lastIndexOf("/") + 1)
    : filename;
  return basename.replace(/\.json$/, "");
}

export function queueWorkflowLabel(
  filename: string | null,
  source: WorkflowSource | null,
): string {
  if (filename) return workflowDisplayName(filename);
  if (source?.type === "template") return source.templateName;
  return t("Untitled");
}

/** Drop a root node's workflow-level widget-index-map entries (both the
 *  top-level and `extra` locations Lora Manager writes to). Used after a
 *  DynamicCombo rebuild renumbers the node's slots, which makes any recorded
 *  indices stale by construction. */
export function stripNodeWidgetIndexMap(workflow: Workflow, nodeId: number): Workflow {
  const key = String(nodeId);
  let next = workflow;
  if (next.widget_idx_map?.[key]) {
    const rest = { ...next.widget_idx_map };
    delete rest[key];
    next = { ...next, widget_idx_map: rest };
  }
  const extraMap = next.extra?.widget_idx_map as
    | Record<string, Record<string, number>>
    | undefined;
  if (extraMap?.[key]) {
    const rest = { ...extraMap };
    delete rest[key];
    next = { ...next, extra: { ...next.extra, widget_idx_map: rest } };
  }
  return next;
}
