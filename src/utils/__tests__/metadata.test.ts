import { describe, it, expect } from 'vitest';
import { extractMetadata } from '../metadata';

describe('extractMetadata', () => {
  it('returns empty metadata for null/undefined/non-object', () => {
    expect(extractMetadata(null)).toEqual({});
    expect(extractMetadata(undefined)).toEqual({});
    expect(extractMetadata('string')).toEqual({});
    expect(extractMetadata(42)).toEqual({});
  });

  it('extracts model from CheckpointLoaderSimple', () => {
    const prompt = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' }
      }
    };
    expect(extractMetadata(prompt)).toMatchObject({
      model: 'sd_xl_base_1.0'
    });
  });

  it('strips .ckpt and .pt extensions from model name', () => {
    const prompt = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'model_v2.ckpt' }
      }
    };
    expect(extractMetadata(prompt).model).toBe('model_v2');

    const prompt2 = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'model.pt' }
      }
    };
    expect(extractMetadata(prompt2).model).toBe('model');
  });

  it('extracts sampler info from KSampler', () => {
    const prompt = {
      '1': {
        class_type: 'KSampler',
        inputs: {
          steps: 20,
          cfg: 7.5,
          sampler_name: 'euler_ancestral',
          scheduler: 'normal'
        }
      }
    };
    const result = extractMetadata(prompt);
    expect(result).toMatchObject({
      steps: 20,
      cfg: 7.5,
      sampler: 'euler_ancestral',
      scheduler: 'normal'
    });
  });

  it('extracts sampler info from KSamplerAdvanced', () => {
    const prompt = {
      '3': {
        class_type: 'KSamplerAdvanced',
        inputs: {
          steps: 30,
          cfg: 8,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras'
        }
      }
    };
    const result = extractMetadata(prompt);
    expect(result).toMatchObject({
      steps: 30,
      cfg: 8,
      sampler: 'dpmpp_2m',
      scheduler: 'karras'
    });
  });

  it('extracts from SamplerCustom with linked sampler/scheduler nodes', () => {
    const prompt = {
      '1': {
        class_type: 'KSamplerSelect',
        inputs: { sampler_name: 'euler' },
        widgets_values: ['euler']
      },
      '2': {
        class_type: 'BasicScheduler',
        inputs: { scheduler: 'simple', steps: 25 },
        widgets_values: ['simple', 25]
      },
      '3': {
        class_type: 'SamplerCustom',
        inputs: {
          cfg: 4.0,
          sampler: ['1', 0],
          sigmas: ['2', 0]
        }
      }
    };
    const result = extractMetadata(prompt);
    expect(result).toMatchObject({
      cfg: 4.0,
      sampler: 'euler',
      scheduler: 'simple',
      steps: 25
    });
  });

  it('extracts cfg from FluxGuidance', () => {
    const prompt = {
      '1': {
        class_type: 'FluxGuidance',
        inputs: { guidance: 3.5 }
      }
    };
    expect(extractMetadata(prompt)).toMatchObject({ cfg: 3.5 });
  });

  it('handles history array format [number, string, graph, ...]', () => {
    const graph = {
      '1': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'flux1-dev.safetensors' }
      },
      '2': {
        class_type: 'KSampler',
        inputs: { steps: 15, cfg: 5, sampler_name: 'dpm_fast', scheduler: 'normal' }
      }
    };
    const prompt = [0, 'prompt-id', graph, { extra: true }];
    const result = extractMetadata(prompt);
    expect(result).toMatchObject({
      model: 'flux1-dev',
      steps: 15,
      cfg: 5,
      sampler: 'dpm_fast',
      scheduler: 'normal'
    });
  });

  it('returns empty metadata for empty graph', () => {
    expect(extractMetadata({})).toEqual({});
  });

  it('uses first sampler values when multiple samplers exist', () => {
    const prompt = {
      '1': {
        class_type: 'KSampler',
        inputs: { steps: 10, cfg: 3, sampler_name: 'euler', scheduler: 'normal' }
      },
      '2': {
        class_type: 'KSampler',
        inputs: { steps: 20, cfg: 7, sampler_name: 'dpmpp_2m', scheduler: 'karras' }
      }
    };
    const result = extractMetadata(prompt);
    expect(result.steps).toBe(10);
    expect(result.cfg).toBe(3);
    expect(result.sampler).toBe('euler');
    expect(result.scheduler).toBe('normal');
  });
});
