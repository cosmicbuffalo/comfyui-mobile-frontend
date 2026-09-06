import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NodeTypes, Workflow } from '@/api/types';
import { buildPromptFromWorkflow } from '../buildPromptFromWorkflow';
import { validateAndNormalizeWorkflow } from '../workflowValidator';

/**
 * The two hand-authored demo workflows in scripts/fixtures/demo are how the new
 * Power Puter and mask-editor support gets exercised against a real ComfyUI.
 * A demo that fails to queue is worse than no demo, so their structure is
 * checked here rather than discovered on a phone.
 */

function loadDemo(name: string): Workflow {
  const path = resolve(__dirname, '../../../scripts/fixtures/demo', name);
  return JSON.parse(readFileSync(path, 'utf8')) as Workflow;
}

/** Minimal schemas for the node types the demos use. */
const NODE_TYPES = {
  CheckpointLoaderSimple: {
    input: { required: { ckpt_name: [['v1-5-pruned-emaonly.safetensors', 'v1-5-pruned-emaonly.safetensors']] } },
    output: ['MODEL', 'CLIP', 'VAE'],
  },
  CLIPTextEncode: {
    input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } },
    output: ['CONDITIONING'],
  },
  EmptyLatentImage: {
    input: { required: { width: ['INT', { default: 512 }], height: ['INT', { default: 512 }], batch_size: ['INT', { default: 1 }] } },
    output: ['LATENT'],
  },
  KSampler: {
    input: {
      required: {
        model: ['MODEL'],
        seed: ['INT', { default: 0, min: 0, max: 1125899906842624 }],
        steps: ['INT', { default: 20 }],
        cfg: ['FLOAT', { default: 8 }],
        sampler_name: [['euler', 'dpmpp_2m']],
        scheduler: [['normal', 'simple']],
        positive: ['CONDITIONING'],
        negative: ['CONDITIONING'],
        latent_image: ['LATENT'],
        denoise: ['FLOAT', { default: 1 }],
      },
    },
    output: ['LATENT'],
  },
  VAEDecode: { input: { required: { samples: ['LATENT'], vae: ['VAE'] } }, output: ['IMAGE'] },
  SaveImage: { input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', { default: 'ComfyUI' }] } }, output: [] },
  LoadImage: { input: { required: { image: [['example.png']] } }, output: ['IMAGE', 'MASK'] },
  VAEEncodeForInpaint: {
    input: { required: { pixels: ['IMAGE'], vae: ['VAE'], mask: ['MASK'], grow_mask_by: ['INT', { default: 6 }] } },
    output: ['LATENT'],
  },
  // Both rgthree nodes report an empty schema, exactly as object_info does.
  'Power Lora Loader (rgthree)': { input: { required: {}, optional: {} }, output: ['MODEL', 'CLIP'] },
  'Power Puter (rgthree)': { input: { required: {}, optional: {} }, output: ['*'] },
  'Seed (rgthree)': { input: { required: { seed: ['INT', { default: 0, min: -1125899906842624, max: 1125899906842624 }] } }, output: ['INT'] },
  'Display Any (rgthree)': { input: { required: { source: ['*'] } }, output: [] },
} as unknown as NodeTypes;

type Prompt = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

function build(workflow: Workflow): Prompt {
  return buildPromptFromWorkflow(workflow, NODE_TYPES) as Prompt;
}

describe('demo-power-puter.json', () => {
  const workflow = loadDemo('demo-power-puter.json');
  const prompt = build(workflow);

  it('normalizes without the validator having to repair links', () => {
    const validated = validateAndNormalizeWorkflow(workflow);
    expect(validated.links).toEqual(workflow.links);
  });

  it('includes every node', () => {
    expect(Object.keys(prompt).sort((a, b) => Number(a) - Number(b)))
      .toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].sort((a, b) => Number(a) - Number(b)));
  });

  it('ships the Power Puter code and outputs the backend needs', () => {
    // The whole point of the fix: without these two keys the node raises.
    expect(prompt['3'].inputs.code).toContain('node(2).inputs.values()');
    expect(prompt['3'].inputs.outputs).toEqual({ outputs: ['STRING'] });
  });

  it('gives the two-output Power Puter a tuple-returning expression', () => {
    // rgthree raises if the code returns a non-tuple while >1 output is declared.
    expect(prompt['11'].inputs.outputs).toEqual({ outputs: ['INT', 'FLOAT'] });
    expect(String(prompt['11'].inputs.code).trim()).toMatch(/^\(.*,.*\)$/);
  });

  it('exposes the Power Lora Loader rows under lora_ keys the Puter can read', () => {
    // rgthree's helper filters `name.startswith('lora_')`, and the wiki example
    // walks inputs.values() looking for an `on` flag.
    const loraEntries = Object.entries(prompt['2'].inputs)
      .filter(([name]) => name.startsWith('lora_'));
    expect(loraEntries.length).toBe(2);
    for (const [, value] of loraEntries) {
      expect(value).toMatchObject({ lora: expect.any(String), on: expect.any(Boolean) });
    }
  });

  it('feeds the sampler from the Seed node rather than its own widget', () => {
    expect(prompt['8'].inputs.seed).toEqual(['6', 0]);
    expect(prompt['8'].inputs.steps).toEqual(['11', 0]);
    expect(prompt['8'].inputs.cfg).toEqual(['11', 1]);
  });

  it('carries a concrete (fixed) seed on the Seed node', () => {
    expect(prompt['6'].inputs.seed).toBe(987654321);
  });

  it('drives the positive prompt from the Puter output', () => {
    expect(prompt['4'].inputs.text).toEqual(['3', 0]);
  });

  it('echoes the same Puter output to a Display Any, so it is readable on the card', () => {
    // Without this the only evidence the expression ran is the picture itself.
    expect(prompt['12'].inputs.source).toEqual(['3', 0]);
  });

  it('wires the sampler through to a SaveImage', () => {
    expect(prompt['9'].inputs.samples).toEqual(['8', 0]);
    expect(prompt['10'].inputs.images).toEqual(['9', 0]);
  });
});

describe('demo-mask-editor.json', () => {
  const workflow = loadDemo('demo-mask-editor.json');
  const prompt = build(workflow);

  it('normalizes without the validator having to repair links', () => {
    const validated = validateAndNormalizeWorkflow(workflow);
    expect(validated.links).toEqual(workflow.links);
  });

  it('routes the LoadImage MASK output into the inpaint encoder', () => {
    // Slot 1 is MASK; slot 0 is IMAGE. Swapping them silently inpaints nothing.
    expect(prompt['3'].inputs.mask).toEqual(['2', 1]);
    expect(prompt['3'].inputs.pixels).toEqual(['2', 0]);
  });

  it('samples from the masked latent', () => {
    expect(prompt['6'].inputs.latent_image).toEqual(['3', 0]);
  });

  it('points at an image that the mask editor can open', () => {
    expect(prompt['2'].inputs.image).toBe('example.png');
  });

  it('wires through to a SaveImage', () => {
    expect(prompt['7'].inputs.samples).toEqual(['6', 0]);
    expect(prompt['8'].inputs.images).toEqual(['7', 0]);
  });
});
