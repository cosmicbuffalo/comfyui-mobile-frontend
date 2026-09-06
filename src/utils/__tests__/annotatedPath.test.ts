import { describe, expect, it } from 'vitest';
import { annotateInputPath, isAnnotatedPath, splitPathAnnotation } from '../annotatedPath';

describe('splitPathAnnotation', () => {
  it('splits the directory annotation off a mask-editor value', () => {
    expect(splitPathAnnotation('clipspace/masked-1.png [input]')).toEqual({
      path: 'clipspace/masked-1.png',
      suffix: ' [input]',
      type: 'input',
    });
  });

  it('recognises all three directories', () => {
    for (const type of ['input', 'output', 'temp'] as const) {
      expect(splitPathAnnotation(`a.png [${type}]`).type).toBe(type);
    }
  });

  it('leaves an unannotated path untouched', () => {
    expect(splitPathAnnotation('photo.png')).toEqual({
      path: 'photo.png', suffix: '', type: null,
    });
  });

  it('does not treat an arbitrary bracketed suffix as an annotation', () => {
    // Only ComfyUI's three directory names mean anything here; a filename that
    // merely ends in brackets is just a filename.
    expect(splitPathAnnotation('render [final].png').type).toBeNull();
    expect(splitPathAnnotation('photo [v2]').type).toBeNull();
  });

  it('requires the space before the bracket', () => {
    expect(splitPathAnnotation('photo[input]').type).toBeNull();
  });

  it('round-trips path + suffix back to the original', () => {
    const value = 'clipspace/clipspace-painted-masked-9.png [input]';
    const { path, suffix } = splitPathAnnotation(value);
    expect(path + suffix).toBe(value);
  });
});

describe('isAnnotatedPath', () => {
  it('is true for a value resolved by path rather than by combo membership', () => {
    // object_info only lists top-level input files, so a clipspace path can
    // never appear in the option list; flagging it as missing was wrong.
    expect(isAnnotatedPath('clipspace/masked-1.png [input]')).toBe(true);
    expect(isAnnotatedPath('run_00012_.png [output]')).toBe(true);
  });

  it('is false for an ordinary combo value', () => {
    expect(isAnnotatedPath('photo.png')).toBe(false);
    expect(isAnnotatedPath('SDXL/model.safetensors')).toBe(false);
  });
});

describe('annotateInputPath', () => {
  it('names the directory on a path object_info could never offer', () => {
    // LoadImage builds its options from os.listdir(input_dir) filtered by
    // isfile — top level only. A file picked out of a subfolder is therefore
    // never in the list, and left bare it read as "Missing on ComfyUI server"
    // while sitting right there on disk.
    expect(annotateInputPath('fixture-subfolder/photo.jpeg')).toBe(
      'fixture-subfolder/photo.jpeg [input]',
    );
    expect(annotateInputPath('batch/nested/photo.png')).toBe(
      'batch/nested/photo.png [input]',
    );
  });

  it('leaves a top-level file bare, because it IS a combo choice', () => {
    expect(annotateInputPath('photo.jpeg')).toBe('photo.jpeg');
  });

  it('does not annotate twice, or re-home an output annotation', () => {
    expect(annotateInputPath('batch/photo.png [input]')).toBe('batch/photo.png [input]');
    expect(annotateInputPath('batch/photo.png [output]')).toBe('batch/photo.png [output]');
  });

  it('leaves an empty value alone', () => {
    expect(annotateInputPath('')).toBe('');
  });

  it('round-trips back to the path on disk', () => {
    const onDisk = 'fixture-subfolder/photo.jpeg';
    expect(splitPathAnnotation(annotateInputPath(onDisk)).path).toBe(onDisk);
  });
});
