import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { getWidgetDefinitions, getInputWidgetDefinitions } from '@/utils/widgetDefinitions';

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) + value.charCodeAt(i);
    hash &= 0xffffffff;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isStaticNode(nodeTypes: NodeTypes | null | undefined, node: WorkflowNode): boolean {
  if (!nodeTypes) return false;
  const widgetDefs = getWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
  const inputWidgetDefs = getInputWidgetDefinitions(nodeTypes, node).filter((widget) => !widget.connected);
  return widgetDefs.length === 0 && inputWidgetDefs.length === 0;
}

function collectAllNodes(workflow: Workflow): WorkflowNode[] {
  const rootNodes = workflow.nodes ?? [];
  const subgraphNodes = workflow.definitions?.subgraphs?.flatMap((subgraph) => subgraph.nodes ?? []) ?? [];
  return [...rootNodes, ...subgraphNodes];
}

export function buildWorkflowCacheKey(workflow: Workflow, nodeTypes?: NodeTypes | null): string {
  const nodes = collectAllNodes(workflow);
  const nonStaticTypes = nodes
    .filter((node) => !isStaticNode(nodeTypes, node))
    .map((node) => node.type)
    .sort();
  const signature = nonStaticTypes.join('|');
  return `wf_${hashString(signature)}`;
}
