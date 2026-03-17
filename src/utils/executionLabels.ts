import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { findRootWorkflowNodeById, findWorkflowNodeInScope } from '@/utils/subgraphPlaceholderLabels';

function toDisplayName(
  workflow: Workflow,
  node: Pick<WorkflowNode, 'type' | 'title'>,
  fallback: string,
  nodeTypes: NodeTypes | null,
): string {
  const nodeTitle =
    typeof node.title === 'string' ? node.title.trim() : '';
  if (nodeTitle) return nodeTitle;
  const subgraphName = workflow.definitions?.subgraphs?.find(
    (sg) => sg.id === node.type,
  )?.name;
  if (typeof subgraphName === 'string' && subgraphName.trim()) {
    return subgraphName.trim();
  }
  const typeDef = nodeTypes?.[node.type];
  return typeDef?.display_name || node.type || fallback;
}

export function resolveExecutingNodeLabel(
  executingNodePath: string | null,
  executingNodeId: string | null,
  workflow: Workflow | null,
  nodeTypes: NodeTypes | null,
): string | null {
  if (!workflow) return null;

  if (executingNodePath) {
    const parts = executingNodePath
      .split(':')
      .map((part) => Number(part))
      .filter((value) => Number.isFinite(value));
    if (parts.length > 0) {
      if (parts.length === 1) {
        const rootNode = findRootWorkflowNodeById(workflow, parts[0]);
        if (rootNode) return toDisplayName(workflow, rootNode, `Node ${parts[0]}`, nodeTypes);
      } else {
        let subgraphId: string | null = null;
        const rootPlaceholder = findRootWorkflowNodeById(workflow, parts[0]);
        if (rootPlaceholder) subgraphId = rootPlaceholder.type;

        for (let i = 1; i < parts.length; i += 1) {
          if (!subgraphId) break;
          const nodeId = parts[i];
          const node = findWorkflowNodeInScope(workflow, nodeId, subgraphId);
          if (!node) break;
          if (i === parts.length - 1) {
            return toDisplayName(workflow, node, `Node ${nodeId}`, nodeTypes);
          }
          subgraphId = node.type;
        }
      }
      const leaf = parts[parts.length - 1];
      return Number.isFinite(leaf) ? `Node ${leaf}` : `Node ${executingNodePath}`;
    }
    return `Node ${executingNodePath}`;
  }

  if (!executingNodeId) return null;
  const node = workflow.nodes.find((entry) => String(entry.id) === executingNodeId);
  if (!node) return `Node ${executingNodeId}`;
  return toDisplayName(workflow, node, `Node ${executingNodeId}`, nodeTypes);
}
