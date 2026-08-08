import { describe, expect, it } from 'vitest';
import {
  injectMarketingNote,
  isMarketingNote,
  stripMarketingNotes,
  MARKETING_NOTE_MARKER,
} from '@/utils/marketingNote';
import { REPO_URL } from '@/constants';
import type { Workflow, WorkflowNode } from '@/api/types';

function node(id: number, pos: [number, number]): WorkflowNode {
  return {
    id,
    type: `Node${id}`,
    pos,
    size: [200, 100],
    flags: {},
    order: id,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
  };
}

function wf(nodes: WorkflowNode[]): Workflow {
  return {
    nodes,
    links: [],
    groups: [],
    config: {},
    last_node_id: Math.max(0, ...nodes.map((n) => n.id)),
    last_link_id: 0,
    version: 0.4,
  } as unknown as Workflow;
}

describe('marketingNote', () => {
  it('injects a MarkdownNote directly above the top-left-most node', () => {
    // Top-left-most = smallest x, tie-break smallest y. Node 2 at x=100 wins.
    const workflow = wf([node(1, [500, 300]), node(2, [100, 400]), node(3, [100, 800])]);
    const out = injectMarketingNote(workflow);
    const note = out.nodes.find(isMarketingNote);
    expect(note).toBeTruthy();
    expect(note!.type).toBe('MarkdownNote');
    // Same x as the anchor (node 2), positioned above it (smaller y).
    expect(note!.pos[0]).toBe(100);
    expect(note!.pos[1]).toBeLessThan(400);
    // Carries the credit text + repo link.
    const text = String((note!.widgets_values as unknown[])[0]);
    expect(text).toContain('comfyui-mobile-frontend');
    expect(text).toContain(REPO_URL);
    // Fresh id beyond the existing max.
    expect(note!.id).toBeGreaterThan(3);
  });

  it('does not duplicate an already-present note', () => {
    const workflow = injectMarketingNote(wf([node(1, [0, 0])]));
    const again = injectMarketingNote(workflow);
    expect(again.nodes.filter(isMarketingNote)).toHaveLength(1);
    expect(again).toBe(workflow); // unchanged reference
  });

  it('strips marketing notes from a workflow', () => {
    const withNote = injectMarketingNote(wf([node(1, [0, 0]), node(2, [50, 0])]));
    expect(withNote.nodes.some(isMarketingNote)).toBe(true);
    const stripped = stripMarketingNotes(withNote);
    expect(stripped.nodes.some(isMarketingNote)).toBe(false);
    expect(stripped.nodes.map((n) => n.id)).toEqual([1, 2]);
  });

  it('isMarketingNote keys off the marker property', () => {
    const marked = { ...node(9, [0, 0]), properties: { [MARKETING_NOTE_MARKER]: true } };
    expect(isMarketingNote(marked)).toBe(true);
    expect(isMarketingNote(node(9, [0, 0]))).toBe(false);
  });

  it('handles an empty workflow (note anchored at origin)', () => {
    const out = injectMarketingNote(wf([]));
    const note = out.nodes.find(isMarketingNote);
    expect(note).toBeTruthy();
    expect(note!.pos[0]).toBe(0);
  });
});
