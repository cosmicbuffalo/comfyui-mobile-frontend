import { describe, expect, it } from 'vitest';
import { collectMissingNodeTypes, isUninstalledNodeType } from '../missingNodes';
import type { NodeTypes, Workflow, WorkflowNode } from '@/api/types';

function node(id: number, type: string, over: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id, type, pos: [0, 0], size: [100, 60], flags: {}, order: id, mode: 0,
    inputs: [], outputs: [], properties: {}, ...over,
  } as unknown as WorkflowNode;
}

function wf(nodes: WorkflowNode[], subgraphs: unknown[] = []): Workflow {
  return { nodes, links: [], groups: [], definitions: { subgraphs } } as unknown as Workflow;
}

const NODE_TYPES = {
  KSampler: { input: { required: {} }, output: [] },
  SaveImage: { input: { required: {} }, output: [] },
} as unknown as NodeTypes;

describe('isUninstalledNodeType', () => {
  it('is false for an installed type', () => {
    expect(isUninstalledNodeType(node(1, 'KSampler'), NODE_TYPES)).toBe(false);
  });
  it('is true for an uninstalled custom type', () => {
    expect(isUninstalledNodeType(node(1, 'FluxPro_fal'), NODE_TYPES)).toBe(true);
  });
  it('is false for handled builtin types', () => {
    for (const t of ['Note', 'Reroute', 'PrimitiveNode', 'MarkdownNote', 'GraphInput', 'GraphOutput']) {
      expect(isUninstalledNodeType(node(1, t), NODE_TYPES)).toBe(false);
    }
  });
  it('is false for Set/Get relay nodes', () => {
    expect(isUninstalledNodeType(node(1, 'SetNode', { widgets_values: ['x'] }), NODE_TYPES)).toBe(false);
    expect(isUninstalledNodeType(node(2, 'GetNode', { widgets_values: ['x'] }), NODE_TYPES)).toBe(false);
  });
  it('is false for client-side reroute variants', () => {
    // These are registered client-side by their extension and never appear in
    // object_info, so desktop doesn't flag them — neither do we.
    expect(isUninstalledNodeType(node(1, 'Reroute (rgthree)'), NODE_TYPES)).toBe(false);
    expect(isUninstalledNodeType(node(2, 'ReroutePrimitive|pysssss'), NODE_TYPES)).toBe(false);
  });
  it('is false for rgthree UI-only virtual nodes (no object_info entry)', () => {
    // These are registered client-side by rgthree and never appear in
    // object_info even when the pack is installed, so they must not render as
    // "Missing Node" (which would hide their custom controls, e.g. the Fast
    // Groups Bypasser group toggles).
    expect(isUninstalledNodeType(node(1, 'Fast Groups Bypasser (rgthree)'), NODE_TYPES)).toBe(false);
    expect(isUninstalledNodeType(node(2, 'Fast Muter (rgthree)'), NODE_TYPES)).toBe(false);
    expect(isUninstalledNodeType(node(3, 'Label (rgthree)'), NODE_TYPES)).toBe(false);
  });
  it('is false while node types are not yet loaded', () => {
    expect(isUninstalledNodeType(node(1, 'FluxPro_fal'), null)).toBe(false);
    expect(isUninstalledNodeType(node(1, 'FluxPro_fal'), {} as NodeTypes)).toBe(false);
  });
});

describe('collectMissingNodeTypes', () => {
  it('returns nothing when all nodes are installed', () => {
    const w = wf([node(1, 'KSampler'), node(2, 'SaveImage')]);
    expect(collectMissingNodeTypes(w, NODE_TYPES)).toEqual([]);
  });

  it('collects unique missing types in document order', () => {
    const w = wf([
      node(1, 'KSampler'),
      node(2, 'FluxPro_fal'),
      node(3, 'Text'),
      node(4, 'FluxPro_fal'), // duplicate type
    ]);
    expect(collectMissingNodeTypes(w, NODE_TYPES)).toEqual(['FluxPro_fal', 'Text']);
  });

  it('detects missing types inside subgraphs but ignores placeholder nodes', () => {
    const w = wf(
      [node(1, 'sg-uuid')], // placeholder (type === subgraph id) — not missing
      [{ id: 'sg-uuid', nodes: [node(5, 'UninstalledInner')], links: [], groups: [] }],
    );
    expect(collectMissingNodeTypes(w, NODE_TYPES)).toEqual(['UninstalledInner']);
  });

  it('returns [] when node types are not yet loaded', () => {
    const w = wf([node(1, 'FluxPro_fal')]);
    expect(collectMissingNodeTypes(w, null)).toEqual([]);
    expect(collectMissingNodeTypes(w, {} as NodeTypes)).toEqual([]);
  });

  it('returns [] for a null workflow', () => {
    expect(collectMissingNodeTypes(null, NODE_TYPES)).toEqual([]);
  });
});

describe('display-name resolution', () => {
  it('does not flag a node the prompt builder can still resolve', () => {
    // buildPromptFromWorkflow falls back to display_name/name when the class
    // lookup misses, so a workflow saved with display names queues and runs
    // fine — flagging it would be a false "missing node" alarm.
    const nodeTypes = {
      KSamplerAdvanced: {
        input: { required: {}, optional: {} },
        output: [], output_name: [],
        name: 'KSamplerAdvanced',
        display_name: 'KSampler (Advanced)',
        description: '', python_module: '', category: '',
      },
    } as unknown as NodeTypes;

    expect(
      isUninstalledNodeType({ type: 'KSampler (Advanced)' } as WorkflowNode, nodeTypes),
    ).toBe(false);
    expect(
      isUninstalledNodeType({ type: 'GenuinelyAbsentNode' } as WorkflowNode, nodeTypes),
    ).toBe(true);
  });
});
