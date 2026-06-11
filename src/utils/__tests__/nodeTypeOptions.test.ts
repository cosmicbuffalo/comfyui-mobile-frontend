import { describe, expect, it } from 'vitest';
import type { NodeTypes } from '@/api/types';
import { addInputFileOptionToNodeTypes } from '../nodeTypeOptions';

function makeNodeTypes(): NodeTypes {
  return {
    LoadImage: {
      input: {
        required: {
          image: [['a.png', 'b.png'], { image_upload: true }],
          // A non-upload combo on the same node must stay untouched.
          channel: [['red', 'green', 'blue']],
        },
      },
    },
    KSampler: {
      input: {
        required: {
          sampler_name: [['euler', 'dpmpp_2m'], {}],
        },
      },
    },
    LoadImageMask: {
      input: {
        optional: {
          image: [['x.png'], { image_upload: true }],
        },
      },
    },
  } as unknown as NodeTypes;
}

describe('addInputFileOptionToNodeTypes', () => {
  it('appends the file to every image-upload combo (required and optional)', () => {
    const types = makeNodeTypes();
    const next = addInputFileOptionToNodeTypes(types, 'new.png');

    expect(next).not.toBe(types);
    expect(next.LoadImage.input.required!.image[0]).toEqual(['a.png', 'b.png', 'new.png']);
    expect(next.LoadImageMask.input.optional!.image[0]).toEqual(['x.png', 'new.png']);
  });

  it('leaves non-image-upload combos and sampler lists untouched', () => {
    const types = makeNodeTypes();
    const next = addInputFileOptionToNodeTypes(types, 'new.png');

    expect(next.LoadImage.input.required!.channel[0]).toEqual(['red', 'green', 'blue']);
    expect(next.KSampler.input.required!.sampler_name[0]).toEqual(['euler', 'dpmpp_2m']);
    // Unchanged definitions keep their identity (no needless re-render churn).
    expect(next.KSampler).toBe(types.KSampler);
  });

  it('does not mutate the input node types', () => {
    const types = makeNodeTypes();
    addInputFileOptionToNodeTypes(types, 'new.png');
    expect(types.LoadImage.input.required!.image[0]).toEqual(['a.png', 'b.png']);
  });

  it('returns the same reference when the file is already a choice', () => {
    const types = makeNodeTypes();
    const next = addInputFileOptionToNodeTypes(types, 'a.png');
    // LoadImageMask doesn't have a.png, so it WILL change — assert per-node instead.
    expect(next.LoadImage.input.required!.image[0]).toEqual(['a.png', 'b.png']);
    expect(next.LoadImage).toBe(types.LoadImage);
  });

  it('returns the same reference when there are no image-upload combos', () => {
    const types = { KSampler: makeNodeTypes().KSampler } as NodeTypes;
    expect(addInputFileOptionToNodeTypes(types, 'new.png')).toBe(types);
  });

  it('returns the same reference for an empty value', () => {
    const types = makeNodeTypes();
    expect(addInputFileOptionToNodeTypes(types, '')).toBe(types);
  });
});
