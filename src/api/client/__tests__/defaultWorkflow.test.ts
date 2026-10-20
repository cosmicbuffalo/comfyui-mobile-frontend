import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadDefaultWorkflow } from '../workflows';
import { buildWorkflowPromptInputs } from '@/utils/workflowInputs';
import type { NodeTypes } from '@/api/types';

const types = JSON.parse(gunzipSync(readFileSync('src/utils/__tests__/fixtures/legacyCore-0.37.2.object_info.json.gz')).toString()) as NodeTypes;
afterEach(() => vi.unstubAllGlobals());
it('uses the new core endpoint without caching the response', async () => {
  const wf = { nodes: [], links: [] };
  const fetch = vi.fn(async () => new Response(JSON.stringify(wf)));
  vi.stubGlobal('fetch', fetch);
  expect(await loadDefaultWorkflow(types)).toEqual(wf);
  expect(fetch).toHaveBeenCalledWith('/default_workflow', { cache: 'no-store' });
});
it('builds a linked editable starter on an older core', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  const wf = await loadDefaultWorkflow(types);
  expect(wf.nodes).toHaveLength(7); expect(wf.links).toHaveLength(9);
  const sampler = wf.nodes.find(n => n.type === 'KSampler')!;
  const prompt = buildWorkflowPromptInputs(wf, types, sampler, sampler.type, new Set(wf.nodes.map(n => n.id)), null);
  expect(prompt).toMatchObject({ model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed: 0 });
  for (const link of wf.links) expect(wf.nodes.find(n => n.id === link[3])!.inputs[link[4]].link).toBe(link[0]);
});
it('reports server and malformed-response failures rather than treating them as an old core', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
  await expect(loadDefaultWorkflow(types)).rejects.toThrow('Failed to load');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
  await expect(loadDefaultWorkflow(types)).rejects.toThrow('Invalid starter');
});
