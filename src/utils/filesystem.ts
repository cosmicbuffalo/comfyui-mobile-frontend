import { getImageUrl, uploadImageFile, type AssetSource, type FileItem } from '@/api/client';
import { resolveFilePath } from './workflowOperations';

export function splitFilePath(path: string) {
  const normalized = path.replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return { filename: normalized, subfolder: '' };
  }
  const filename = parts.pop() ?? normalized;
  return { filename, subfolder: parts.join('/') };
}

export async function resolveInputPathForFile(file: FileItem, source: AssetSource): Promise<string> {
  if (source === 'input') {
    return resolveFilePath(file, source);
  }
  const filePath = resolveFilePath(file, source);
  const { filename, subfolder } = splitFilePath(filePath);
  const url = file.fullUrl || getImageUrl(filename, subfolder, source);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch image data.');
  }
  const blob = await response.blob();
  const fileName = filename || file.name || 'image.png';
  const uploadFile = new File([blob], fileName, { type: blob.type || 'image/png' });
  const uploaded = await uploadImageFile(uploadFile, { type: 'input', overwrite: true });
  const inputPath = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
  const verify = await fetch(getImageUrl(uploaded.name, uploaded.subfolder ?? '', 'input'));
  if (!verify.ok) {
    throw new Error('Uploaded image was not found in inputs.');
  }
  return inputPath;
}
