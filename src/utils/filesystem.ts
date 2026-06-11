import { copyFileToInput, type AssetSource, type FileItem } from '@/api/client';
import { resolveFilePath } from './workflowOperations';

export async function resolveInputPathForFile(file: FileItem, source: AssetSource): Promise<string> {
  if (source === 'input') {
    return resolveFilePath(file, source);
  }
  const filePath = resolveFilePath(file, source);
  if (source === 'output' || source === 'temp') {
    const copied = await copyFileToInput(filePath, source, { overwrite: true });
    return copied.subfolder ? `${copied.subfolder}/${copied.name}` : copied.name;
  }
  throw new Error(`Cannot load ${source} files into nodes.`);
}
