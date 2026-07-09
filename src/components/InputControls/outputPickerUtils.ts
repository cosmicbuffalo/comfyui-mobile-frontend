import type { FileItem } from "@/api/client";

export function resolveUploadFolder(
  supportsVideoUpload: boolean,
  imageFolder: string,
): string {
  if (supportsVideoUpload) return "input";
  // "output"/"temp" are ComfyUI's annotated directories. The mobile frontend
  // doesn't emit "[output]"/"[temp]" path annotations, and LoadImage-family
  // nodes (including LoadImageOutput) read from the input dir by default — so a
  // bare filename only resolves if the file actually lives under input/. Route
  // those picks through the copy-to-input fast path: the selected file lands in
  // input and the stored bare filename resolves correctly for both queue-time
  // aliasing and execution. Other custom folders (e.g. "mask_inputs") are left
  // alone so their files keep targeting the folder the node expects.
  if (imageFolder === "output" || imageFolder === "temp") return "input";
  return imageFolder;
}

export function isOutputFileSelectable(
  fileType: FileItem["type"],
  supportsVideoUpload: boolean,
): boolean {
  if (fileType === "folder") return false;
  return supportsVideoUpload ? fileType === "video" : fileType === "image";
}
