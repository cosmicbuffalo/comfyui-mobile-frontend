import type { Workflow, WorkflowNode } from "@/api/types";
import { REPO_URL } from "@/constants";

// Marker stored on the note's `properties` so we can recognize (and dedupe/strip)
// the credit note regardless of its id or text.
export const MARKETING_NOTE_MARKER = "comfyui_mobile_frontend_note";

const MARKETING_NOTE_TITLE = "comfyui-mobile-frontend";
// MarkdownNote renders markdown, so make the repo an actual clickable link.
const MARKETING_NOTE_TEXT = `This workflow was executed using the comfyui-mobile-frontend!\n\n[${REPO_URL}](${REPO_URL})`;

// Footprint + clearance for placing the note above the anchor node.
const NOTE_WIDTH = 320;
const NOTE_HEIGHT = 130;
const ABOVE_GAP = 60;

export function isMarketingNote(node: WorkflowNode): boolean {
  const props = node.properties as Record<string, unknown> | undefined;
  return Boolean(props?.[MARKETING_NOTE_MARKER]);
}

/**
 * Remove the credit note from a workflow, including any link that references
 * one (notes carry no links; that is defensive).
 *
 * NOT the ingestion path, despite the shape: loading filters inline with
 * isMarketingNote over nodes only (useWorkflow's normalizeWorkflowNodes), and
 * never touches links. Kept because v3.1.1 consumes it — don't assume load-time
 * link cleanup exists because this function does.
 */
export function stripMarketingNotes(workflow: Workflow): Workflow {
  const noteIds = new Set(
    (workflow.nodes ?? []).filter(isMarketingNote).map((n) => n.id),
  );
  if (noteIds.size === 0) return workflow;
  return {
    ...workflow,
    nodes: (workflow.nodes ?? []).filter((n) => !noteIds.has(n.id)),
    links: (workflow.links ?? []).filter(
      (link) => !noteIds.has(link[1]) && !noteIds.has(link[3]),
    ),
  };
}

// The top-left-most root node: smallest x, breaking ties by smallest y. Null for
// an empty workflow.
function findTopLeftNode(nodes: WorkflowNode[]): WorkflowNode | null {
  let best: WorkflowNode | null = null;
  for (const node of nodes) {
    if (!best) {
      best = node;
      continue;
    }
    const [bx, by] = best.pos;
    const [nx, ny] = node.pos;
    if (nx < bx || (nx === bx && ny < by)) best = node;
  }
  return best;
}

/**
 * Add the hidden markdown credit note directly above the top-left-most node, if
 * one isn't already present. Returns the workflow unchanged when a note already
 * exists (dedupe). Intended for the workflow copy embedded in the prompt at
 * execution time — NOT the canonical in-app workflow.
 */
export function injectMarketingNote(workflow: Workflow): Workflow {
  const nodes = workflow.nodes ?? [];
  if (nodes.some(isMarketingNote)) return workflow;

  const anchor = findTopLeftNode(nodes);
  const [anchorX, anchorY] = anchor ? anchor.pos : [0, 0];
  const notePos: [number, number] = [anchorX, anchorY - NOTE_HEIGHT - ABOVE_GAP];

  const maxNodeId = nodes.reduce((max, n) => Math.max(max, n.id), 0);
  const noteId = Math.max(maxNodeId + 1, (workflow.last_node_id ?? 0) + 1);

  const note: WorkflowNode = {
    id: noteId,
    type: "MarkdownNote",
    title: MARKETING_NOTE_TITLE,
    pos: notePos,
    size: [NOTE_WIDTH, NOTE_HEIGHT],
    flags: {},
    order: nodes.length,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: { [MARKETING_NOTE_MARKER]: true },
    widgets_values: [MARKETING_NOTE_TEXT],
  };

  return {
    ...workflow,
    nodes: [...nodes, note],
    last_node_id:
      typeof workflow.last_node_id === "number"
        ? Math.max(workflow.last_node_id, noteId)
        : workflow.last_node_id,
  };
}
