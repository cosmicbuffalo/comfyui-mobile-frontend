import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '@/api/types';
import { savedTextPreview } from '../savedTextPreview';

const node = (type: string, widgets_values: unknown): WorkflowNode => ({
  id: 1, type, pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0, inputs: [], outputs: [], properties: {},
  widgets_values: widgets_values as unknown[],
});

describe('savedTextPreview', () => {
  it('shows the text a ShowText node saved, dropping the empty first slot', () => {
    expect(savedTextPreview(node('ShowText|pysssss', ['', 'a red fox', 'a barn owl']))).toBe('a red fox\n\na barn owl');
    expect(savedTextPreview(node('ShowText|pysssss', [['nested']]))).toBe('nested');
  });

  it('covers easy showAnything and Display Any, and nothing else', () => {
    expect(savedTextPreview(node('easy showAnything', ['er_sde']))).toBe('er_sde');
    expect(savedTextPreview(node('Display Any (rgthree)', ['[]']))).toBe('[]');
    expect(savedTextPreview(node('CLIPTextEncode', ['a prompt']))).toBeNull();
    expect(savedTextPreview(node('ShowText|pysssss', null))).toBeNull();
  });
});
