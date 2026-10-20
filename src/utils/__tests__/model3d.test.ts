import { expect, it } from 'vitest';
import { model3dMetadata, standardize3dOutput } from '../model3d';

const camera = { position: { x: 0, y: 1, z: 5 }, target: { x: 0, y: 0, z: 0 }, zoom: 1, cameraType: 'perspective' };

it("reads core 0.40 Preview 3D's background image from its result", () => {
  const output: Record<string, unknown> = standardize3dOutput({ result: ['mobile-0.40-showcase/torus-knot.glb', camera, 'temp/bg_1a2b.png'] });
  expect(output['3d']).toEqual([{ filename: 'torus-knot.glb', subfolder: 'mobile-0.40-showcase', type: 'output' }]);
  expect(model3dMetadata(output, 0)).toEqual({ camera, transform: undefined, background: { filename: 'bg_1a2b.png', subfolder: '', type: 'temp' } });
});

it('still reads an older core\'s third slot as the model placement, and a plain path as an input', () => {
  const placement = { position: { x: 1, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } };
  expect(model3dMetadata(standardize3dOutput({ result: ['mesh.glb', camera, placement] }), 0)).toEqual({ camera, transform: placement, background: undefined });
  expect(model3dMetadata(standardize3dOutput({ result: ['mesh.glb', camera, 'backgrounds/sky.png'] }), 0).background)
    .toEqual({ filename: 'sky.png', subfolder: 'backgrounds', type: 'input' });
  expect(model3dMetadata(standardize3dOutput({ result: ['mesh.glb', camera, null] }), 0).background).toBeUndefined();
});
