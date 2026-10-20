import type { HistoryOutputImage } from '@/api/types';
import { splitPathAnnotation } from '@/utils/annotatedPath';

export interface Model3dMetadata {
  camera?: {
    position: { x: number; y: number; z: number };
    target: { x: number; y: number; z: number };
    zoom: number;
    cameraType: 'perspective' | 'orthographic';
    quaternion?: { x: number; y: number; z: number; w: number };
    fov?: number; near?: number; far?: number;
    frustum?: { left: number; right: number; top: number; bottom: number };
    useCustomUp?: boolean; customUp?: { x: number; y: number; z: number };
  };
  transform?: {
    position: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
    scale: { x: number; y: number; z: number };
  };
}
export const MODEL_EXTENSIONS = new Set(['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply', 'splat', 'spz', 'ksplat']);
export const isModelFilename = (name: string) => MODEL_EXTENSIONS.has(name.split('?')[0].split('.').pop()?.toLowerCase() ?? '');
export const isModelOutput = (output: HistoryOutputImage) => output.model3d !== undefined || isModelFilename(output.filename);

export function model3dMetadata(output: Record<string, unknown>, index: number): Model3dMetadata {
  return {
    camera: Array.isArray(output.camera_info) ? output.camera_info[0] : undefined,
    transform: Array.isArray(output.model_3d_info) ? output.model_3d_info[index] : undefined,
  };
}

/**
 * Preview3D reports `result: [model_file, camera_info, ...]` instead of the
 * standard `3d` bucket. The path is relative to the output folder unless it
 * carries a `[temp]`/`[input]` annotation (Preview3DAdvanced on core 0.37), and
 * cores before 0.40 put the model placement third where 0.40 has a background
 * image path. Rewrite it into the bucket so live and history ingestion treat
 * every shape the same way.
 */
export function standardize3dOutput<T extends Record<string, unknown>>(output: T): T {
  const result = output.result;
  if ('3d' in output || !Array.isArray(result) || typeof result[0] !== 'string') return output;
  const { path, type } = splitPathAnnotation(result[0].replaceAll('\\', '/'));
  if (!isModelFilename(path)) return output;
  const slash = path.lastIndexOf('/');
  const camera = result[1] && typeof result[1] === 'object' ? result[1] : undefined;
  const placement = result[2] && typeof result[2] === 'object' ? result[2] : undefined;
  return {
    ...output,
    '3d': [{ filename: path.slice(slash + 1), subfolder: slash < 0 ? '' : path.slice(0, slash), type: type ?? 'output' }],
    camera_info: [camera],
    ...(placement ? { model_3d_info: Array.isArray(placement) ? placement : [placement] } : {}),
  };
}
