import type { NodeTypes, Workflow, WorkflowNode, WorkflowLink } from '@/api/types';
import { buildDefaultConnectionInputs, buildDefaultWidgetValues, getActiveNodeInputDefinitions } from './workflowInputs';

/** Small editable SD starter for cores that predate /default_workflow. */
export function buildStarterWorkflow(types: NodeTypes): Workflow {
  const names = ['CheckpointLoaderSimple', 'CLIPTextEncode', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'];
  const nodes = names.map((type, index): WorkflowNode => {
    const def = types[type];
    if (!def) throw new Error(`Starter workflow requires ${type}.`);
    const node: WorkflowNode = { id: index + 1, type, pos: [Math.floor(index / 2) * 400, index % 2 * 400], size: [320, 300], flags: {}, order: index, mode: 0, properties: {},
      widgets_values: buildDefaultWidgetValues(def), inputs: buildDefaultConnectionInputs(def).map(input => ({ ...input, link: null })),
      outputs: def.output.map((type, i) => ({ name: def.output_name?.[i] ?? type, type, links: [] })),
    };
    const values = node.widgets_values as unknown[];
    for (const input of getActiveNodeInputDefinitions(def, node)) {
      if (input.widgetIndex == null) continue;
      if (type === 'CLIPTextEncode' && input.name === 'text') values[input.widgetIndex] = index === 1 ? 'a beautiful landscape' : '';
      if (type === 'EmptyLatentImage' && ['width', 'height'].includes(input.name)) values[input.widgetIndex] = 512;
      if (input.name === 'seed') { values[input.widgetIndex] = 0; if (typeof values[input.widgetIndex + 1] === 'string') values[input.widgetIndex + 1] = 'fixed'; }
    }
    return node;
  });
  const links: WorkflowLink[] = [];
  for (const [source, slot, target, name] of [[1,0,5,'model'], [1,1,2,'clip'], [1,1,3,'clip'], [1,2,6,'vae'], [2,0,5,'positive'], [3,0,5,'negative'], [4,0,5,'latent_image'], [5,0,6,'samples'], [6,0,7,'images']] as const) {
    const src = nodes[source - 1], dst = nodes[target - 1], targetSlot = dst.inputs.findIndex(input => input.name === name);
    if (targetSlot < 0) throw new Error(`Starter workflow requires ${dst.type}.${name}.`);
    const id = links.length + 1;
    links.push([id, source, slot, target, targetSlot, src.outputs[slot].type]);
    dst.inputs[targetSlot].link = id; src.outputs[slot].links!.push(id);
  }
  return { nodes, links, last_node_id: nodes.length, last_link_id: links.length, groups: [], config: {}, extra: {}, version: 0.4 };
}
