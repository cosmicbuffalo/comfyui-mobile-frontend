import * as THREE from 'three';

export function disposeObject(object: THREE.Object3D) {
  object.traverse(child => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
      material.dispose();
    }
  });
}

/**
 * The /view address of a file a glTF or FBX names relative to the model. The
 * folder goes in `subfolder`: /view keeps only the basename of `filename`.
 */
export function sidecarUrl(modelSrc: string, reference: string): string {
  if (/^(data|blob|https?):/i.test(reference)) return reference;
  const url = new URL(modelSrc, window.location.href);
  let relative = reference;
  try {
    relative = decodeURIComponent(reference);
  } catch {
    // A raw '%' in a file name: the reference is already plain text.
  }
  const parts = `${url.searchParams.get('subfolder') ?? ''}/${url.searchParams.get('filename') ?? ''}`.split('/').filter(Boolean).slice(0, -1);
  for (const part of relative.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  url.searchParams.set('filename', parts.pop() ?? '');
  url.searchParams.set('subfolder', parts.join('/'));
  return url.href;
}
