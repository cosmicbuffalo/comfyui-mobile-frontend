import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Workflow, WorkflowNode } from '@/api/types';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { FastGroupsBypasserControls } from '../FastGroupsBypasserControls';

/**
 * A group holding a subgraph can be switched off AND back on.
 *
 * Bypassing a group writes the mode of the nodes in the group's OWN scope —
 * for a group holding a subgraph that is the placeholder, deliberately, so the
 * other instances of a shared type are not dragged along. The switch, though,
 * read every target the group reaches, inner nodes of the subgraph included.
 * Those keep mode 0, so the switch still read "engaged" after the group had
 * been bypassed: it never flipped, and because its state is what decides the
 * direction of the next press, every further press asked to bypass again. The
 * group could be turned off and then never turned back on.
 */
const SG = 'sg-section';

describe('fast bypasser switch on a group holding a subgraph', () => {
  let container: HTMLDivElement;
  let root: Root;

  const bypasser = {
    id: 1,
    itemKey: 'node:1',
    type: 'FastGroupsBypasser',
    pos: [0, 0],
    size: [200, 100],
    flags: {},
    order: 0,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
  } as unknown as WorkflowNode;

  const placeholder = {
    id: 2,
    itemKey: 'node:2',
    type: SG,
    pos: [60, 60],
    size: [100, 40],
    flags: {},
    order: 1,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [],
  } as unknown as WorkflowNode;

  const build = (): Workflow => ({
    last_node_id: 2,
    last_link_id: 0,
    nodes: [bypasser, { ...placeholder }],
    links: [],
    // The group's box contains the placeholder, which is how membership is decided.
    groups: [{ id: 7, title: 'Section', bounding: [50, 50, 300, 200], itemKey: 'group:7' }],
    config: {},
    version: 1,
    definitions: {
      subgraphs: [{
        id: SG,
        name: 'Section',
        inputs: [],
        outputs: [],
        groups: [],
        links: [],
        nodes: [{
          id: 50,
          itemKey: `node:50:${SG}`,
          type: 'KSampler',
          pos: [0, 0],
          size: [10, 10],
          flags: {},
          order: 0,
          mode: 0,
          inputs: [],
          outputs: [],
          properties: {},
          widgets_values: [],
        }],
      }],
    },
  } as unknown as Workflow);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useWorkflowStore.setState({
      workflow: build(),
      scopeStack: [{ type: 'root' }],
      nodeTypes: {},
      itemKeyByPointer: {},
      pointerByHierarchicalKey: {},
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
  });

  const render = async () => {
    await act(async () => {
      root.render(
        <FastGroupsBypasserControls
          node={bypasser}
          isBypassed={false}
          showFastGroupConfig={false}
          setShowFastGroupConfig={() => {}}
        />,
      );
    });
  };

  const theSwitch = () => container.querySelector<HTMLButtonElement>('button[role="switch"]')!;
  const placeholderMode = () =>
    useWorkflowStore.getState().workflow!.nodes.find((n) => n.id === 2)!.mode;

  it('flips off when the group is bypassed, and back on again', async () => {
    await render();
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');

    await act(async () => theSwitch().click());
    expect(placeholderMode(), 'the placeholder should be bypassed').toBe(4);
    // The switch has to follow what the press actually did, or the next press
    // asks for the same thing again and the group is stuck off.
    expect(theSwitch().getAttribute('aria-checked')).toBe('false');

    await act(async () => theSwitch().click());
    expect(placeholderMode(), 'a second press should engage it again').toBe(0);
    expect(theSwitch().getAttribute('aria-checked')).toBe('true');
  });
});
