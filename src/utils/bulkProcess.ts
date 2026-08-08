import type { AssetSource } from '@/api/client';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { getWidgetIndexForInput } from '@/utils/seedUtils';

// A LoadImage node together with the scope it lives in (null = root, otherwise
// the owning subgraph definition id), so we can locate it again inside a clone.
export interface LoadImageTarget {
  node: WorkflowNode;
  subgraphId: string | null;
}

export function isLoadImageType(type: string): boolean {
  return /load[\s_-]*image/i.test(type);
}

export function targetKey(target: LoadImageTarget): string {
  return `${target.subgraphId ?? 'root'}:${target.node.id}`;
}

// FileItem.id is "${source}/${relativePath}"; split off the source prefix.
export function sourceFromId(id: string): AssetSource {
  if (id.startsWith('input/')) return 'input';
  if (id.startsWith('temp/')) return 'temp';
  return 'output';
}

/**
 * Clone `workflow` and set the chosen LoadImage node's image widget to
 * `imageValue`, leaving everything else (seeds included) untouched. Returns null
 * if the node or its image widget can't be resolved.
 */
export function cloneWithImage(
  workflow: Workflow,
  nodeTypes: NodeTypes,
  target: LoadImageTarget,
  imageValue: string,
): Workflow | null {
  const clone = structuredClone(workflow);
  const node =
    target.subgraphId == null
      ? clone.nodes.find((n) => n.id === target.node.id)
      : clone.definitions?.subgraphs
          ?.find((sg) => sg.id === target.subgraphId)
          ?.nodes.find((n) => n.id === target.node.id);
  if (!node) return null;

  const widgetIndex = getWidgetIndexForInput(clone, nodeTypes, node, 'image');
  if (widgetIndex == null) return null;

  const values = Array.isArray(node.widgets_values) ? [...node.widgets_values] : [];
  values[widgetIndex] = imageValue;
  node.widgets_values = values;
  return clone;
}
