import { describe, expect, it } from 'vitest';
import {
  clipspaceRef,
  formatImageWidgetValue,
  layerFilenames,
  layerFilenamesForImage,
  parseImageWidgetValue,
  viewUrl,
} from '../clipspace';

describe('layerFilenames', () => {
  it('names all four layers off one timestamp', () => {
    expect(layerFilenames(1700000000000)).toEqual({
      maskedImage: 'clipspace-mask-1700000000000.png',
      paint: 'clipspace-paint-1700000000000.png',
      paintedImage: 'clipspace-painted-1700000000000.png',
      paintedMaskedImage: 'clipspace-painted-masked-1700000000000.png',
    });
  });
});

describe('layerFilenamesForImage', () => {
  it('recovers the sibling layers of a previous edit', () => {
    // This is how re-opening an edit gets the paint strokes back as an editable
    // layer instead of baked into the picture.
    expect(layerFilenamesForImage('clipspace-painted-masked-42.png')).toEqual(layerFilenames(42));
  });

  it('returns null for an ordinary image', () => {
    expect(layerFilenamesForImage('photo.png')).toBeNull();
    expect(layerFilenamesForImage('clipspace-mask-42.png')).toBeNull();
  });

  it('returns null when the timestamp is not a number', () => {
    expect(layerFilenamesForImage('clipspace-painted-masked-.png')).toBeNull();
    expect(layerFilenamesForImage('clipspace-painted-masked-abc.png')).toBeNull();
  });
});

describe('parseImageWidgetValue', () => {
  it('splits subfolder, filename and type', () => {
    expect(parseImageWidgetValue('clipspace/clipspace-mask-1.png [input]')).toEqual({
      filename: 'clipspace-mask-1.png',
      subfolder: 'clipspace',
      type: 'input',
    });
  });

  it('defaults a bare filename to the input folder', () => {
    // LoadImage only reads from input/, so that is the only safe default.
    expect(parseImageWidgetValue('photo.png')).toEqual({
      filename: 'photo.png',
      subfolder: '',
      type: 'input',
    });
  });

  it('keeps a nested subfolder intact', () => {
    expect(parseImageWidgetValue('a/b/c.png [output]')).toEqual({
      filename: 'c.png',
      subfolder: 'a/b',
      type: 'output',
    });
  });

  it('round-trips through formatImageWidgetValue', () => {
    const value = 'clipspace/clipspace-painted-masked-9.png [input]';
    expect(formatImageWidgetValue(parseImageWidgetValue(value))).toBe(value);
  });
});

describe('formatImageWidgetValue', () => {
  it('always annotates the type', () => {
    // `folder_paths.annotated_filepath` reads this suffix to pick a root
    // directory; without it a clipspace file resolves against the wrong one.
    expect(formatImageWidgetValue(clipspaceRef('x.png'))).toBe('clipspace/x.png [input]');
  });
});

describe('viewUrl', () => {
  it('requests a channel when asked', () => {
    // rgb and a are how the base pixels and the mask are pulled apart: ComfyUI
    // stores both in one PNG.
    const url = new URL(viewUrl(clipspaceRef('x.png'), { channel: 'a' }), 'http://x');
    expect(url.searchParams.get('channel')).toBe('a');
    expect(url.searchParams.get('type')).toBe('input');
    expect(url.searchParams.get('subfolder')).toBe('clipspace');
  });

  it('omits the channel for a plain fetch', () => {
    const url = new URL(viewUrl(clipspaceRef('x.png')), 'http://x');
    expect(url.searchParams.has('channel')).toBe(false);
  });
});
