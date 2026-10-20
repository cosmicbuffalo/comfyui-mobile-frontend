import { useEffect, useRef } from 'react';
import type { WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { boxInputs, readBoxes } from '@/utils/boundingBoxes';
import { getLinkId, getLinkOriginId, resolveScopeForHierarchicalKey } from '@/utils/canonicalWorkflowOps';
import { getImagePreviewUrl } from '@/api/client';
import { splitPathAnnotation } from '@/utils/annotatedPath';
import BoundingBoxEditor from './BoundingBoxEditor';

export default function BoundingBoxControls({ node, onChange, disabled }: { node: WorkflowNode; onChange: (updates: Record<number, unknown>) => void; disabled: boolean }) {
  const types = useWorkflowStore(s => s.nodeTypes);
  const workflow = useWorkflowStore(s => s.workflow);
  const outputs = useWorkflowStore(s => s.nodeOutputs);
  const reported = useWorkflowStore(s => s.nodeBoundingBoxOutputs[String(node.id)]);
  const definitions = boxInputs(node, types);
  const dimensions = reported?.dims;
  const widthInput = definitions.find(d => d.name === 'width');
  const heightInput = definitions.find(d => d.name === 'height');
  const width = Number((widthInput?.connected ? dimensions?.[0] : undefined) ?? widthInput?.value ?? 1024);
  const height = Number((heightInput?.connected ? dimensions?.[1] : undefined) ?? heightInput?.value ?? 1024);
  const state = definitions.find(d => d.name === 'editor_state');
  const previous = useRef({ width, height });
  useEffect(() => {
    const old = previous.current; previous.current = { width, height };
    if (disabled || state?.connected || state?.widgetIndex == null || !old.width || !old.height || old.width === width && old.height === height) return;
    // Executed dimensions describe the incoming pixel data already. Only
    // direct widget edits rescale saved boxes.
    const scaleX = widthInput?.connected ? 1 : width / old.width;
    const scaleY = heightInput?.connected ? 1 : height / old.height;
    if (scaleX === 1 && scaleY === 1) return;
    const boxes = readBoxes(state.value);
    if (boxes.length) onChange({ [state.widgetIndex]: boxes.map(box => ({ ...box, x: Math.round(box.x * scaleX), width: Math.round(box.width * scaleX), y: Math.round(box.y * scaleY), height: Math.round(box.height * scaleY) })) });
  }, [width, height, widthInput?.connected, heightInput?.connected, state, disabled, onChange]);
  let background: string | undefined;
  if (workflow && node.itemKey) {
    const scope = resolveScopeForHierarchicalKey(workflow, node.itemKey);
    const link = scope.links.find(link => getLinkId(link) === node.inputs.find(input => input.name === 'background')?.link);
    // A background wired in through the subgraph's inputs has no source in
    // this scope; the image the node reported on its last run still applies.
    const source = link && scope.nodes.find(n => n.id === getLinkOriginId(link));
    const ran = reported?.background;
    if (link && !source && ran) {
      background = getImagePreviewUrl(ran.filename, ran.subfolder, ran.type, ran.cacheToken);
    }
    if (source) {
      const image = outputs[String(source.id)]?.[0] ?? ran;
      if (source.type === 'LoadImage') {
        const path = boxInputs(source, types).find(d => d.name === 'image')?.value;
        if (typeof path === 'string' && path) {
          const parsed = splitPathAnnotation(path); const slash = parsed.path.lastIndexOf('/');
          background = getImagePreviewUrl(parsed.path.slice(slash + 1), slash < 0 ? '' : parsed.path.slice(0, slash), parsed.type ?? 'input');
        }
      } else if (image?.filename) background = getImagePreviewUrl(image.filename, image.subfolder, image.type, image.cacheToken);
    }
  }
  if (state?.widgetIndex == null) return null;
  return <BoundingBoxEditor value={state.value} width={width} height={height} background={background} disabled={disabled || state.connected} onChange={boxes => onChange({ [state.widgetIndex!]: boxes })} />;
}
