import type { FileItem } from "@/api/client";

export function resolveUploadFolder(
  supportsVideoUpload: boolean,
  imageFolder: string,
): string {
  return supportsVideoUpload ? "input" : imageFolder;
}

export function isOutputFileSelectable(
  fileType: FileItem["type"],
  supportsVideoUpload: boolean,
): boolean {
  if (fileType === "folder") return false;
  return supportsVideoUpload ? fileType === "video" : fileType === "image";
}
