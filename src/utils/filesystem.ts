import { copyFileToInput, setFileState, type AssetSource, type FileItem } from '@/api/client';
import { resolveFilePath } from './workflowOperations';

export async function resolveInputPathForFile(
  file: FileItem,
  source: AssetSource,
  options?: { hideCopiedInput?: boolean },
): Promise<string> {
  if (source === 'input') {
    return resolveFilePath(file, source);
  }
  const filePath = resolveFilePath(file, source);
  if (source === 'output' || source === 'temp') {
    const copied = await copyFileToInput(filePath, source, { overwrite: true });
    const inputPath = copied.subfolder ? `${copied.subfolder}/${copied.name}` : copied.name;
    if (options?.hideCopiedInput) {
      // Best-effort declutter, not part of the contract: the copy already
      // succeeded and the caller only needs the path. The server 409s whenever
      // it can't stat/hash the target — exactly the window right after
      // materializing the file on a slow disk — and letting that throw would
      // fail an operation that actually worked (in bulk process it drops the
      // image from the run entirely). Matches how ComboControl fires this.
      void setFileState('input', inputPath, 'hidden', true).catch((err) => {
        console.warn('Could not hide the copied input file:', err);
      });
    }
    return inputPath;
  }
  throw new Error(`Cannot load ${source} files into nodes.`);
}
