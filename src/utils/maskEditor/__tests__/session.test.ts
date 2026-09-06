import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveMaskEdit } from '../session';
import type { ComposedLayers } from '../compose';

/**
 * The upload chain in `saveMaskEdit` is where a mistake is silent: a wrong
 * `original_ref` produces a perfectly valid PNG merged onto the wrong picture,
 * and nothing surfaces until the render comes back looking odd.
 */

interface Capture {
  url: string;
  filename: string;
  originalRef: { filename: string; subfolder: string; type: string };
  subfolder: string;
  type: string;
}

const captured: Capture[] = [];

function fakeCanvas(): HTMLCanvasElement {
  return {
    toBlob: (callback: BlobCallback) => callback(new Blob(['x'], { type: 'image/png' })),
  } as unknown as HTMLCanvasElement;
}

const layers: ComposedLayers = {
  maskedImage: fakeCanvas(),
  paint: fakeCanvas(),
  paintedImage: fakeCanvas(),
  paintedMaskedImage: fakeCanvas(),
};

beforeEach(() => {
  captured.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const form = init.body as FormData;
    const file = form.get('image') as File;
    captured.push({
      url,
      filename: file.name,
      originalRef: JSON.parse(String(form.get('original_ref'))),
      subfolder: String(form.get('subfolder')),
      type: String(form.get('type')),
    });
    return {
      ok: true,
      json: async () => ({ name: file.name, subfolder: 'clipspace', type: 'input' }),
    };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sourceRef = { filename: 'photo.png', subfolder: '', type: 'input' };

describe('saveMaskEdit', () => {
  it('uploads all four layers under one timestamp', async () => {
    await saveMaskEdit(layers, sourceRef, 777);
    expect(captured.map((c) => c.filename)).toEqual([
      'clipspace-mask-777.png',
      'clipspace-paint-777.png',
      'clipspace-painted-777.png',
      'clipspace-painted-masked-777.png',
    ]);
  });

  it('sends the two mask layers to /upload/mask and the rest to /upload/image', async () => {
    // Only /upload/mask performs the server-side alpha merge; sending a mask
    // layer to /upload/image would store the transparent version verbatim and
    // lose the original's pixels entirely.
    await saveMaskEdit(layers, sourceRef, 1);
    expect(captured.map((c) => c.url)).toEqual([
      '/upload/mask',
      '/upload/image',
      '/upload/image',
      '/upload/mask',
    ]);
  });

  it('merges the final layer onto the painted upload, not the original', async () => {
    // This is the ordering bug worth guarding: referencing the original here
    // would drop the paint strokes from the image that actually executes.
    await saveMaskEdit(layers, sourceRef, 5);
    expect(captured[0].originalRef).toEqual(sourceRef);
    expect(captured[3].originalRef).toEqual({
      filename: 'clipspace-painted-5.png',
      subfolder: 'clipspace',
      type: 'input',
    });
  });

  it('writes every layer into input/clipspace', async () => {
    await saveMaskEdit(layers, sourceRef, 1);
    for (const call of captured) {
      expect(call.subfolder).toBe('clipspace');
      expect(call.type).toBe('input');
    }
  });

  it('returns the painted-masked layer as the ref a node should point at', async () => {
    const saved = await saveMaskEdit(layers, sourceRef, 3);
    expect(saved.paintedMasked).toEqual({
      filename: 'clipspace-painted-masked-3.png',
      subfolder: 'clipspace',
      type: 'input',
    });
  });

  it('follows a server-side rename rather than the name it asked for', async () => {
    // The server renames on collision; the merge target and the node's value
    // both have to be what actually landed on disk.
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const form = init.body as FormData;
      const file = form.get('image') as File;
      captured.push({
        url,
        filename: file.name,
        originalRef: JSON.parse(String(form.get('original_ref'))),
        subfolder: String(form.get('subfolder')),
        type: String(form.get('type')),
      });
      return {
        ok: true,
        json: async () => ({ name: `${file.name.replace('.png', '')} (1).png`, subfolder: 'clipspace', type: 'input' }),
      };
    }));

    const saved = await saveMaskEdit(layers, sourceRef, 8);
    expect(captured[3].originalRef.filename).toBe('clipspace-painted-8 (1).png');
    expect(saved.paintedMasked.filename).toBe('clipspace-painted-masked-8 (1).png');
  });

  it('surfaces a failed upload instead of reporting success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 507,
      statusText: 'Insufficient Storage',
      text: async () => 'disk full',
    })));
    await expect(saveMaskEdit(layers, sourceRef, 1)).rejects.toThrow(/507/);
  });
});
