import { describe, expect, it } from 'vitest';
import { sidecarUrl } from './modelAssets';

const params = (href: string) => Object.fromEntries(new URL(href).searchParams);
const model = '/view?filename=scene.gltf&subfolder=3d&type=output&cb=1';

describe('sidecarUrl', () => {
  it('puts a sidecar beside the model, keeping its source and cache token', () => {
    expect(params(sidecarUrl(model, 'scene.bin'))).toEqual({ filename: 'scene.bin', subfolder: '3d', type: 'output', cb: '1' });
  });

  it('moves a sidecar directory into subfolder, which /view keeps', () => {
    expect(params(sidecarUrl(model, 'textures/albedo.png'))).toMatchObject({ filename: 'albedo.png', subfolder: '3d/textures' });
    expect(params(sidecarUrl(model, '../shared/./wood.png'))).toMatchObject({ filename: 'wood.png', subfolder: 'shared' });
  });

  it('decodes a percent-encoded reference once, and leaves a raw percent sign alone', () => {
    expect(params(sidecarUrl(model, 'my%20texture.png')).filename).toBe('my texture.png');
    expect(params(sidecarUrl('/view?filename=100%25%20scale.gltf&subfolder=&type=output', '100% scale.bin'))).toMatchObject({ filename: '100% scale.bin', subfolder: '' });
  });

  it('leaves embedded and absolute references untouched', () => {
    expect(sidecarUrl(model, 'data:application/octet-stream;base64,AAAA')).toBe('data:application/octet-stream;base64,AAAA');
    expect(sidecarUrl(model, 'blob:http://localhost/1')).toBe('blob:http://localhost/1');
  });
});
