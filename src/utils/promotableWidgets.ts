import type { WorkflowNode } from '@/api/types';

export interface PromotableWidget {
  widgetIndex: number;
  name: string;
  inputName: string;
  type: string;
  value: unknown;
}

export interface WidgetPromotionDescriptor {
  widgetIndex: number;
  name: string;
  inputName?: string;
  type: string;
  value: unknown;
  connected: boolean;
  inputIndex: number;
}

/** Widgets on one node that can become inputs of the enclosing subgraph. */
export function collectPromotableWidgets({
  node,
  descriptors,
  isPlaceholder,
  inSubgraphScope,
}: {
  node: WorkflowNode;
  descriptors: WidgetPromotionDescriptor[];
  isPlaceholder: boolean;
  inSubgraphScope: boolean;
}): PromotableWidget[] {
  if (!inSubgraphScope) return [];

  const results: PromotableWidget[] = [];
  const seen = new Set<string>();
  for (const widget of descriptors) {
    if (widget.connected) continue;
    const baseName = widget.name.split(': ').pop() ?? widget.name;
    if (baseName === 'video_oasis_ui' || baseName === 'ltx23_oasis_ui') continue;

    const indexedInput = widget.inputIndex >= 0 ? node.inputs[widget.inputIndex] : null;
    const namedInput = widget.inputName
      ? node.inputs.find((input) =>
          input.name === widget.inputName || input.widget?.name === widget.inputName,
        )
      : null;
    const input = indexedInput ?? namedInput;
    if (input?.link != null) continue;

    let inputName: string | null = null;
    if (isPlaceholder) {
      // A direct proxy widget has no placeholder input for the enclosing
      // boundary to feed. Boundary-backed placeholder widgets do.
      if (!input?.widget) continue;
      inputName = input.name;
    } else {
      // Standard schema widgets carry inputName even before their input slot is
      // serialized. Frontend-only synthetic controls intentionally do not.
      inputName = widget.inputName ?? input?.widget?.name ?? null;
    }
    if (!inputName || seen.has(inputName)) continue;
    seen.add(inputName);
    results.push({
      widgetIndex: widget.widgetIndex,
      name: widget.name,
      inputName,
      type: String(input?.type ?? widget.type ?? '*'),
      value: widget.value,
    });
  }
  return results;
}
