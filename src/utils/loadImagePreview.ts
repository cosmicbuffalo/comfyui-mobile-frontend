import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { getWidgetIndexForInput } from '@/hooks/useWorkflow';

export interface LoadImagePreview {
  filename: string;
  subfolder: string;
  type: string;
}

export function resolveLoadImagePreview(
  workflow: Workflow,
  nodeTypes: NodeTypes | null,
  node: WorkflowNode
): LoadImagePreview | null {
  if (!nodeTypes) return null;
  const widgetIndex = getWidgetIndexForInput(workflow, nodeTypes, node, 'image')
    ?? getWidgetIndexForInput(workflow, nodeTypes, node, 'filename')
    ?? getWidgetIndexForInput(workflow, nodeTypes, node, 'file');
  if (widgetIndex == null || !Array.isArray(node.widgets_values)) return null;
  const rawValue = node.widgets_values[widgetIndex];
  return parseInputImageValue(rawValue);
}

function parseInputImageValue(value: unknown): LoadImagePreview | null {
  if (typeof value === 'string' && value.trim()) {
    const { filename, subfolder } = splitSubfolder(value.trim());
    return { filename, subfolder, type: 'input' };
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const filename = typeof record.filename === 'string'
    ? record.filename
    : typeof record.name === 'string'
      ? record.name
      : null;
  if (!filename || !filename.trim()) return null;
  const subfolder = typeof record.subfolder === 'string' ? record.subfolder : '';
  const type = typeof record.type === 'string' ? record.type : 'input';
  const { filename: parsedName, subfolder: parsedSubfolder } = splitSubfolder(filename.trim());
  return {
    filename: parsedName,
    subfolder: subfolder || parsedSubfolder,
    type
  };
}

function splitSubfolder(path: string): { filename: string; subfolder: string } {
  const normalized = path.replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return { filename: normalized, subfolder: '' };
  }
  const filename = parts.pop() ?? normalized;
  return { filename, subfolder: parts.join('/') };
}
