import type { Workflow } from '@/api/types';
import {
  extractWorkflowFromImageFile,
  isWorkflowImageFile,
} from '@/utils/imageWorkflowMetadata';

export type WorkflowFileResult =
  | { kind: 'workflow'; workflow: Workflow; filename: string }
  // A recognized image that simply carries no embedded workflow (user-facing
  // "this image has no workflow" modal).
  | { kind: 'no-workflow'; filename: string }
  // A non-image file we couldn't parse as a workflow (e.g. malformed JSON).
  | { kind: 'invalid'; message: string };

function looksLikeJson(file: File): boolean {
  return (
    file.type === 'application/json' ||
    file.name.toLowerCase().endsWith('.json')
  );
}

function validateWorkflowShape(data: unknown): data is Workflow {
  return Boolean(
    data &&
      typeof data === 'object' &&
      Array.isArray((data as { nodes?: unknown }).nodes),
  );
}

/**
 * Read a user-provided file (from the device picker or a drag-and-drop) and
 * resolve to either the embedded workflow, a "no workflow in this image" signal,
 * or an "invalid file" error. Images are parsed entirely client-side via their
 * embedded metadata; .json files are parsed as a litegraph workflow.
 */
export async function readWorkflowFromFile(file: File): Promise<WorkflowFileResult> {
  if (isWorkflowImageFile(file)) {
    let workflow: Workflow | null = null;
    try {
      workflow = await extractWorkflowFromImageFile(file);
    } catch {
      workflow = null;
    }
    return workflow
      ? { kind: 'workflow', workflow, filename: file.name }
      : { kind: 'no-workflow', filename: file.name };
  }

  if (looksLikeJson(file)) {
    try {
      const data = JSON.parse(await file.text());
      if (!validateWorkflowShape(data)) {
        return { kind: 'invalid', message: 'Invalid workflow: missing nodes array' };
      }
      return { kind: 'workflow', workflow: data, filename: file.name };
    } catch (err) {
      return {
        kind: 'invalid',
        message: err instanceof Error ? err.message : 'Failed to read workflow file',
      };
    }
  }

  return { kind: 'invalid', message: 'Unsupported file type. Drop a workflow .json or an image.' };
}
