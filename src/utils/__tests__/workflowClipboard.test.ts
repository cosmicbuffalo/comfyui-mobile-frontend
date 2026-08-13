import { describe, expect, it } from 'vitest';
import type {
  Workflow,
  WorkflowGroup,
  WorkflowNode,
  WorkflowSubgraphDefinition,
} from '@/api/types';
import {
  applyClipboardPaste,
  buildGroupClipboardPayload,
  buildNodeClipboardPayload,
  placePastedNodesIntoGroup,
} from '@/utils/workflowClipboard';

function node(partial: Partial<WorkflowNode> & { id: number; type: string }): WorkflowNode {
  return {
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    ...partial,
  };
}

function baseWorkflow(partial: Partial<Workflow>): Workflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 0.4,
    ...partial,
  };
}

describe('buildNodeClipboardPayload', () => {
  const workflow = baseWorkflow({
    last_node_id: 5,
    last_link_id: 10,
    nodes: [
      node({
        id: 5,
        type: 'KSampler',
        itemKey: 'root/node:5',
        widgets_values: ['hello', 5],
        inputs: [{ name: 'model', type: 'MODEL', link: 10 }],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: [11], slot_index: 0 }],
      }),
    ],
  });

  it('copies a single node with no internal links and no subgraphs', () => {
    const payload = buildNodeClipboardPayload(workflow, 'root/node:5');
    expect(payload).not.toBeNull();
    expect(payload!.summary).toBe('1 个节点');
    expect(payload!.nodes).toHaveLength(1);
    expect(payload!.nodes[0].id).toBe(5);
    expect(payload!.nodes[0].widgets_values).toEqual(['hello', 5]);
    // Deep clone — not the same reference as the source.
    expect(payload!.nodes[0]).not.toBe(workflow.nodes[0]);
    expect(payload!.links).toEqual([]);
    expect(payload!.subgraphs).toEqual([]);
    expect(payload!.group).toBeNull();
  });

  it('carries the subgraph definition when copying a placeholder', () => {
    const sgDef: WorkflowSubgraphDefinition = {
      id: 'SG',
      nodes: [node({ id: 100, type: 'Inner' })],
      links: [],
      groups: [],
    } as WorkflowSubgraphDefinition;
    const wf = baseWorkflow({
      last_node_id: 7,
      nodes: [node({ id: 7, type: 'SG', itemKey: 'root/node:7' })],
      definitions: { subgraphs: [sgDef] },
    });
    const payload = buildNodeClipboardPayload(wf, 'root/node:7');
    expect(payload).not.toBeNull();
    expect(payload!.summary).toBe('子图');
    expect(payload!.subgraphs).toHaveLength(1);
    expect(payload!.subgraphs[0].id).toBe('SG');
  });
});

describe('buildGroupClipboardPayload + applyClipboardPaste', () => {
  // Two nodes wired together inside a group, plus an outside node the group
  // connects to (boundary link must be dropped on paste).
  const group: WorkflowGroup = {
    id: 1,
    title: 'My Group',
    bounding: [0, 0, 400, 300],
    itemKey: 'root/group:1',
  } as WorkflowGroup;
  const workflow = baseWorkflow({
    last_node_id: 3,
    last_link_id: 30,
    groups: [group],
    nodes: [
      node({
        id: 1,
        type: 'A',
        itemKey: 'root/node:1',
        pos: [20, 60],
        outputs: [{ name: 'o', type: 'IMAGE', links: [20], slot_index: 0 }],
      }),
      node({
        id: 2,
        type: 'B',
        itemKey: 'root/node:2',
        pos: [20, 180],
        inputs: [{ name: 'i', type: 'IMAGE', link: 20 }],
        outputs: [{ name: 'o', type: 'IMAGE', links: [30], slot_index: 0 }],
      }),
      node({
        id: 3,
        type: 'Outside',
        itemKey: 'root/node:3',
        pos: [600, 60],
        inputs: [{ name: 'i', type: 'IMAGE', link: 30 }],
      }),
    ],
    links: [
      [20, 1, 0, 2, 0, 'IMAGE'],
      [30, 2, 0, 3, 0, 'IMAGE'],
    ],
  });

  it('collects only internal links among group members', () => {
    const payload = buildGroupClipboardPayload(workflow, group, null, [1, 2]);
    expect(payload).not.toBeNull();
    expect(payload!.summary).toBe('分组（2 个节点）');
    expect(payload!.nodes.map((n) => n.id).sort()).toEqual([1, 2]);
    // Only the 1→2 link is internal; the 2→3 boundary link is dropped.
    expect(payload!.links).toHaveLength(1);
    expect(payload!.links[0]).toMatchObject({ originId: 1, targetId: 2 });
    expect(payload!.group?.id).toBe(1);
  });

  it('pastes re-id-ed nodes with internal links rewired and outputs disconnected', () => {
    const payload = buildGroupClipboardPayload(workflow, group, null, [1, 2])!;
    const result = applyClipboardPaste(workflow, payload, null);
    expect(result).not.toBeNull();
    const { workflow: next, newNodeIds, newGroupId } = result!;

    // Brand-new ids, distinct from the originals.
    expect(newNodeIds).toHaveLength(2);
    expect(newNodeIds.every((id) => id > 3)).toBe(true);
    expect(newGroupId).not.toBeNull();

    const [aId, bId] = newNodeIds;
    const a = next.nodes.find((n) => n.id === aId)!;
    const b = next.nodes.find((n) => n.id === bId)!;

    // The internal link is rewired between the new ids with a fresh link id.
    const newLinkId = b.inputs[0].link;
    expect(newLinkId).not.toBeNull();
    expect(newLinkId).toBeGreaterThan(30);
    expect(a.outputs[0].links).toContain(newLinkId);
    const link = next.links.find((l) => l[0] === newLinkId)!;
    expect(link[1]).toBe(aId);
    expect(link[3]).toBe(bId);

    // B's outgoing boundary connection (to the un-copied node 3) is gone.
    expect(b.outputs[0].links).toBeNull();

    // last_node_id advanced past the new ids; original nodes untouched.
    expect(next.last_node_id).toBeGreaterThanOrEqual(Math.max(...newNodeIds));
    expect(next.nodes.find((n) => n.id === 1)!.outputs[0].links).toEqual([20]);
  });

  it('drops the pasted group below all existing nodes and groups (no overlap)', () => {
    const payload = buildGroupClipboardPayload(workflow, group, null, [1, 2])!;
    const result = applyClipboardPaste(workflow, payload, null)!;
    const { workflow: next, newNodeIds, newGroupId } = result;

    const newGroup = next.groups!.find((g) => g.id === newGroupId)!;
    const newTop = newGroup.bounding[1];

    // The new group's top sits below every pre-existing node bottom...
    const existingNodeBottoms = [1, 2, 3].map((id) => {
      const n = workflow.nodes.find((node) => node.id === id)!;
      return n.pos[1] + (n.size![1] ?? 100);
    });
    expect(newTop).toBeGreaterThanOrEqual(Math.max(...existingNodeBottoms));
    // ...and below the existing group's bottom.
    expect(newTop).toBeGreaterThanOrEqual(group.bounding[1] + group.bounding[3]);

    // No pre-existing node falls inside the new group's bounds.
    const [gx, gy, gw, gh] = newGroup.bounding;
    for (const id of [1, 2, 3]) {
      const n = workflow.nodes.find((node) => node.id === id)!;
      const inside =
        n.pos[0] >= gx && n.pos[0] <= gx + gw && n.pos[1] >= gy && n.pos[1] <= gy + gh;
      expect(inside).toBe(false);
    }

    // The pasted member nodes DO land inside the new group's bounds.
    for (const id of newNodeIds) {
      const n = next.nodes.find((node) => node.id === id)!;
      expect(n.pos[0]).toBeGreaterThanOrEqual(gx);
      expect(n.pos[1]).toBeGreaterThanOrEqual(gy);
      expect(n.pos[0]).toBeLessThanOrEqual(gx + gw);
      expect(n.pos[1]).toBeLessThanOrEqual(gy + gh);
    }
  });
});

describe('placePastedNodesIntoGroup', () => {
  const group: WorkflowGroup = {
    id: 1,
    title: 'G',
    bounding: [0, 0, 400, 200],
    itemKey: 'root/group:1',
  } as WorkflowGroup;
  const workflow = baseWorkflow({
    last_node_id: 9,
    groups: [group],
    nodes: [
      node({ id: 9, type: 'New', itemKey: 'root/node:9', pos: [800, 800], size: [200, 100] }),
    ],
  });

  it('moves the node inside the group and grows the group to fit', () => {
    const next = placePastedNodesIntoGroup(workflow, 1, null, [9]);
    const moved = next.nodes.find((n) => n.id === 9)!;
    const g = next.groups![0];
    const [gx, gy, gw, gh] = g.bounding;
    // Node now sits within the (expanded) group bounds.
    expect(moved.pos[0]).toBeGreaterThanOrEqual(gx);
    expect(moved.pos[1]).toBeGreaterThanOrEqual(gy);
    expect(moved.pos[0] + moved.size![0]).toBeLessThanOrEqual(gx + gw);
    expect(moved.pos[1] + moved.size![1]).toBeLessThanOrEqual(gy + gh);
  });
});

describe('applyClipboardPaste with nested subgraphs', () => {
  // Definition B nested inside definition A; root has a placeholder for A.
  const defB: WorkflowSubgraphDefinition = {
    id: 'BBBBBBBB-0000-4000-8000-000000000000',
    nodes: [node({ id: 200, type: 'InnerB' })],
    links: [],
    groups: [],
  } as WorkflowSubgraphDefinition;
  const defA: WorkflowSubgraphDefinition = {
    id: 'AAAAAAAA-0000-4000-8000-000000000000',
    nodes: [
      node({ id: 100, type: 'InnerA' }),
      node({ id: 101, type: defB.id }), // nested placeholder for B
    ],
    links: [],
    groups: [],
  } as WorkflowSubgraphDefinition;
  const source = baseWorkflow({
    last_node_id: 7,
    nodes: [node({ id: 7, type: defA.id, itemKey: 'root/node:7' })],
    definitions: { subgraphs: [defA, defB] },
  });

  it('carries nested definitions transitively when copying the outer placeholder', () => {
    const payload = buildNodeClipboardPayload(source, 'root/node:7');
    expect(payload!.subgraphs.map((sg) => sg.id).sort()).toEqual(
      [defA.id, defB.id].sort(),
    );
  });

  it('remaps the inner placeholder to the cloned nested definition on cross-workflow paste', () => {
    const payload = buildNodeClipboardPayload(source, 'root/node:7')!;
    // Paste into a DIFFERENT workflow where neither definition id exists.
    const target = baseWorkflow({ last_node_id: 1, nodes: [node({ id: 1, type: 'KSampler' })] });
    const result = applyClipboardPaste(target, payload, null)!;
    const next = result.workflow;

    const defs = next.definitions?.subgraphs ?? [];
    expect(defs).toHaveLength(2);
    const defIds = new Set(defs.map((d) => d.id));
    // Fresh ids — nothing points back into the source workflow's id space.
    expect(defIds.has(defA.id)).toBe(false);
    expect(defIds.has(defB.id)).toBe(false);

    // The pasted root placeholder points at the cloned outer definition.
    const pasted = next.nodes.find((n) => n.id === result.newNodeIds[0])!;
    expect(defIds.has(pasted.type)).toBe(true);

    // The cloned outer definition's inner placeholder points at the cloned
    // nested definition — not at the source workflow's B id.
    const clonedA = defs.find((d) => d.id === pasted.type)!;
    const innerPlaceholder = clonedA.nodes!.find((n) => n.type !== 'InnerA')!;
    expect(innerPlaceholder.type).not.toBe(defB.id);
    expect(defIds.has(innerPlaceholder.type)).toBe(true);
    const clonedB = defs.find((d) => d.id === innerPlaceholder.type)!;
    expect(clonedB.nodes![0].type).toBe('InnerB');
  });

  it('same-workflow paste also rewires to the cloned definitions (no aliasing the originals)', () => {
    const payload = buildNodeClipboardPayload(source, 'root/node:7')!;
    const result = applyClipboardPaste(source, payload, null)!;
    const defs = result.workflow.definitions?.subgraphs ?? [];
    expect(defs).toHaveLength(4); // originals + 2 clones
    const pasted = result.workflow.nodes.find((n) => n.id === result.newNodeIds[0])!;
    expect(pasted.type).not.toBe(defA.id);
    const clonedA = defs.find((d) => d.id === pasted.type)!;
    const innerPlaceholder = clonedA.nodes!.find((n) => n.type !== 'InnerA')!;
    expect(innerPlaceholder.type).not.toBe(defB.id);
    expect(defs.some((d) => d.id === innerPlaceholder.type)).toBe(true);
  });
});
