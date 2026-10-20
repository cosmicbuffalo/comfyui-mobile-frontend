/**
 * Does this frontend still treat older ComfyUI cores exactly as before?
 *
 * The fixtures are real `/object_info` catalogs from core v0.37.2 and v0.34.2
 * (CPU, no custom nodes). For every node, the baselines record what released
 * 3.3.10 built: default widget values, sockets, the active input walk, widget
 * definitions and the prompt inputs a fresh node submits. Support for newer
 * cores must not change any of that for a core that predates it.
 *
 * Regenerate a baseline only from a checkout of the last release, never from
 * the branch under test:
 *   LEGACY_CORE_BASELINE_DIR=<dir> npx vitest run legacyCoreCompatibility
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { NodeTypeDefinition, Workflow, WorkflowNode } from '@/api/types';
import {
  buildDefaultConnectionInputs,
  buildDefaultWidgetValues,
  buildWorkflowPromptInputs,
  getActiveNodeInputDefinitions,
} from '../workflowInputs';
import { getWidgetDefinitions } from '../widgetDefinitions';
import { makeLocationPointer } from '../mobileLayout';

const FIXTURES = path.join(__dirname, 'fixtures');
const VERSIONS = ['0.34.2', '0.37.2'];

const readGzipJson = (file: string) => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));

function digestNode(type: string, typeDef: NodeTypeDefinition) {
  const nodeTypes = { [type]: typeDef };
  try {
    const node: WorkflowNode = {
      id: 1,
      itemKey: makeLocationPointer({ type: 'node', nodeId: 1, subgraphId: null }),
      type,
      inputs: buildDefaultConnectionInputs(typeDef).map(input => ({ ...input, link: null })),
      outputs: [],
      widgets_values: buildDefaultWidgetValues(typeDef),
      pos: [0, 0],
      size: [200, 100],
      flags: {},
      order: 0,
      mode: 0,
      properties: {},
    };
    const workflow: Workflow = { nodes: [node], links: [], groups: [], last_node_id: 1, last_link_id: 0, config: {}, extra: {}, version: 0.4 };
    return {
      widgets: node.widgets_values,
      sockets: node.inputs.map(input => [input.name, input.type]),
      active: getActiveNodeInputDefinitions(typeDef, node).map(input => [input.qualifiedName, input.widgetIndex, input.connected]),
      widgetDefinitions: getWidgetDefinitions(nodeTypes, node).map(widget => [widget.name, widget.type, widget.widgetIndex]),
      prompt: buildWorkflowPromptInputs(workflow, nodeTypes, node, type, new Set([1]), null),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function digestCatalog(objectInfo: Record<string, NodeTypeDefinition>) {
  return Object.fromEntries(Object.keys(objectInfo).sort().map(type => [type, digestNode(type, objectInfo[type])]));
}

describe.each(VERSIONS)('ComfyUI core %s', version => {
  const objectInfo = readGzipJson(path.join(FIXTURES, `legacyCore-${version}.object_info.json.gz`));

  it('builds every node exactly as the last release did', () => {
    const digest = digestCatalog(objectInfo);
    const outDir = process.env.LEGACY_CORE_BASELINE_DIR;
    if (outDir) {
      fs.writeFileSync(path.join(outDir, `legacyCore-${version}.baseline.json.gz`), zlib.gzipSync(JSON.stringify(digest), { level: 9 }));
      return;
    }
    const baseline = readGzipJson(path.join(FIXTURES, `legacyCore-${version}.baseline.json.gz`));
    expect(Object.keys(digest)).toEqual(Object.keys(baseline));
    const changed = Object.keys(baseline).filter(type => JSON.stringify(digest[type]) !== JSON.stringify(baseline[type]));
    expect(changed).toEqual([]);
  });
});
