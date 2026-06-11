import type { AssetSource, FileItem, SortMode } from "@/api/client";

export function getInputPickerValue(
  file: FileItem,
  source: AssetSource = "input",
): string {
  const prefix = `${source}/`;
  return file.id.startsWith(prefix) ? file.id.slice(prefix.length) : file.id;
}

export function projectInputSearchResults(
  results: FileItem[],
  folder: string | null,
  source: AssetSource = "input",
): FileItem[] {
  const folderPrefix = folder ? `${folder}/` : "";
  const folders = new Map<string, { date: number; count: number }>();
  const directFiles: FileItem[] = [];

  for (const file of results) {
    const relativePath = getInputPickerValue(file, source);
    if (!relativePath.startsWith(folderPrefix)) continue;
    const remainder = relativePath.slice(folderPrefix.length);
    if (!remainder) continue;
    const slashIndex = remainder.indexOf("/");
    if (slashIndex === -1) {
      directFiles.push(file);
      continue;
    }

    const name = remainder.slice(0, slashIndex);
    const existing = folders.get(name);
    const date = file.date ?? 0;
    if (existing) {
      existing.count += 1;
      existing.date = Math.max(existing.date, date);
    } else {
      folders.set(name, { date, count: 1 });
    }
  }

  return [
    ...Array.from(folders.entries()).map(([name, info]) => ({
      id: `${source}/${folderPrefix}${name}`,
      name,
      type: "folder" as const,
      date: info.date,
      matchCount: info.count,
    })),
    ...directFiles,
  ];
}

export function sortInputPickerFiles(files: FileItem[], mode: SortMode): FileItem[] {
  const result = [...files];
  const direction = mode.endsWith("-reverse") ? -1 : 1;
  if (mode.startsWith("name")) {
    result.sort((a, b) => a.name.localeCompare(b.name) * direction);
  } else if (mode.startsWith("size")) {
    result.sort((a, b) => ((a.size ?? 0) - (b.size ?? 0)) * direction);
  } else {
    result.sort((a, b) => ((a.date ?? 0) - (b.date ?? 0)) * -1 * direction);
  }
  return result;
}
