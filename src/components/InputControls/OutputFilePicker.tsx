import { useCallback, useEffect, useState } from "react";
import { FolderIcon } from "@/components/icons";
import { getUserImages, uploadImageFile } from "@/api/client";
import type { FileItem } from "@/api/client";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import { isOutputFileSelectable } from "./outputPickerUtils";

interface OutputFilePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (value: string) => void;
  uploadFolder: string;
  supportsVideoUpload: boolean;
}

export function OutputFilePicker({
  open,
  onClose,
  onPick,
  uploadFolder,
  supportsVideoUpload,
}: OutputFilePickerProps) {
  const setError = useWorkflowErrorsStore((s) => s.setError);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [folder, setFolder] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const loadFolder = useCallback(async (nextFolder: string | null) => {
    setFolder(nextFolder);
    setIsLoading(true);
    try {
      const result = await getUserImages("output", 1000, 0, "modified", false, nextFolder);
      setFiles(result);
    } catch (err) {
      console.error("Failed to load output files:", err);
      setError(`Failed to browse output folder${nextFolder ? `: ${nextFolder}` : ""}`);
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  const handleClose = () => {
    onClose();
    setFiles([]);
    setFolder(null);
  };

  const handlePickFile = async (file: FileItem) => {
    if (!isOutputFileSelectable(file.type, supportsVideoUpload)) return;
    setIsCopying(true);
    try {
      const url = file.fullUrl;
      if (!url) throw new Error("No URL for output file");
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const blob = await response.blob();
      const uploadFile = new File([blob], file.name, { type: blob.type || "application/octet-stream" });
      const result = await uploadImageFile(uploadFile, {
        type: uploadFolder,
        overwrite: true,
      });
      const value = result.subfolder
        ? `${result.subfolder}/${result.name}`
        : result.name;
      onPick(value);
      handleClose();
    } catch (err) {
      console.error("Failed to copy output file:", err);
      setError(`Failed to copy "${file.name}" to inputs`);
      handleClose();
    } finally {
      setIsCopying(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void loadFolder(null);
  }, [open, loadFolder]);

  if (!open) return null;

  const parentFolder = folder?.includes("/")
    ? folder.substring(0, folder.lastIndexOf("/"))
    : null;

  return (
    <div
      className="fixed inset-0 z-[2150] bg-black/50 flex items-center justify-center p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {isCopying && (
          <div className="absolute inset-0 z-10 bg-white/70 dark:bg-gray-900/70 flex items-center justify-center">
            <span className="text-sm text-gray-500 dark:text-gray-400">Copying file...</span>
          </div>
        )}
        <div className="px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <span className="flex-1">
            {folder ? `outputs / ${folder}` : "Select from outputs"}
          </span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {folder && (
            <button
              className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2 text-gray-500 dark:text-gray-400 border-b border-gray-50 dark:border-gray-800"
              onClick={() => loadFolder(parentFolder)}
            >
              <FolderIcon className="w-4 h-4" />
              ..
            </button>
          )}
          {isLoading && (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">Loading...</div>
          )}
          {!isLoading && files.length === 0 && (
            <div className="px-4 py-6 text-sm text-gray-400 text-center">No files found</div>
          )}
          {!isLoading && files.map((f) => {
            if (f.type === "folder") {
              return (
                <button
                  key={f.id}
                  className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2"
                  onClick={() => loadFolder(folder ? `${folder}/${f.name}` : f.name)}
                >
                  <FolderIcon className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-900 dark:text-gray-100 truncate">{f.name}</span>
                </button>
              );
            }
            if (!isOutputFileSelectable(f.type, supportsVideoUpload)) return null;
            return (
              <button
                key={f.id}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-3 disabled:opacity-60"
                onClick={() => handlePickFile(f)}
                disabled={isCopying}
              >
                {f.previewUrl && (
                  <img
                    src={f.previewUrl}
                    alt=""
                    className="w-12 h-12 rounded object-cover bg-gray-100 dark:bg-gray-800 shrink-0"
                    loading="lazy"
                  />
                )}
                <span className="text-gray-900 dark:text-gray-100 truncate flex-1">{f.name}</span>
              </button>
            );
          })}
        </div>
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            className="px-3 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
            onClick={handleClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
