import { beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import {
  MOBILE_SLOT_LABELS_PROPERTY,
  resolveBoundarySlotLabel,
} from '@/utils/boundarySlotLabels';

const INNER = 'sg-inner';
const OUTER = 'sg-outer';

function node(id: number, type: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type,
    itemKey: `key:${id}`,
    pos: [0, 0],
    size: [10, 10],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
    ...overrides,
  } as WorkflowNode;
}

/**
 * One shared type with instances in two different scopes: instance 10 at root,
 * instance 30 inside another subgraph. Renaming for the whole type has to
 * reach both, and the rename modal's "All instances" branch is the only path
 * that claims to.
 */
function makeWorkflow(): Workflow {
  return {
    last_node_id: 40,
    last_link_id: 40,
    nodes: [node(10, INNER), node(20, OUTER)],
    links: [],
    groups: [],
    config: {},
    definitions: {
      subgraphs: [
        {
          id: INNER,
          name: 'Inner',
          inputs: [{ id: 'i1', name: 'model', type: 'MODEL', linkIds: [] }],
          outputs: [],
          nodes: [],
          links: [],
        },
        {
          id: OUTER,
          name: 'Outer',
          inputs: [],
          outputs: [],
          nodes: [node(30, INNER)],
          links: [],
        },
      ],
    },
  } as unknown as Workflow;
}

const definitionOf = (workflow: Workflow, id: string) =>
  (workflow.definitions?.subgraphs ?? []).find((candidate) => candidate.id === id)!;

const rootInstance = (workflow: Workflow) =>
  (workflow.nodes ?? []).find((candidate) => candidate.id === 10)!;

const nestedInstance = (workflow: Workflow) =>
  (definitionOf(workflow, OUTER).nodes ?? []).find((candidate) => candidate.id === 30)!;

describe('renaming a boundary slot for the whole type', () => {
  beforeEach(() => {
    useWorkflowStore.setState({
      workflow: makeWorkflow(),
      nodeTypes: {},
      scopeStack: [
        { type: 'root' },
        { type: 'subgraph', id: INNER, placeholderNodeId: 10 },
      ],
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });
  });

  it('reaches an instance in another scope, not just the one you are standing in', () => {
    useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Base model', 'definition');
    const workflow = useWorkflowStore.getState().workflow!;

    // The name lives on the TYPE, so both instances resolve to it — including
    // the one nested inside another subgraph, which the entered scope never
    // touches.
    expect(
      resolveBoundarySlotLabel(definitionOf(workflow, INNER), rootInstance(workflow), 'input', 0),
    ).toBe('Base model');
    expect(
      resolveBoundarySlotLabel(definitionOf(workflow, INNER), nestedInstance(workflow), 'input', 0),
    ).toBe('Base model');
  });

  it('writes the name once on the type and leaves no per-instance override behind', () => {
    useWorkflowStore.getState().setBoundarySlotLabel('input', 0, 'Base model', 'definition');
    const workflow = useWorkflowStore.getState().workflow!;

    expect(definitionOf(workflow, INNER).inputs?.[0]?.label).toBe('Base model');
    // An override on either instance would win over the type's name and make
    // the rename look like it had not reached that instance.
    for (const instance of [rootInstance(workflow), nestedInstance(workflow)]) {
      expect(instance.properties?.[MOBILE_SLOT_LABELS_PROPERTY]).toBeUndefined();
    }
  });

  it('clearing the name for the type returns both instances to the slot name', () => {
    const store = () => useWorkflowStore.getState();
    store().setBoundarySlotLabel('input', 0, 'Base model', 'definition');
    store().setBoundarySlotLabel('input', 0, '', 'definition');
    const workflow = store().workflow!;

    expect(definitionOf(workflow, INNER).inputs?.[0]?.label).toBeUndefined();
    expect(
      resolveBoundarySlotLabel(definitionOf(workflow, INNER), nestedInstance(workflow), 'input', 0),
    ).toBe('model');
  });
});
