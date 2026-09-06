import { describe, expect, it } from 'vitest';
import type { Workflow, WorkflowSubgraphDefinition } from '@/api/types';
import { makeLocationPointer } from '@/utils/mobileLayout';
import { applyClipboardPaste, buildNodeClipboardPayload } from '@/utils/workflowClipboard';

/**
 * Pasting a subgraph placeholder into a workflow that does not have its type.
 *
 * The definition is cloned and its interior renumbered, but the placeholder's
 * `properties.proxyWidgets` addresses inner nodes BY ID — so without following
 * that renumbering the pasted instance names nodes that exist nowhere. Stock
 * quarantines each unresolvable entry (`missingSourceNode`) and rescues only
 * entries written against the `-1` boundary sentinel, so the instance silently
 * reverts those widgets to the definition's baked values and keeps a
 * `proxyWidgetErrorQuarantine` property afterwards.
 *
 * This is the cross-tab paste path: the clipboard is shared between workflow
 * tabs, and 121 of the 184 subgraph-bearing shipped templates carry direct
 * proxy entries, so it is the ordinary shape rather than an edge case.
 */
const D = 'def-1';
const key = (id: number) => makeLocationPointer({ type: 'node', nodeId: id, subgraphId: null });

const source = (): Workflow => ({
  last_node_id: 20, last_link_id: 0, links: [], groups: [], config: {}, version: 1,
  nodes: [{
    id: 20, itemKey: key(20), type: D, pos: [0, 0], size: [10, 10], flags: {}, order: 0, mode: 0,
    inputs: [], outputs: [],
    properties: { proxyWidgets: [['5', 'cfg'], ['-1', 'steps']] },
    widgets_values: [7, 20],
  }],
  definitions: { subgraphs: [{
    id: D, name: 'Sub', inputs: [], outputs: [], groups: [], links: [],
    nodes: [{
      id: 5, itemKey: makeLocationPointer({ type: 'node', nodeId: 5, subgraphId: D }),
      type: 'KSampler', pos: [0, 0], size: [10, 10], flags: {}, order: 0, mode: 0,
      inputs: [], outputs: [], properties: {}, widgets_values: [7],
    }],
  } as unknown as WorkflowSubgraphDefinition] },
} as unknown as Workflow);

const emptyTarget = (): Workflow => ({
  last_node_id: 100, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, version: 1,
  definitions: { subgraphs: [] },
} as unknown as Workflow);

describe('pasting a placeholder whose type has to be cloned', () => {
  it('follows the interior renumbering in proxyWidgets', () => {
    const payload = buildNodeClipboardPayload(source(), key(20))!;
    const pasted = applyClipboardPaste(emptyTarget(), payload, null)!.workflow;

    const def = pasted.definitions!.subgraphs![0];
    const placeholder = pasted.nodes.find((node) => node.type === def.id)!;
    const innerIds = (def.nodes ?? []).map((node) => node.id);
    const proxies = (placeholder.properties as Record<string, unknown>).proxyWidgets as string[][];

    for (const [sourceId] of proxies) {
      if (sourceId === '-1') continue;
      expect(innerIds, `proxyWidgets names inner node ${sourceId}`).toContain(Number(sourceId));
    }
  });

  it('leaves boundary entries and their order alone', () => {
    const payload = buildNodeClipboardPayload(source(), key(20))!;
    const pasted = applyClipboardPaste(emptyTarget(), payload, null)!.workflow;
    const placeholder = pasted.nodes.find((node) => node.type !== 'KSampler')!;
    const proxies = (placeholder.properties as Record<string, unknown>).proxyWidgets as string[][];

    // Position carries the values, so the list must not be reordered, and a
    // `-1` entry addresses by name and must not be renumbered.
    expect(proxies.map((entry) => entry[1])).toEqual(['cfg', 'steps']);
    expect(proxies[1]).toEqual(['-1', 'steps']);
    expect(placeholder.widgets_values).toEqual([7, 20]);
  });
});
