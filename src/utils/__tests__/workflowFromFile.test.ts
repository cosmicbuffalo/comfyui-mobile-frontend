import { describe, expect, it } from 'vitest';
import { readWorkflowFromFile } from '../workflowFromFile';

function ascii(s: string): number[] {
  return Array.from(s).map((c) => c.charCodeAt(0));
}

function pngChunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff,
    ...ascii(type), ...data, 0, 0, 0, 0,
  ];
}

function pngWithWorkflow(text: string): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return Uint8Array.from([
    ...sig,
    ...pngChunk('tEXt', [...ascii('workflow'), 0, ...ascii(text)]),
    ...pngChunk('IEND', []),
  ]);
}

// jsdom's File doesn't implement text()/arrayBuffer() reliably, so build a
// File-like stub that exposes exactly the reader surface readWorkflowFromFile
// uses (name, type, text, arrayBuffer). This keeps the test on the dispatch
// logic, not the environment's Blob internals.
function fakeFile(name: string, type: string, content: string | Uint8Array): File {
  const bytes = typeof content === 'string' ? Uint8Array.from(ascii(content)) : content;
  return {
    name,
    type,
    text: async () => (typeof content === 'string' ? content : new TextDecoder().decode(bytes)),
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  } as unknown as File;
}

const WF = JSON.stringify({ nodes: [{ id: 1, type: 'KSampler' }], links: [] });

describe('readWorkflowFromFile', () => {
  it('loads a workflow from a .json file', async () => {
    const result = await readWorkflowFromFile(fakeFile('flow.json', 'application/json', WF));
    expect(result.kind).toBe('workflow');
    if (result.kind === 'workflow') {
      expect(result.workflow.nodes[0].type).toBe('KSampler');
      expect(result.filename).toBe('flow.json');
    }
  });

  it('reports invalid for malformed json', async () => {
    const result = await readWorkflowFromFile(fakeFile('flow.json', 'application/json', '{ not json'));
    expect(result.kind).toBe('invalid');
  });

  it('reports invalid for json missing a nodes array', async () => {
    const result = await readWorkflowFromFile(fakeFile('flow.json', 'application/json', '{"links":[]}'));
    expect(result.kind).toBe('invalid');
  });

  it('extracts a workflow from a PNG image', async () => {
    const result = await readWorkflowFromFile(fakeFile('out.png', 'image/png', pngWithWorkflow(WF)));
    expect(result.kind).toBe('workflow');
  });

  it('reports no-workflow for an image without embedded data', async () => {
    const result = await readWorkflowFromFile(fakeFile('plain.png', 'image/png', pngWithWorkflow('not json {{{')));
    expect(result.kind).toBe('no-workflow');
    if (result.kind === 'no-workflow') expect(result.filename).toBe('plain.png');
  });

  it('reports invalid for an unsupported file type', async () => {
    const result = await readWorkflowFromFile(fakeFile('notes.txt', 'text/plain', 'hello'));
    expect(result.kind).toBe('invalid');
  });
});
