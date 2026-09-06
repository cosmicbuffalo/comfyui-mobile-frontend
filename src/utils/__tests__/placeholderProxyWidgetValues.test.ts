/**
 * A placeholder's widget values are ordered by `properties.proxyWidgets`, not by
 * the subgraph's boundary sockets.
 *
 * ComfyUI's Z Image Turbo template is the case that exposed it: nine proxied
 * widgets over seven boundary inputs, because `seed` and
 * `control_after_generate` are proxied straight into the sampler and never
 * appear on the boundary at all. Indexed by boundary order, everything from the
 * fourth value on lands on the wrong widget — the card read `unet_name: 8`
 * (the steps value) and `/prompt` rejected the workflow with
 * "Value not in list: unet_name: 8".
 */
import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow } from '@/api/types';
import {
  getPlaceholderValueIndexForBoundarySlot,
  resolveSubgraphPlaceholderInputWidgetDefs,
} from '../widgetDefinitions';
import { normalizeSubgraphPlaceholders } from '../normalizeSubgraphPlaceholders';

const SUBGRAPH_ID = 'f2fdebf6-dfaf-43b6-9eb2-7f70613cfdc1';

/** The shape of the shipped template, trimmed to what the indexing depends on. */
function workflow(): Workflow {
  return {
    id: 'z-image',
    nodes: [
      {
        id: 57,
        type: SUBGRAPH_ID,
        pos: [0, 0],
        size: [300, 200],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [{ name: 'text', type: 'STRING', widget: { name: 'text' }, link: null }],
        outputs: [],
        properties: {
          proxyWidgets: [
            ['-1', 'text'], ['-1', 'width'], ['-1', 'height'], ['-1', 'steps'],
            ['3', 'seed'], ['3', 'control_after_generate'],
            ['-1', 'unet_name'], ['-1', 'clip_name'], ['-1', 'vae_name'],
          ],
        },
        widgets_values: [
          'a prompt', 1024, 1024, 8, null, null,
          'z_image_turbo_bf16.safetensors', 'qwen_3_4b.safetensors', 'ae.safetensors',
        ],
      },
    ],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
    definitions: {
      subgraphs: [{
        id: SUBGRAPH_ID,
        name: 'Text to Image',
        // Boundary order, which is NOT the widget order.
        inputs: [
          { id: 'a', name: 'text', type: 'STRING', linkIds: [1] },
          { id: 'b', name: 'width', type: 'INT', linkIds: [2] },
          { id: 'c', name: 'height', type: 'INT', linkIds: [3] },
          { id: 'd', name: 'unet_name', type: 'COMBO', linkIds: [4] },
          { id: 'e', name: 'clip_name', type: 'COMBO', linkIds: [5] },
          { id: 'f', name: 'vae_name', type: 'COMBO', linkIds: [6] },
          { id: 'g', name: 'steps', type: 'INT', linkIds: [7] },
        ],
        outputs: [],
        nodes: [
          { id: 28, type: 'UNETLoader', pos: [0, 0], size: [1, 1], flags: {}, order: 0, mode: 0,
            inputs: [{ name: 'unet_name', type: 'COMBO', widget: { name: 'unet_name' }, link: 4 }],
            outputs: [], properties: {}, widgets_values: ['placeholder.safetensors', 'default'] },
          { id: 30, type: 'CLIPLoader', pos: [0, 0], size: [1, 1], flags: {}, order: 1, mode: 0,
            inputs: [{ name: 'clip_name', type: 'COMBO', widget: { name: 'clip_name' }, link: 5 }],
            outputs: [], properties: {}, widgets_values: ['placeholder.safetensors', 'lumina2', 'default'] },
          { id: 29, type: 'VAELoader', pos: [0, 0], size: [1, 1], flags: {}, order: 2, mode: 0,
            inputs: [{ name: 'vae_name', type: 'COMBO', widget: { name: 'vae_name' }, link: 6 }],
            outputs: [], properties: {}, widgets_values: ['placeholder.safetensors'] },
          { id: 13, type: 'EmptySD3LatentImage', pos: [0, 0], size: [1, 1], flags: {}, order: 3, mode: 0,
            inputs: [
              { name: 'width', type: 'INT', widget: { name: 'width' }, link: 2 },
              { name: 'height', type: 'INT', widget: { name: 'height' }, link: 3 },
            ],
            outputs: [], properties: {}, widgets_values: [512, 512, 1] },
          { id: 27, type: 'CLIPTextEncode', pos: [0, 0], size: [1, 1], flags: {}, order: 4, mode: 0,
            inputs: [{ name: 'text', type: 'STRING', widget: { name: 'text' }, link: 1 }],
            outputs: [], properties: {}, widgets_values: [''] },
          { id: 3, type: 'KSampler', pos: [0, 0], size: [1, 1], flags: {}, order: 5, mode: 0,
            inputs: [{ name: 'steps', type: 'INT', widget: { name: 'steps' }, link: 7 }],
            outputs: [], properties: {}, widgets_values: [0, 'randomize', 20, 1, 'euler', 'simple', 1] },
        ],
        links: [],
        groups: [],
        widgets: [],
      }],
    },
  } as unknown as Workflow;
}

const NODE_TYPES = {
  UNETLoader: { input: { required: { unet_name: [['z_image_turbo_bf16.safetensors']], weight_dtype: [['default']] } }, output: ['MODEL'] },
  CLIPLoader: { input: { required: { clip_name: [['qwen_3_4b.safetensors']], type: [['lumina2']], device: [['default']] } }, output: ['CLIP'] },
  VAELoader: { input: { required: { vae_name: [['ae.safetensors']] } }, output: ['VAE'] },
  EmptySD3LatentImage: { input: { required: { width: ['INT'], height: ['INT'], batch_size: ['INT'] } }, output: ['LATENT'] },
  CLIPTextEncode: { input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } }, output: ['CONDITIONING'] },
  KSampler: { input: { required: { seed: ['INT'], steps: ['INT'], cfg: ['FLOAT'], sampler_name: [['euler']], scheduler: [['simple']], denoise: ['FLOAT'] } }, output: ['LATENT'] },
} as unknown as NodeTypes;

describe('a placeholder whose widgets_values follow proxyWidgets', () => {
  it('retires the proxy list and keeps every value on its own widget', () => {
    // This used to be the test for two orders diverging: `proxyWidgets` said one
    // thing, the boundary another, and the resolver had to prefer the proxy
    // list. Loading now migrates that list into real boundary inputs, so there
    // is a single order — and the property worth pinning is not which INDEX a
    // widget lands on but that each NAME still carries the value it had.
    const before = workflow();
    const beforePlaceholder = before.nodes.find((n) => n.type === SUBGRAPH_ID)!;
    const beforeByName = Object.fromEntries(
      ((beforePlaceholder.properties.proxyWidgets ?? []) as string[][])
        .map((entry, index) => [entry[1], (beforePlaceholder.widgets_values as unknown[])[index]]),
    );

    const wf = normalizeSubgraphPlaceholders(before);
    const sg = wf.definitions!.subgraphs![0];
    const placeholder = wf.nodes.find((n) => n.type === SUBGRAPH_ID)!;
    expect(placeholder.properties.proxyWidgets, 'the legacy list is gone').toBeUndefined();

    const values = placeholder.widgets_values as unknown[];
    const afterByName: Record<string, unknown> = {};
    (sg.inputs ?? []).forEach((slot, boundarySlot) => {
      const index = getPlaceholderValueIndexForBoundarySlot(placeholder, sg, boundarySlot);
      if (index !== null && slot.name) afterByName[slot.name] = values[index];
    });

    for (const [name, value] of Object.entries(beforeByName)) {
      if (value === undefined || value === null) continue;
      expect(afterByName[name], `${name} kept its value`).toBe(value);
    }
  });

  it('shows the model pickers the models, not the sampler settings', () => {
    const wf = normalizeSubgraphPlaceholders(workflow());
    const placeholder = wf.nodes.find((n) => n.type === SUBGRAPH_ID)!;
    const byName = new Map(
      resolveSubgraphPlaceholderInputWidgetDefs(placeholder, wf, NODE_TYPES)
        .map((widget) => [widget.name, widget.value]),
    );
    expect(byName.get('unet_name')).toBe('z_image_turbo_bf16.safetensors');
    expect(byName.get('clip_name')).toBe('qwen_3_4b.safetensors');
    expect(byName.get('vae_name')).toBe('ae.safetensors');
  });

  it('falls back to boundary order when there is no proxyWidgets list', () => {
    // The older serialization, which the boundary rebuild already handles.
    const wf = normalizeSubgraphPlaceholders(workflow());
    const sg = wf.definitions!.subgraphs![0];
    const placeholder = wf.nodes.find((n) => n.type === SUBGRAPH_ID)!;
    delete (placeholder.properties as Record<string, unknown>).proxyWidgets;
    const slot = sg.inputs!.findIndex((i) => i.name === 'unet_name');
    expect(getPlaceholderValueIndexForBoundarySlot(placeholder, sg, slot)).toBe(3);
  });
});
