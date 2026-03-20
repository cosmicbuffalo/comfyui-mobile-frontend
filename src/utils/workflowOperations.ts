import { getFileWorkflow, type AssetSource, type FileItem } from '@/api/client';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { getWidgetIndexForInput } from '@/hooks/useWorkflow';
import type { WorkflowSource } from '@/hooks/useWorkflow';
import { resolveWorkflowNodeDisplayName } from '@/utils/subgraphPlaceholderLabels';
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
  let source: WorkflowSource;
  let filename: string;
  if (promptId) {
    source = { type: 'history', promptId };
    filename = `history-${promptId}.json`;
  } else if (item.file) {
    const assetSource = resolveFileSource(item.file);
    const filePath = resolveFilePath(item.file, assetSource);
    source = { type: 'file', filePath, assetSource };
    filename = filePath;
  } else {
    source = { type: 'other' };
    filename = 'workflow.json';
  }
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
    loadWorkflow(workflowData, filePath, { source: { type: 'file', filePath, assetSource: effectiveSource } });
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

export function getNodeLabel(
  node: WorkflowNode,
  nodeTypes: NodeTypes | null,
  workflow?: Workflow | null
): string {
  return resolveWorkflowNodeDisplayName(workflow ?? null, node, nodeTypes);
}
