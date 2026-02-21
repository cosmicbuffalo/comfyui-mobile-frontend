import { getFileWorkflow, type AssetSource, type FileItem } from '@/api/client';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { getWidgetIndexForInput } from '@/hooks/useWorkflow';
import type { WorkflowSource } from '@/hooks/useWorkflow';
import type { ViewerImage } from '@/utils/viewerImages';

export type LoadWorkflowFn = (
  workflow: Workflow,
  filename?: string,
  options?: { fresh?: boolean; source?: WorkflowSource }
) => void;

export function resolveFileSource(file: FileItem): AssetSource {
  if (file.id.startsWith('input/')) return 'input';
  if (file.id.startsWith('temp/')) return 'temp';
  return 'output';
}

export function resolveFilePath(file: FileItem, source?: AssetSource): string {
  const effectiveSource = source ?? resolveFileSource(file);
  const prefix = `${effectiveSource}/`;
  return file.id.startsWith(prefix) ? file.id.slice(prefix.length) : file.id;
}

export function buildWorkflowFilename(filePath: string): string {
  return `output-${filePath.replace(/[\\/]/g, '_')}.json`;
}

export function resolveViewerItemWorkflowLoad(
  item: ViewerImage,
  historyWorkflowByFileId?: ReadonlyMap<string, { workflow: Workflow; promptId: string }>,
): { workflow: Workflow; filename: string; source: WorkflowSource } | null {
  const historyMatch =
    item.file && historyWorkflowByFileId
      ? historyWorkflowByFileId.get(item.file.id)
      : null;
  const workflowToLoad = item.workflow ?? historyMatch?.workflow;
  const promptId = item.promptId ?? historyMatch?.promptId;
  if (!workflowToLoad) return null;
  const source: WorkflowSource = promptId
    ? { type: 'history', promptId }
    : { type: 'other' };
  const filename = promptId
    ? `history-${promptId}.json`
    : (item.file
      ? buildWorkflowFilename(resolveFilePath(item.file, resolveFileSource(item.file)))
      : 'workflow.json');
  return { workflow: workflowToLoad, filename, source };
}

export async function loadWorkflowFromFile(params: {
  file: FileItem;
  source?: AssetSource;
  loadWorkflow: LoadWorkflowFn;
  onLoaded?: () => void;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { file, source, loadWorkflow, onLoaded, onError } = params;
  try {
    const effectiveSource = source ?? resolveFileSource(file);
    const filePath = resolveFilePath(file, effectiveSource);
    const workflowData = await getFileWorkflow(filePath, effectiveSource);
    loadWorkflow(workflowData, buildWorkflowFilename(filePath), { source: { type: 'other' } });
    onLoaded?.();
  } catch (err) {
    onError?.(err);
    throw err;
  }
}

export function resolveInputWidget(params: {
  workflow: Workflow | null;
  nodeTypes: NodeTypes | null;
  nodeId: number;
}): { node: WorkflowNode; index: number; name: string } | null {
  const { workflow, nodeTypes, nodeId } = params;
  if (!workflow || !nodeTypes) return null;
  const node = workflow.nodes.find((entry) => entry.id === nodeId);
  if (!node) return null;
  const inputNames = ['image', 'filename', 'file'];
  for (const name of inputNames) {
    const index = getWidgetIndexForInput(workflow, nodeTypes, node, name);
    if (index !== null) {
      return { node, index, name };
    }
  }
  return null;
}

export function getNodeLabel(node: WorkflowNode, nodeTypes: NodeTypes | null): string {
  const directTitle = (node as { title?: unknown }).title;
  const nodeTitle =
    typeof directTitle === 'string' && directTitle.trim()
      ? directTitle.trim()
      : null;
  const typeDef = nodeTypes?.[node.type];
  return nodeTitle || typeDef?.display_name || node.type;
}
