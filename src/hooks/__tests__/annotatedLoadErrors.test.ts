import { beforeEach, describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { collectWorkflowLoadErrors } from '@/hooks/useWorkflow/comboValues';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useWorkflowErrorsStore } from '@/hooks/useWorkflowErrors';

/**
 * A file inside an input folder (a hidden one, say) is never one of
 * LoadImage's options: ComfyUI lists only top-level input files. Such a value
 * names its directory -- `sub/img.png [input]` -- and ComfyUI resolves it by
 * path. The load-time check reported it as "Missing value" anyway, so any
 * workflow loaded with one showed a node error for a file that is right there.
 */

const NODE_TYPES = {
  LoadImage: {
    input: { required: { image: [['top-level.png'], { image_upload: true }] } },
    input_order: { required: ['image'] },
    output: ['IMAGE', 'MASK'],
    output_name: ['IMAGE', 'MASK'],
    name: 'LoadImage',
    display_name: 'Load Image',
    description: '',
    python_module: 'nodes',
    category: 'image',
  },
} as unknown as NodeTypes;

function loadImage(id: number, value: string): WorkflowNode {
  return {
    id,
    type: 'LoadImage',
    pos: [0, 0], size: [300, 300], flags: {}, order: 0, mode: 0,
    inputs: [],
    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }, { name: 'MASK', type: 'MASK', links: [] }],
    properties: {},
    widgets_values: [value, 'image'],
  } as unknown as WorkflowNode;
}

function workflow(...nodes: WorkflowNode[]): Workflow {
  return {
    last_node_id: 10, last_link_id: 0, nodes, links: [], groups: [], config: {}, version: 0.4,
  } as unknown as Workflow;
}

describe('load errors for a value that names its own directory', () => {
  it.each([
    'hidden-folder/%leading-percent.png [input]',
    'hidden-folder/plain.png [input]',
    'renders/final.png [output]',
  ])('does not report %s as missing', (value) => {
    expect(collectWorkflowLoadErrors(workflow(loadImage(1, value)), NODE_TYPES)).toEqual({});
  });

  it('still reports a bare top-level value the server does not have', () => {
    const errors = collectWorkflowLoadErrors(workflow(loadImage(1, 'gone.png')), NODE_TYPES);
    expect(errors['1']?.[0]).toMatchObject({ type: 'workflow_load', inputName: 'image' });
  });
});

describe('loading a workflow with a bare path into a hidden folder', () => {
  beforeEach(() => {
    useWorkflowErrorsStore.setState({ error: null, nodeErrors: {}, errorCycleIndex: 0, errorsDismissed: false });
    useWorkflowStore.setState({ workflow: null, nodeTypes: NODE_TYPES, sessions: [], activeSessionId: null, parkedSessions: {} });
  });

  it('opens with the value annotated and no missing-value error', async () => {
    // The exact report: an older image names `hidden-folder/%file.png` bare.
    await useWorkflowStore.getState().loadWorkflow(
      workflow(loadImage(1, 'hidden-folder/%mhx-subonly-pct.png')),
      'from-image.json',
    );
    const loaded = useWorkflowStore.getState().workflow!;
    expect((loaded.nodes[0].widgets_values as unknown[])[0])
      .toBe('hidden-folder/%mhx-subonly-pct.png [input]');
    expect(useWorkflowErrorsStore.getState().nodeErrors).toEqual({});
  });
});
