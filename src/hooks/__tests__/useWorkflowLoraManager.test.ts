import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeTypes, Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import * as api from '@/api/client';
import { createEmptyMobileLayout } from '@/utils/mobileLayout';
import { useWorkflowStore } from '../useWorkflow';
import { useLoraManagerStore } from '../useLoraManager';

function makeNode(
  id: number,
  type: string,
  overrides?: Partial<WorkflowNode>
): WorkflowNode {
  return {
    id,
    stableKey: `sk-${id}`,
    type,
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  };
}

function makeWorkflow(nodes: WorkflowNode[], links: WorkflowLink[]): Workflow {
  return {
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: Math.max(0, ...links.map((l) => l[0])),
    nodes,
    links,
    groups: [],
    config: {},
    version: 1,
    widget_idx_map: Object.fromEntries(
      nodes.map((n) => [String(n.id), { text: 0, loras: 1 }])
    ),
  };
}

const nodeTypes: NodeTypes = {
  'Lora Loader (LoraManager)': {
    input: {
      required: {
        text: ['STRING'],
      },
      optional: {},
    },
    input_order: {
      required: ['text'],
      optional: [],
    },
    output: ['MODEL'],
    output_name: ['MODEL'],
    name: 'Lora Loader (LoraManager)',
    display_name: 'Lora Loader (LoraManager)',
    description: '',
    python_module: '',
    category: '',
  },
  'TriggerWord Toggle (LoraManager)': {
    input: {
      required: {
        group_mode: ['BOOLEAN'],
        default_active: ['BOOLEAN'],
        allow_strength_adjustment: ['BOOLEAN'],
      },
      optional: {},
    },
    input_order: {
      required: ['group_mode', 'default_active', 'allow_strength_adjustment'],
      optional: [],
    },
    output: ['STRING'],
    output_name: ['STRING'],
    name: 'TriggerWord Toggle (LoraManager)',
    display_name: 'TriggerWord Toggle (LoraManager)',
    description: '',
    python_module: '',
    category: '',
  },
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: ['COMBO', { choices: ['sd15.safetensors', 'sdxl.safetensors'] }],
      },
      optional: {},
    },
    input_order: {
      required: ['ckpt_name'],
      optional: [],
    },
    output: ['MODEL'],
    output_name: ['MODEL'],
    name: 'CheckpointLoaderSimple',
    display_name: 'CheckpointLoaderSimple',
    description: '',
    python_module: '',
    category: '',
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
  useLoraManagerStore.setState({ isLoraManagerAvailable: false });
  useWorkflowStore.setState({
    workflow: null,
    nodeTypes: null,
    hiddenItems: {},
    connectionHighlightModes: {},
    mobileLayout: createEmptyMobileLayout(),
    stableKeyByPointer: {},
    pointerByStableKey: {},
  });
});

describe('useWorkflow lora manager actions', () => {
  it('applyWidgetUpdate(text) updates text/list and syncs trigger words', () => {
    const requestTriggerWordsSpy = vi
      .spyOn(api, 'requestTriggerWords')
      .mockResolvedValue(undefined);

    const loader = makeNode(1, 'Lora Loader (LoraManager)', {
      widgets_values: ['portrait', [{ name: 'old.safetensors', strength: 1, active: true }]],
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }],
    });
    const trigger = makeNode(2, 'TriggerWord Toggle (LoraManager)', {
      inputs: [{ name: 'in', type: 'MODEL', link: 1 }],
      widgets_values: [true, true, false, [{ text: 'old', active: true }], 'old'],
    });

    useWorkflowStore.setState({
      workflow: makeWorkflow(
        [loader, trigger],
        [[1, 1, 0, 2, 0, 'MODEL']]
      ),
      nodeTypes,
    });

    useLoraManagerStore.getState().applyWidgetUpdate({
      node_id: 1,
      graph_id: 'root',
      widget_name: 'text',
      value: '<lora:new.safetensors:0.7>',
    });

    const nextLoader = useWorkflowStore.getState().workflow?.nodes.find((n) => n.id === 1);
    const nextLoaderValues = Array.isArray(nextLoader?.widgets_values)
      ? nextLoader.widgets_values
      : [];
    expect(nextLoaderValues[0]).toBe('<lora:new.safetensors:0.7>');
    expect(nextLoaderValues[1]).toEqual([
      { name: 'new.safetensors', strength: 0.7, clipStrength: 0.7, active: true },
    ]);

    expect(requestTriggerWordsSpy).toHaveBeenCalledWith(
      ['new.safetensors'],
      [{ node_id: 2, graph_id: 'root' }]
    );
  });

  it('applyWidgetUpdate(text) on subgraph node syncs using origin node id', () => {
    const requestTriggerWordsSpy = vi
      .spyOn(api, 'requestTriggerWords')
      .mockResolvedValue(undefined);

    const subgraphLoader = makeNode(101, 'Lora Loader (LoraManager)', {
      properties: {
        __mobile_origin: { scope: 'subgraph', subgraphId: 'sg-a', nodeId: 1 },
      },
      widgets_values: ['portrait', [{ name: 'old.safetensors', strength: 1, active: true }]],
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [7] }],
    });
    const subgraphTrigger = makeNode(102, 'TriggerWord Toggle (LoraManager)', {
      properties: {
        __mobile_origin: { scope: 'subgraph', subgraphId: 'sg-a', nodeId: 2 },
      },
      inputs: [{ name: 'in', type: 'MODEL', link: 7 }],
      widgets_values: [true, true, false, [{ text: 'old', active: true }], 'old'],
    });

    useWorkflowStore.setState({
      workflow: makeWorkflow(
        [subgraphLoader, subgraphTrigger],
        [[7, 101, 0, 102, 0, 'MODEL']]
      ),
      nodeTypes,
    });

    useLoraManagerStore.getState().applyWidgetUpdate({
      node_id: 1,
      graph_id: 'sg-a',
      widget_name: 'text',
      value: '<lora:new.safetensors:0.7>',
    });

    expect(requestTriggerWordsSpy).toHaveBeenCalledWith(
      ['new.safetensors'],
      [{ node_id: 2, graph_id: 'sg-a' }]
    );
  });

  it('applyTriggerWordUpdate rebuilds trigger list and writes message widget', () => {
    const trigger = makeNode(5, 'TriggerWord Toggle (LoraManager)', {
      widgets_values: [
        false,
        false,
        true,
        [{ text: 'hello', active: false, strength: 0.2 }],
        'hello',
      ],
    });

    useWorkflowStore.setState({
      workflow: {
        ...makeWorkflow([trigger], []),
        widget_idx_map: {
          '5': {
            group_mode: 0,
            default_active: 1,
            allow_strength_adjustment: 2,
            toggle_trigger_words: 3,
            originalMessage: 4,
          },
        },
      },
      nodeTypes,
    });

    useLoraManagerStore.getState().applyTriggerWordUpdate({
      node_id: 5,
      graph_id: 'root',
      message: 'hello,world',
    });

    const next = useWorkflowStore.getState().workflow?.nodes.find((n) => n.id === 5);
    const nextValues = Array.isArray(next?.widgets_values) ? next.widgets_values : [];
    expect(nextValues[3]).toEqual([
      { text: 'hello', active: false, strength: 0.2 },
      { text: 'world', active: false, strength: null },
    ]);
    expect(nextValues[4]).toBe('hello,world');
  });

  it('syncTriggerWordsForNode targets graph-aware node references', () => {
    const requestTriggerWordsSpy = vi
      .spyOn(api, 'requestTriggerWords')
      .mockResolvedValue(undefined);

    const rootLoader = makeNode(1, 'Lora Loader (LoraManager)', {
      widgets_values: ['root', [{ name: 'root.safetensors', strength: 1, active: true }]],
    });
    const subgraphLoader = makeNode(101, 'Lora Loader (LoraManager)', {
      properties: {
        __mobile_origin: { scope: 'subgraph', subgraphId: 'sg-a', nodeId: 1 },
      },
      widgets_values: ['sg', [{ name: 'sg.safetensors', strength: 1, active: true }]],
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [7] }],
    });
    const subgraphTrigger = makeNode(102, 'TriggerWord Toggle (LoraManager)', {
      properties: {
        __mobile_origin: { scope: 'subgraph', subgraphId: 'sg-a', nodeId: 2 },
      },
      inputs: [{ name: 'in', type: 'MODEL', link: 7 }],
      widgets_values: [true, true, false, [{ text: 'sg', active: true }], 'sg'],
    });

    useWorkflowStore.setState({
      workflow: makeWorkflow(
        [rootLoader, subgraphLoader, subgraphTrigger],
        [[7, 101, 0, 102, 0, 'MODEL']]
      ),
      nodeTypes,
    });

    useLoraManagerStore.getState().syncTriggerWordsForNode(1, 'sg-a');

    expect(requestTriggerWordsSpy).toHaveBeenCalledWith(
      ['sg.safetensors'],
      [{ node_id: 2, graph_id: 'sg-a' }]
    );
  });

  it('registerLoraManagerNodes sends lora and checkpoint-capable nodes', async () => {
    const registerSpy = vi
      .spyOn(api, 'registerLoraManagerNodes')
      .mockResolvedValue(undefined);

    const loraNode = makeNode(1, 'Lora Loader (LoraManager)', {
      properties: { title: 'My LoRA Node' },
      widgets_values: ['prompt', []],
    });
    const ckptNode = makeNode(2, 'CheckpointLoaderSimple', {
      widgets_values: ['sd15.safetensors'],
    });
    const subgraphLora = makeNode(3, 'Lora Loader (LoraManager)', {
      properties: {
        __mobile_origin: { scope: 'subgraph', subgraphId: 'sg-1', nodeId: 9 },
      },
      widgets_values: ['prompt', []],
    });

    useWorkflowStore.setState({
      workflow: makeWorkflow([loraNode, ckptNode, subgraphLora], []),
      nodeTypes,
    });

    await useLoraManagerStore.getState().registerLoraManagerNodes();

    expect(registerSpy).toHaveBeenCalledTimes(1);
    const payload = registerSpy.mock.calls[0][0];
    expect(payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_id: 1,
          graph_id: 'root',
          title: 'My LoRA Node',
          capabilities: expect.objectContaining({
            supports_lora: true,
            widget_names: expect.arrayContaining(['text', 'loras']),
          }),
        }),
        expect.objectContaining({
          node_id: 2,
          graph_id: 'root',
          capabilities: expect.objectContaining({
            supports_lora: false,
            widget_names: expect.arrayContaining(['ckpt_name']),
          }),
        }),
        expect.objectContaining({
          node_id: 9,
          graph_id: 'sg-1',
          capabilities: expect.objectContaining({
            supports_lora: true,
          }),
        }),
      ])
    );
  });
});
