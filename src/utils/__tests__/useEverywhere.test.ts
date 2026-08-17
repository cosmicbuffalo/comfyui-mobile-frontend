import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowLink, WorkflowNode } from '@/api/types';
import {
  canBroadcast,
  isUseEverywhereNode,
  listUeBroadcasts,
  listUeReceivers,
  resolveUseEverywhereForPrompt,
  resolveUseEverywhereLinks,
  ueSlotKey,
  workflowHasUseEverywhereNodes,
} from '@/utils/useEverywhere';

// --- builders -------------------------------------------------------------

let nextId = 1;

function node(partial: Partial<WorkflowNode> & { type: string }): WorkflowNode {
  return {
    id: partial.id ?? nextId++,
    type: partial.type,
    pos: partial.pos ?? [0, 0],
    size: partial.size ?? [100, 100],
    flags: {},
    order: 0,
    mode: partial.mode ?? 0,
    inputs: partial.inputs ?? [],
    outputs: partial.outputs ?? [],
    properties: partial.properties ?? {},
    ...(partial.title != null ? { title: partial.title } : {}),
    ...(partial.color != null ? { color: partial.color } : {}),
    ...(partial.widgets_values != null ? { widgets_values: partial.widgets_values } : {}),
  };
}

function workflow(nodes: WorkflowNode[], links: WorkflowLink[] = [], groups: Workflow['groups'] = []): Workflow {
  return { nodes, links, groups, last_node_id: 999, last_link_id: 999 } as Workflow;
}

/**
 * A source node feeding an Anything Everywhere controller, plus a consumer with
 * one unconnected input — the minimal shape of every UE broadcast.
 */
function broadcastFixture(options: {
  type?: string;
  consumerInputType?: string;
  controllerProps?: Record<string, unknown>;
  consumerMode?: number;
  controllerMode?: number;
} = {}) {
  nextId = 1;
  const type = options.type ?? 'MODEL';
  const source = node({ id: 1, type: 'CheckpointLoader', outputs: [{ name: 'MODEL', type, links: [10] }] });
  const controller = node({
    id: 2,
    type: 'Anything Everywhere',
    mode: options.controllerMode ?? 0,
    inputs: [{ name: 'anything', type: '*', link: 10 }],
    properties: options.controllerProps ?? {},
  });
  const consumer = node({
    id: 3,
    type: 'KSampler',
    mode: options.consumerMode ?? 0,
    inputs: [{ name: 'model', type: options.consumerInputType ?? type, link: null }],
  });
  const link: WorkflowLink = [10, 1, 0, 2, 0, type];
  return { source, controller, consumer, wf: workflow([source, controller, consumer], [link]) };
}

// --- classification -------------------------------------------------------

describe('node classification', () => {
  it('recognises every Anything Everywhere variant as a no-op broadcaster', () => {
    for (const type of [
      'Anything Everywhere',
      'Anything Everywhere3',
      'Anything Everywhere?',
      'Prompts Everywhere',
      'Seed Everywhere',
    ]) {
      expect(isUseEverywhereNode(node({ type })), type).toBe(true);
    }
    expect(isUseEverywhereNode(node({ type: 'KSampler' }))).toBe(false);
  });

  it('reads the class from "Node name for S&R" when the node was retitled', () => {
    const retitled = node({
      type: 'SomethingElse',
      properties: { 'Node name for S&R': 'Anything Everywhere' },
    });
    expect(isUseEverywhereNode(retitled)).toBe(true);
  });

  // UE rewrites `Seed Everywhere` into a real PrimitiveInt carrying ue_convert.
  // Such a node executes normally, so it must never be dropped from a prompt —
  // only its broadcasting role is extra.
  it('treats a ue_convert node as a broadcaster but not as a no-op UE node', () => {
    const converted = node({ type: 'PrimitiveInt', properties: { ue_convert: true } });
    expect(canBroadcast(converted)).toBe(true);
    expect(isUseEverywhereNode(converted)).toBe(false);
  });

  it('detects broadcasters inside subgraph definitions', () => {
    const wf = {
      ...workflow([node({ type: 'KSampler' })]),
      definitions: { subgraphs: [{ id: 'sg', nodes: [node({ type: 'Anything Everywhere' })] }] },
    } as unknown as Workflow;
    expect(workflowHasUseEverywhereNodes(wf)).toBe(true);
  });
});

// --- core resolution ------------------------------------------------------

describe('resolveUseEverywhereLinks', () => {
  it('routes a broadcast to a matching unconnected input, naming the real source', () => {
    const { wf } = broadcastFixture();
    const resolved = resolveUseEverywhereLinks(wf);
    expect(resolved.get(ueSlotKey(3, 0))).toEqual({
      originId: 1,
      originSlot: 0,
      type: 'MODEL',
      controllerId: 2,
      controllerSlot: 0,
    });
  });

  it('leaves an already-linked input alone', () => {
    const { wf } = broadcastFixture();
    wf.nodes[2].inputs[0].link = 99;
    expect(resolveUseEverywhereLinks(wf).size).toBe(0);
  });

  it('does not cross types', () => {
    const { wf } = broadcastFixture({ type: 'MODEL', consumerInputType: 'VAE' });
    expect(resolveUseEverywhereLinks(wf).size).toBe(0);
  });

  it('never feeds a node from itself', () => {
    nextId = 1;
    const self = node({
      id: 1,
      type: 'Reroute',
      inputs: [{ name: 'in', type: 'MODEL', link: null }],
      outputs: [{ name: 'out', type: 'MODEL', links: [10] }],
    });
    const controller = node({
      id: 2,
      type: 'Anything Everywhere',
      inputs: [{ name: 'anything', type: '*', link: 10 }],
    });
    const wf = workflow([self, controller], [[10, 1, 0, 2, 0, 'MODEL']]);
    expect(resolveUseEverywhereLinks(wf).get(ueSlotKey(1, 0))).toBeUndefined();
  });

  it('ignores a bypassed controller — a broadcaster must be live', () => {
    const { wf } = broadcastFixture({ controllerMode: 4 });
    expect(resolveUseEverywhereLinks(wf).size).toBe(0);
  });

  // The pack's "Connect to bypassed nodes" setting defaults to on, so a bypassed
  // consumer still reads as fed rather than as missing a required input.
  it('feeds bypassed consumers by default, and not when that is turned off', () => {
    const { wf } = broadcastFixture({ consumerMode: 4 });
    expect(resolveUseEverywhereLinks(wf).has(ueSlotKey(3, 0))).toBe(true);
    expect(
      resolveUseEverywhereLinks(wf, { treatBypassedAsLive: false }).has(ueSlotKey(3, 0)),
    ).toBe(false);
  });

  it('resolves past a bypassed node to the live source that supplies the data', () => {
    nextId = 1;
    const source = node({ id: 1, type: 'CheckpointLoader', outputs: [{ name: 'MODEL', type: 'MODEL', links: [10] }] });
    const bypassed = node({
      id: 2,
      type: 'LoraLoaderModelOnly',
      mode: 4,
      inputs: [{ name: 'model', type: 'MODEL', link: 10 }],
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [11] }],
    });
    const controller = node({ id: 3, type: 'Anything Everywhere', inputs: [{ name: 'anything', type: '*', link: 11 }] });
    const consumer = node({ id: 4, type: 'KSampler', inputs: [{ name: 'model', type: 'MODEL', link: null }] });
    const wf = workflow(
      [source, bypassed, controller, consumer],
      [
        [10, 1, 0, 2, 0, 'MODEL'],
        [11, 2, 0, 3, 0, 'MODEL'],
      ],
    );
    expect(resolveUseEverywhereLinks(wf).get(ueSlotKey(4, 0))?.originId).toBe(1);
  });

  it('publishes one broadcast per connected slot of an Anything Everywhere3', () => {
    nextId = 1;
    const ckpt = node({
      id: 1,
      type: 'CheckpointLoader',
      outputs: [
        { name: 'MODEL', type: 'MODEL', links: [10] },
        { name: 'CLIP', type: 'CLIP', links: [11] },
        { name: 'VAE', type: 'VAE', links: [12] },
      ],
    });
    const triplet = node({
      id: 2,
      type: 'Anything Everywhere3',
      inputs: [
        { name: 'anything', type: '*', link: 10 },
        { name: 'anything2', type: '*', link: 11 },
        { name: 'anything3', type: '*', link: 12 },
      ],
    });
    const consumer = node({
      id: 3,
      type: 'KSampler',
      inputs: [
        { name: 'model', type: 'MODEL', link: null },
        { name: 'clip', type: 'CLIP', link: null },
        { name: 'vae', type: 'VAE', link: null },
      ],
    });
    const wf = workflow(
      [ckpt, triplet, consumer],
      [
        [10, 1, 0, 2, 0, 'MODEL'],
        [11, 1, 1, 2, 1, 'CLIP'],
        [12, 1, 2, 2, 2, 'VAE'],
      ],
    );
    const resolved = resolveUseEverywhereLinks(wf);
    expect(resolved.get(ueSlotKey(3, 0))?.originSlot).toBe(0);
    expect(resolved.get(ueSlotKey(3, 1))?.originSlot).toBe(1);
    expect(resolved.get(ueSlotKey(3, 2))?.originSlot).toBe(2);
  });
});

// --- restrictions and precedence -----------------------------------------

describe('matching rules', () => {
  it('honours an input-name regex, and its inversion', () => {
    const { wf } = broadcastFixture({ controllerProps: { ue_properties: { input_regex: '^model$' } } });
    expect(resolveUseEverywhereLinks(wf).has(ueSlotKey(3, 0))).toBe(true);

    const { wf: inverted } = broadcastFixture({
      controllerProps: { ue_properties: { input_regex: '^model$', input_regex_invert: true } },
    });
    expect(resolveUseEverywhereLinks(inverted).has(ueSlotKey(3, 0))).toBe(false);
  });

  it('honours a node-title regex', () => {
    const { wf } = broadcastFixture({ controllerProps: { ue_properties: { title_regex: 'Refiner' } } });
    expect(resolveUseEverywhereLinks(wf).has(ueSlotKey(3, 0))).toBe(false);
    wf.nodes[2].title = 'Refiner pass';
    expect(resolveUseEverywhereLinks(wf).has(ueSlotKey(3, 0))).toBe(true);
  });

  it('reads pre-7.0 properties stored outside ue_properties', () => {
    // Files saved before pack v7.0 put these directly on `properties`.
    const { wf } = broadcastFixture({ controllerProps: { input_regex: '^nomatch$' } });
    expect(resolveUseEverywhereLinks(wf).has(ueSlotKey(3, 0))).toBe(false);
  });

  it('restricts to nodes of the controller colour', () => {
    const { wf } = broadcastFixture({ controllerProps: { color_restricted: 1 } });
    wf.nodes[1].color = '#123456';
    expect(resolveUseEverywhereLinks(wf).has(ueSlotKey(3, 0))).toBe(false);
    wf.nodes[2].color = '#123456';
    expect(resolveUseEverywhereLinks(wf).has(ueSlotKey(3, 0))).toBe(true);
  });

  it('requires widget-backed inputs to opt in, and lets plain inputs opt out', () => {
    const { wf } = broadcastFixture();
    wf.nodes[2].inputs[0].widget = { name: 'model' };
    expect(resolveUseEverywhereLinks(wf).has(ueSlotKey(3, 0))).toBe(false);

    wf.nodes[2].properties = { ue_properties: { widget_ue_connectable: { model: true } } };
    expect(resolveUseEverywhereLinks(wf).has(ueSlotKey(3, 0))).toBe(true);

    const { wf: optOut } = broadcastFixture();
    optOut.nodes[2].properties = { ue_properties: { input_ue_unconnectable: { model: true } } };
    expect(resolveUseEverywhereLinks(optOut).has(ueSlotKey(3, 0))).toBe(false);
  });

  it('respects a node that rejects UE entirely', () => {
    const { wf } = broadcastFixture();
    wf.nodes[2].properties = { rejects_ue_links: true };
    expect(resolveUseEverywhereLinks(wf).size).toBe(0);
  });

  it('lets the higher priority win, but leaves an exact tie unresolved', () => {
    nextId = 1;
    const a = node({ id: 1, type: 'LoaderA', outputs: [{ name: 'MODEL', type: 'MODEL', links: [10] }] });
    const b = node({ id: 2, type: 'LoaderB', outputs: [{ name: 'MODEL', type: 'MODEL', links: [11] }] });
    const ueA = node({ id: 3, type: 'Anything Everywhere', inputs: [{ name: 'anything', type: '*', link: 10 }] });
    const ueB = node({ id: 4, type: 'Anything Everywhere', inputs: [{ name: 'anything', type: '*', link: 11 }] });
    const consumer = node({ id: 5, type: 'KSampler', inputs: [{ name: 'model', type: 'MODEL', link: null }] });
    const links: WorkflowLink[] = [
      [10, 1, 0, 3, 0, 'MODEL'],
      [11, 2, 0, 4, 0, 'MODEL'],
    ];

    // Two default-priority broadcasts of the same type is ambiguous: UE refuses
    // to guess and leaves the input unconnected, rather than picking one.
    expect(resolveUseEverywhereLinks(workflow([a, b, ueA, ueB, consumer], links)).size).toBe(0);

    ueB.properties = { ue_properties: { priority: 50 } };
    const resolved = resolveUseEverywhereLinks(workflow([a, b, ueA, ueB, consumer], links));
    expect(resolved.get(ueSlotKey(5, 0))?.originId).toBe(2);
  });
});

// --- scope isolation ------------------------------------------------------

describe('resolveUseEverywhereForPrompt', () => {
  it('does not let a root broadcast reach inside an expanded subgraph', () => {
    nextId = 1;
    const source = node({ id: 1, type: 'CheckpointLoader', outputs: [{ name: 'MODEL', type: 'MODEL', links: [10] }] });
    const controller = node({ id: 2, type: 'Anything Everywhere', inputs: [{ name: 'anything', type: '*', link: 10 }] });
    const rootConsumer = node({ id: 3, type: 'KSampler', inputs: [{ name: 'model', type: 'MODEL', link: null }] });
    // An inner node of an expanded subgraph instance, identified by its prompt key.
    const innerConsumer = node({ id: 4, type: 'KSampler', inputs: [{ name: 'model', type: 'MODEL', link: null }] });
    const wf = workflow([source, controller, rootConsumer, innerConsumer], [[10, 1, 0, 2, 0, 'MODEL']]);
    const promptKeyMap = new Map<number, string>([[4, '7:12']]);

    const resolved = resolveUseEverywhereForPrompt(wf, promptKeyMap);
    expect(resolved.has(ueSlotKey(3, 0))).toBe(true);
    expect(resolved.has(ueSlotKey(4, 0))).toBe(false);
  });
});

// --- broadcast listing ----------------------------------------------------

describe('listUeReceivers', () => {
  it('lists every input a controller slot feeds', () => {
    nextId = 1;
    const source = node({ id: 1, type: 'CheckpointLoader', outputs: [{ name: 'VAE', type: 'VAE', links: [10] }] });
    const controller = node({ id: 2, type: 'Anything Everywhere', inputs: [{ name: 'anything', type: '*', link: 10 }] });
    const decodeA = node({
      id: 3,
      type: 'VAEDecode',
      inputs: [
        { name: 'samples', type: 'LATENT', link: null },
        { name: 'vae', type: 'VAE', link: null },
      ],
    });
    const decodeB = node({ id: 4, type: 'VAEDecode', inputs: [{ name: 'vae', type: 'VAE', link: null }] });
    const wf = workflow([source, controller, decodeA, decodeB], [[10, 1, 0, 2, 0, 'VAE']]);

    const receivers = listUeReceivers(resolveUseEverywhereLinks(wf), 2, 0);
    // Slot 1 on node 3, because `samples` is a LATENT and does not match.
    expect(receivers).toEqual([
      { nodeId: 3, slotIndex: 1 },
      { nodeId: 4, slotIndex: 0 },
    ]);
  });

  it('is empty for a slot nothing listens to', () => {
    const { wf } = broadcastFixture({ consumerInputType: 'VAE' });
    expect(listUeReceivers(resolveUseEverywhereLinks(wf), 2, 0)).toEqual([]);
  });

  it('keeps each controller slot separate', () => {
    nextId = 1;
    const ckpt = node({
      id: 1,
      type: 'CheckpointLoader',
      outputs: [
        { name: 'MODEL', type: 'MODEL', links: [10] },
        { name: 'CLIP', type: 'CLIP', links: [11] },
      ],
    });
    const controller = node({
      id: 2,
      type: 'Anything Everywhere3',
      inputs: [
        { name: 'anything', type: '*', link: 10 },
        { name: 'anything2', type: '*', link: 11 },
      ],
    });
    const consumer = node({
      id: 3,
      type: 'KSampler',
      inputs: [
        { name: 'model', type: 'MODEL', link: null },
        { name: 'clip', type: 'CLIP', link: null },
      ],
    });
    const wf = workflow(
      [ckpt, controller, consumer],
      [
        [10, 1, 0, 2, 0, 'MODEL'],
        [11, 1, 1, 2, 1, 'CLIP'],
      ],
    );
    const resolved = resolveUseEverywhereLinks(wf);
    expect(listUeReceivers(resolved, 2, 0)).toEqual([{ nodeId: 3, slotIndex: 0 }]);
    expect(listUeReceivers(resolved, 2, 1)).toEqual([{ nodeId: 3, slotIndex: 1 }]);
  });
});

describe('listUeBroadcasts', () => {
  it('reports each broadcast with its controller and real source', () => {
    const { wf } = broadcastFixture();
    expect(listUeBroadcasts(wf)).toEqual([
      { controllerId: 2, controllerSlot: 0, originId: 1, originSlot: 0, type: 'MODEL' },
    ]);
  });

  it('is empty for a workflow with no broadcasters', () => {
    expect(listUeBroadcasts(workflow([node({ type: 'KSampler' })]))).toEqual([]);
  });
});
