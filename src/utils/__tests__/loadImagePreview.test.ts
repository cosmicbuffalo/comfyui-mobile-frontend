import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';
import { resolveLoadImagePreview } from '../loadImagePreview';

const NODE_TYPES = {
  LoadImage: { input: { required: { image: [['photo.png']] } }, output: ['IMAGE', 'MASK'] },
} as unknown as NodeTypes;

function workflowWith(value: unknown): { workflow: Workflow; node: WorkflowNode } {
  const node = {
    id: 1, type: 'LoadImage', pos: [0, 0], size: [100, 100], flags: {}, order: 0, mode: 0,
    inputs: [], outputs: [], properties: {}, widgets_values: [value, 'image'],
  } as unknown as WorkflowNode;
  return { workflow: { nodes: [node], links: [], groups: [] } as unknown as Workflow, node };
}

describe('resolveLoadImagePreview', () => {
  it('reads a plain filename', () => {
    const { workflow, node } = workflowWith('photo.png');
    expect(resolveLoadImagePreview(workflow, NODE_TYPES, node))
      .toEqual({ filename: 'photo.png', subfolder: '', type: 'input' });
  });

  it('splits a subfolder', () => {
    const { workflow, node } = workflowWith('sub/photo.png');
    expect(resolveLoadImagePreview(workflow, NODE_TYPES, node))
      .toEqual({ filename: 'sub/photo.png'.split('/').pop(), subfolder: 'sub', type: 'input' });
  });

  it('strips the directory annotation a mask save writes', () => {
    // The value a mask save puts in the widget. Leaving " [input]" glued to the
    // filename still *displays* fine, because ComfyUI's /view calls
    // annotated_filepath itself -- but it makes the ref a different string from
    // the one the save recorded, which silently broke cross-session undo.
    const { workflow, node } = workflowWith('clipspace/clipspace-painted-masked-42.png [input]');
    expect(resolveLoadImagePreview(workflow, NODE_TYPES, node)).toEqual({
      filename: 'clipspace-painted-masked-42.png',
      subfolder: 'clipspace',
      type: 'input',
    });
  });

  it('takes the directory from the annotation rather than assuming input', () => {
    const { workflow, node } = workflowWith('run_00012_.png [output]');
    expect(resolveLoadImagePreview(workflow, NODE_TYPES, node))
      .toEqual({ filename: 'run_00012_.png', subfolder: '', type: 'output' });
  });

  it('leaves a filename that merely ends in brackets alone', () => {
    const { workflow, node } = workflowWith('render [final].png');
    expect(resolveLoadImagePreview(workflow, NODE_TYPES, node))
      .toEqual({ filename: 'render [final].png', subfolder: '', type: 'input' });
  });
});
