import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import {
  getWidgetDefinitions,
  PROXY_INDEX_OFFSET,
  resolveSubgraphPlaceholderInputWidgetDefs,
  resolveSubgraphProxyInputWidgetDefs,
  resolveSubgraphBoundaryWidgetDefs,
  resolveSubgraphBoundaryInputWidgetDefs,
} from '../widgetDefinitions';

function makeNode(id: number, type: string, widgetsValues: unknown[]): WorkflowNode {
  return {
    id,
    itemKey: `sk-${id}`,
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: widgetsValues,
  };
}

describe('widgetDefinitions lora manager support', () => {
  it('builds lora manager synthetic widgets with choices from LoraLoader', () => {
    const nodeTypes: NodeTypes = {
      LoraLoader: {
        input: {
          required: {
            lora_name: ['COMBO', { choices: ['a.safetensors', 'b.safetensors'] }],
          },
        },
        output: [],
        output_name: [],
        name: 'LoraLoader',
        display_name: 'LoraLoader',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(1, 'Lora Loader (LoraManager)', [
      'text',
      [{ name: 'a.safetensors', strength: 1, active: true }],
    ]);

    const defs = getWidgetDefinitions(nodeTypes, node);
    expect(defs.map((d) => d.type)).toContain('LM_LORA_HEADER');
    expect(defs.map((d) => d.type)).toContain('LM_LORA');
    expect(defs.map((d) => d.type)).toContain('LM_LORA_ADD');

    const loraDef = defs.find((d) => d.type === 'LM_LORA');
    expect(loraDef?.options).toMatchObject({ entryIndex: 0 });
  });

  it('uses LoRA Manager widget ids to skip metadata widgets', () => {
    const nodeTypes: NodeTypes = {
      'Lora Loader (LoraManager)': {
        input: {
          required: {
            text: ['AUTOCOMPLETE_TEXT_LORAS', {}],
          },
          optional: {},
        },
        input_order: {
          required: ['text'],
          optional: [],
        },
        output: [],
        output_name: [],
        name: 'Lora Loader (LoraManager)',
        display_name: 'Lora Loader (LoraManager)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(1, 'Lora Loader (LoraManager)', [
      { version: 1, textWidgetName: 'text' },
      '<lora:a:1.00>',
      [{ name: 'a', strength: 1, active: true }],
    ]);
    node.properties = {
      __lm_widget_ids: ['__lm_autocomplete_meta_text', 'text', 'loras'],
    };

    const defs = getWidgetDefinitions(nodeTypes, node);
    const textDef = defs.find((def) => def.name === 'text');
    expect(textDef).toMatchObject({
      value: '<lora:a:1.00>',
      widgetIndex: 1,
    });
    expect(defs.find((def) => def.type === 'LM_LORA')).toMatchObject({
      widgetIndex: 2,
    });
  });

  it('does not synthesize a phantom lora list for LoRA Text Loader nodes without a list widget', () => {
    const nodeTypes: NodeTypes = {
      'LoRA Text Loader (LoraManager)': {
        input: {
          required: {
            lora_syntax: ['STRING'],
          },
          optional: {},
        },
        input_order: {
          required: ['lora_syntax'],
          optional: [],
        },
        output: [],
        output_name: [],
        name: 'LoRA Text Loader (LoraManager)',
        display_name: 'LoRA Text Loader (LoraManager)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(11, 'LoRA Text Loader (LoraManager)', ['<lora:foo:0.8>']);
    const defs = getWidgetDefinitions(nodeTypes, node);

    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      name: 'lora_syntax',
      value: '<lora:foo:0.8>',
      widgetIndex: 0,
    });
    expect(defs.some((def) => def.type === 'LM_LORA')).toBe(false);
    expect(defs.some((def) => def.type === 'LM_LORA_ADD')).toBe(false);
  });

  it('builds trigger-word synthetic widgets and carries allowStrengthAdjustment', () => {
    const nodeTypes: NodeTypes = {
      'TriggerWord Toggle (LoraManager)': {
        input: {
          required: {
            allow_strength_adjustment: ['BOOLEAN', {}],
          },
          optional: {},
        },
        input_order: {
          required: ['allow_strength_adjustment'],
          optional: [],
        },
        output: [],
        output_name: [],
        name: 'TriggerWord Toggle (LoraManager)',
        display_name: 'TriggerWord Toggle (LoraManager)',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(2, 'TriggerWord Toggle (LoraManager)', [
      true,
      [{ text: 'foo', active: true, strength: 0.4 }],
      'foo',
    ]);

    const defs = getWidgetDefinitions(nodeTypes, node);
    const tw = defs.find((d) => d.type === 'TW_WORD');
    expect(tw?.options).toMatchObject({ entryIndex: 0, allowStrengthAdjustment: true });
  });

  it('builds standard widget definitions for regular nodes', () => {
    const nodeTypes: NodeTypes = {
      TestNode: {
        input: {
          required: {
            steps: ['INT', {}],
          },
          optional: {},
        },
        output: [],
        output_name: [],
        name: 'TestNode',
        display_name: 'TestNode',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const node = makeNode(3, 'TestNode', [20]);
    const defs = getWidgetDefinitions(nodeTypes, node);
    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({ name: 'steps', type: 'INT', value: 20 });
  });

  it('synthesizes proxied EasySeed control_after_generate from the inner seed control slot', () => {
    const innerSeed = makeNode(915, 'easy seed', [123, 'randomize', null]);
    innerSeed.title = 'EasySeed';
    innerSeed.outputs = [{ name: 'seed', type: 'INT', links: [] }];

    const placeholder = makeNode(911, 'subgraph-a', []);
    placeholder.properties = {
      proxyWidgets: [
        ['915', 'seed'],
        ['915', 'control_after_generate'],
      ],
    };

    const workflow: Workflow = {
      last_node_id: 915,
      last_link_id: 0,
      nodes: [placeholder],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          {
            id: 'subgraph-a',
            nodes: [innerSeed],
            links: [],
            groups: [],
            config: {},
          },
        ],
      },
    };

    const inputDefs = resolveSubgraphProxyInputWidgetDefs(
      placeholder,
      workflow,
      null,
    );

    expect(inputDefs).toHaveLength(1);
    expect(inputDefs[0]).toMatchObject({
      name: 'EasySeed: control_after_generate',
      type: 'COMBO',
      value: 'randomize',
      widgetIndex: PROXY_INDEX_OFFSET + 1,
      options: {
        options: ['fixed', 'randomize', 'increment', 'decrement'],
        __proxy: {
          subgraphId: 'subgraph-a',
          innerNodeId: 915,
          innerWidgetIndex: 1,
        },
      },
    });
  });

  it('resolves promoted subgraph placeholder combo values from linked source nodes', () => {
    const sourceNode = makeNode(100, 'PrimitiveNode', ['euler']);
    sourceNode.outputs = [{ name: 'sampler_name', type: 'COMBO', links: [55] }];

    const placeholder = makeNode(200, 'subgraph-a', []);
    placeholder.inputs = [
      {
        name: 'sampler_name',
        type: 'COMBO',
        link: 55,
        widget: { name: 'sampler_name' },
      },
    ];

    const innerNode = makeNode(300, 'SamplerNode', []);
    const workflow: Workflow = {
      last_node_id: 300,
      last_link_id: 55,
      nodes: [sourceNode, placeholder],
      links: [[55, sourceNode.id, 0, placeholder.id, 0, 'COMBO']],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          {
            id: 'subgraph-a',
            nodes: [innerNode],
            links: [],
            groups: [],
            config: {},
          },
        ],
      },
    };
    const nodeTypes: NodeTypes = {
      SamplerNode: {
        input: {
          required: {
            sampler_name: [['euler', 'dpmpp_2m'], {}],
          },
          optional: {},
        },
        output: [],
        output_name: [],
        name: 'SamplerNode',
        display_name: 'SamplerNode',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const inputDefs = resolveSubgraphPlaceholderInputWidgetDefs(
      placeholder,
      workflow,
      nodeTypes,
    );

    expect(inputDefs).toHaveLength(1);
    expect(inputDefs[0]).toMatchObject({
      name: 'sampler_name',
      type: 'COMBO',
      value: 'euler',
      widgetIndex: 0,
      options: {
        options: ['euler', 'dpmpp_2m'],
        __linkedSource: {
          subgraphId: null,
          nodeId: sourceNode.id,
          widgetIndex: 0,
          widgetName: 'sampler_name',
          itemKey: sourceNode.itemKey,
        },
      },
    });
  });

  it('carries the model picker kind on a renamed promoted model-loader widget', () => {
    const placeholder = makeNode(200, 'subgraph-ckpt', ['model.safetensors']);
    placeholder.inputs = [
      {
        name: 'ckpt_name',
        // Renamed promoted label — name-based detection would miss it.
        localized_name: 'Checkpoint',
        type: 'COMBO',
        link: null,
        widget: { name: 'ckpt_name' },
      },
    ];

    const innerNode = makeNode(300, 'CheckpointLoaderSimple', []);
    const workflow: Workflow = {
      last_node_id: 300,
      last_link_id: 0,
      nodes: [placeholder],
      links: [],
      groups: [],
      config: {},
      version: 1,
      definitions: {
        subgraphs: [
          {
            id: 'subgraph-ckpt',
            nodes: [innerNode],
            links: [],
            groups: [],
            config: {},
          },
        ],
      },
    };
    const nodeTypes: NodeTypes = {
      CheckpointLoaderSimple: {
        input: {
          required: { ckpt_name: [['model.safetensors', 'other.safetensors'], {}] },
          optional: {},
        },
        output: [],
        output_name: [],
        name: 'CheckpointLoaderSimple',
        display_name: 'Load Checkpoint',
        description: '',
        python_module: '',
        category: '',
      },
    };

    const inputDefs = resolveSubgraphPlaceholderInputWidgetDefs(
      placeholder,
      workflow,
      nodeTypes,
    );

    expect(inputDefs).toHaveLength(1);
    // Shown under its display label, but the picker kind is detected from the
    // inner ComfyUI input name (ckpt_name -> checkpoints).
    expect(inputDefs[0].name).toBe('Checkpoint');
    expect((inputDefs[0].options as Record<string, unknown>).__modelKind).toBe(
      'checkpoints',
    );
  });
});

// Issue #69, fix 3: a subgraph template author can promote a widget to the
// boundary (definitions.subgraphs[].inputs[]) without giving it a socket
// entry on the placeholder's own inputs[] at all -- e.g. the shipped MiniMax
// H3 template only puts width/height/duration/audio_vae in the placeholder's
// inputs[], while prompt/noise_seed/unet_name/clip_name/vae_name live only in
// widgets_values, positionally aligned with the subgraph's widget-typed
// boundary inputs. Neither the slot-promotion mechanism (inputs[].widget) nor
// the proxyWidgets mechanism sees these, so findSeedWidgetIndex previously
// returned null and the whole seed section silently vanished from the UI.
describe('resolveAllSubgraphBoundaryWidgetDefs (issue #69 fix 3)', () => {
  const workflow = {
    definitions: {
      subgraphs: [
        {
          id: 'sg-1',
          nodes: [
            {
              id: 1,
              type: 'InnerLoader',
              pos: [0, 0],
              size: [100, 100],
              flags: {},
              order: 0,
              mode: 0,
              inputs: [],
              outputs: [],
              properties: {},
              widgets_values: [0, 'a.safetensors'],
            } as unknown as WorkflowNode,
          ],
          links: [],
          inputs: [
            { name: 'prompt', type: 'STRING' },
            { name: 'width', type: 'INT' },
            { name: 'noise_seed', type: 'INT' },
            { name: 'unet_name', type: 'COMBO' },
          ],
        },
      ],
    },
  } as unknown as Workflow;

  const nodeTypes: NodeTypes = {
    InnerLoader: {
      input: {
        required: {
          noise_seed: ['INT', { min: 0, max: 999999999 }],
          unet_name: [['a.safetensors', 'b.safetensors'], {}],
        },
      },
      output: [],
      output_name: [],
      name: 'InnerLoader',
      display_name: 'InnerLoader',
      description: '',
      python_module: '',
      category: '',
    },
  };

  function makePlaceholder(): WorkflowNode {
    return {
      id: 105,
      type: 'sg-1',
      pos: [0, 0],
      size: [200, 100],
      flags: {},
      order: 0,
      mode: 0,
      // Only 'width' has a placeholder-level socket entry (mechanism 1) --
      // prompt / noise_seed / unet_name are boundary-only (mechanism 3).
      inputs: [
        { name: 'width', type: 'INT', widget: { name: 'width' }, link: null },
      ],
      outputs: [],
      properties: {},
      widgets_values: ['a prompt', 1024, 42, 'a.safetensors'],
    } as unknown as WorkflowNode;
  }

  it('resolves widgets exposed only through the subgraph boundary, not the placeholder inputs[]', () => {
    const placeholder = makePlaceholder();
    const nonCombo = resolveSubgraphBoundaryWidgetDefs(placeholder, workflow, nodeTypes);
    const combo = resolveSubgraphBoundaryInputWidgetDefs(placeholder, workflow, nodeTypes);

    // 'width' is already covered by mechanism 1 -> must not be duplicated here.
    expect(nonCombo.some((w) => w.name === 'width')).toBe(false);
    expect(combo.some((w) => w.name === 'width')).toBe(false);

    const prompt = nonCombo.find((w) => w.name === 'prompt');
    expect(prompt?.widgetIndex).toBe(0);
    expect(prompt?.value).toBe('a prompt');

    const seed = nonCombo.find((w) => w.name === 'noise_seed');
    expect(seed?.widgetIndex).toBe(2);
    expect(seed?.value).toBe(42);
    expect(seed?.options).toMatchObject({ min: 0, max: 999999999 });

    const unet = combo.find((w) => w.name === 'unet_name');
    expect(unet?.widgetIndex).toBe(3);
    expect(unet?.value).toBe('a.safetensors');
    expect((unet?.options as Record<string, unknown>).options).toEqual([
      'a.safetensors',
      'b.safetensors',
    ]);
  });

  it('returns nothing for a node that is not a subgraph placeholder', () => {
    const workflowWithoutMatch = { definitions: { subgraphs: [] } } as unknown as Workflow;
    const placeholder = makePlaceholder();
    expect(resolveSubgraphBoundaryWidgetDefs(placeholder, workflowWithoutMatch, nodeTypes)).toEqual([]);
    expect(resolveSubgraphBoundaryInputWidgetDefs(placeholder, workflowWithoutMatch, nodeTypes)).toEqual([]);
  });
});

// Two promoted widgets that share the same underlying inner widget name (e.g.
// two VAELoader nodes, one for image VAE and one for audio VAE, both of whose
// real ComfyUI widget is literally called "vae_name") get disambiguated by
// ComfyUI at the boundary: the second becomes "vae_name_1". The options/type
// lookup must resolve via the actual link to the specific inner node, not by
// matching the (possibly suffixed) boundary name against every inner node's
// schema -- otherwise the second widget's dropdown silently comes back empty,
// looking like the installed files are missing.
describe('subgraph boundary widgets with a disambiguated name (e.g. vae_name_1)', () => {
  const nodeTypes: NodeTypes = {
    VAELoader: {
      input: {
        required: {
          vae_name: [['image_vae.safetensors', 'audio_vae.safetensors'], {}],
        },
      },
      output: [],
      output_name: [],
      name: 'VAELoader',
      display_name: 'VAELoader',
      description: '',
      python_module: '',
      category: '',
    },
  };

  function makeVaeLoader(id: number, linkId: number): WorkflowNode {
    return {
      id,
      type: 'VAELoader',
      pos: [0, 0],
      size: [100, 100],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [
        { name: 'vae_name', type: 'COMBO', widget: { name: 'vae_name' }, link: linkId },
      ],
      outputs: [],
      properties: {},
      widgets_values: ['image_vae.safetensors'],
    } as unknown as WorkflowNode;
  }

  const workflow = {
    definitions: {
      subgraphs: [
        {
          id: 'sg-vae',
          nodes: [makeVaeLoader(1, 100), makeVaeLoader(2, 101)],
          links: [
            { id: 100, origin_id: -10, origin_slot: 0, target_id: 1, target_slot: 0, type: 'COMBO' },
            { id: 101, origin_id: -10, origin_slot: 1, target_id: 2, target_slot: 0, type: 'COMBO' },
          ],
          inputs: [
            { name: 'vae_name', type: 'COMBO', linkIds: [100] },
            { name: 'vae_name_1', type: 'COMBO', linkIds: [101], label: 'audio_vae' },
          ],
        },
      ],
    },
  } as unknown as Workflow;

  function makePlaceholder(): WorkflowNode {
    return {
      id: 105,
      type: 'sg-vae',
      pos: [0, 0],
      size: [200, 100],
      flags: {},
      order: 0,
      mode: 0,
      inputs: [
        { name: 'vae_name', type: 'COMBO', widget: { name: 'vae_name' }, link: null },
        { name: 'vae_name_1', type: 'COMBO', widget: { name: 'vae_name_1' }, link: null, label: 'audio_vae' },
      ],
      outputs: [],
      properties: {},
      widgets_values: ['image_vae.safetensors', 'audio_vae.safetensors'],
    } as unknown as WorkflowNode;
  }

  it('resolves options for the disambiguated widget via its link, not an empty list', () => {
    const placeholder = makePlaceholder();
    const inputDefs = resolveSubgraphPlaceholderInputWidgetDefs(placeholder, workflow, nodeTypes);

    const first = inputDefs.find((d) => d.widgetIndex === 0);
    const second = inputDefs.find((d) => d.widgetIndex === 1);

    expect((first!.options as Record<string, unknown>).options).toEqual([
      'image_vae.safetensors',
      'audio_vae.safetensors',
    ]);
    // This is the regression: before the fix, this came back as [].
    expect((second!.options as Record<string, unknown>).options).toEqual([
      'image_vae.safetensors',
      'audio_vae.safetensors',
    ]);
  });

  it('shows the label instead of the raw disambiguated name', () => {
    const placeholder = makePlaceholder();
    const inputDefs = resolveSubgraphPlaceholderInputWidgetDefs(placeholder, workflow, nodeTypes);
    const second = inputDefs.find((d) => d.widgetIndex === 1);
    expect(second!.name).toBe('audio_vae');
  });
});
