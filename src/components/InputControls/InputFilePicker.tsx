import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetSource, FileItem, SortMode } from "@/api/client";
import { getUserImages, searchUserImagesByPrompt, uploadImageFile } from "@/api/client";
import { resolveInputPathForFile } from "@/utils/filesystem";
import { SearchBar } from "@/components/SearchBar";
import { ContextMenuButton } from "@/components/buttons/ContextMenuButton";
import { ContextMenuBuilder } from "@/components/menus/ContextMenuBuilder";
import { FullscreenWidgetModal } from "@/components/modals/FullscreenWidgetModal";
import { OutputsFilesSection } from "@/components/OutputsPanel/FilesSection";
import { OutputsFoldersSection } from "@/components/OutputsPanel/FoldersSection";
import { useOutputsStore } from "@/hooks/useOutputs";
import { useWorkflowErrorsStore } from "@/hooks/useWorkflowErrors";
import { useDismissOnOutsideClick } from "@/hooks/useDismissOnOutsideClick";
import {
  CheckIcon,
  DiceIcon,
  DocumentLinesIcon,
  EyeIcon,
  EyeOffIcon,
  HeartIcon,
} from "@/components/icons";
import {
  getInputPickerValue,
  projectInputSearchResults,
  sortInputPickerFiles,
} from "./inputPickerUtils";
import { isOutputFileSelectable } from "./outputPickerUtils";

interface InputFilePickerProps {
  open: boolean;
  onClose: () => void;
  // `source` reports which folder the value came from: "input" for a direct
  // pick, "output" for a file that was copied into the input folder first.
  onPick: (value: string, source: AssetSource) => void;
  // Which tab the picker opens on. Defaults to inputs.
  defaultSource?: AssetSource;
  // Folder that output picks are copied into so a LoadImage-style node (which
  // can only read from `input/`) can reference them.
  uploadFolder?: string;
  // When true the picker browses/selects videos instead of images.
  supportsVideoUpload?: boolean;
}

const noop = () => undefined;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDateLabel(timestamp?: number): string {
  if (!timestamp) return "Unknown date";
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(timestamp);
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / DAY_MS);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function nextSortMode(current: SortMode, field: "name" | "modified" | "size"): SortMode {
  if (current === field) return `${field}-reverse` as SortMode;
  return field;
}

function sortDirection(mode: SortMode, field: "name" | "modified" | "size"): string | undefined {
  if (!mode.startsWith(field)) return undefined;
  return mode.endsWith("-reverse") ? "↑" : "↓";
}

export function InputFilePicker({
  open,
  onClose,
  onPick,
  defaultSource = "input",
  uploadFolder = "input",
  supportsVideoUpload = false,
}: InputFilePickerProps) {
  const favorites = useOutputsStore((state) => state.favorites);
  const toggleFavorite = useOutputsStore((state) => state.toggleFavorite);
  const setError = useWorkflowErrorsStore((state) => state.setError);
  const [source, setSource] = useState<AssetSource>(defaultSource);
  const [folder, setFolder] = useState<string | null>(null);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [searchResults, setSearchResults] = useState<FileItem[] | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [showHidden, setShowHidden] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("modified");
  const [isLoading, setIsLoading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const isOutput = source === "output";
  const noun = supportsVideoUpload ? "video" : "image";

  useDismissOnOutsideClick({
    open: menuOpen,
    onDismiss: () => setMenuOpen(false),
    triggerRef: menuButtonRef,
    contentRef: menuRef,
  });

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    const timer = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const query = search.trim();
        if (query) {
          const result = await searchUserImagesByPrompt(source, query, null, showHidden);
          if (!canceled) setSearchResults(result);
        } else if (favoritesOnly) {
          // Favorites can live anywhere in the tree, so pull the whole source
          // recursively and let the favorites filter below flatten it — a
          // folder-scoped listing would hide favorites in nested folders.
          const result = await getUserImages(source, 1000, 0, sortMode, true, null, showHidden);
          if (!canceled) {
            setFiles(result);
            setSearchResults(null);
          }
        } else {
          const result = await getUserImages(source, 1000, 0, sortMode, false, folder, showHidden);
          if (!canceled) {
            setFiles(result);
            setSearchResults(null);
          }
        }
      } catch (error) {
        if (!canceled) {
          console.error(`Failed to browse ${source} files:`, error);
          setFiles([]);
          setSearchResults(null);
          // Without this, a failed listing is indistinguishable from an
          // empty folder (the copy path below already surfaces errors).
          setError(`Failed to load ${source} files — check the connection and try again`);
        }
      } finally {
        if (!canceled) setIsLoading(false);
      }
    }, search.trim() ? 200 : 0);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [favoritesOnly, folder, open, search, setError, showHidden, sortMode, source]);

  useEffect(() => {
    if (open) return;
    setSource(defaultSource);
    setFolder(null);
    setSearch("");
    setSearchResults(null);
    setMenuOpen(false);
    setIsCopying(false);
  }, [open, defaultSource]);

  // Switching tabs resets the folder/search context, which belongs to the
  // previous source.
  const switchSource = (next: AssetSource) => {
    if (next === source) return;
    setSource(next);
    setFolder(null);
    setSearch("");
    setSearchResults(null);
  };

  const pickFile = async (file: FileItem) => {
    if (!isOutput) {
      onPick(getInputPickerValue(file, source), source);
      return;
    }
    // Output files live outside the input folder a LoadImage node reads from, so
    // copy the selection in first and hand back the resulting input path.
    if (!isOutputFileSelectable(file.type, supportsVideoUpload)) return;
    setIsCopying(true);
    try {
      let value: string;
      if (uploadFolder === "input") {
        // Fast path: the backend copies the output file straight into the input
        // folder (shutil.copy2). The browser never downloads or re-uploads the
        // image bytes, so this is near-instant even for large files.
        value = await resolveInputPathForFile(file, source);
      } else {
        // The copy-to-input endpoint only targets the input directory, so for a
        // node that reads from a different folder we fall back to the slower
        // download + re-upload round-trip.
        const url = file.fullUrl;
        if (!url) throw new Error("No URL for output file");
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const blob = await response.blob();
        const uploadFile = new File([blob], file.name, {
          type: blob.type || "application/octet-stream",
        });
        const result = await uploadImageFile(uploadFile, { type: uploadFolder, overwrite: true });
        value = result.subfolder ? `${result.subfolder}/${result.name}` : result.name;
      }
      // Carry the favorite over to the copied input so it stays flagged in the
      // input tab (where it otherwise couldn't be favorited).
      const copiedId = `${uploadFolder}/${value}`;
      if (favorites.includes(file.id) && !favorites.includes(copiedId)) {
        toggleFavorite(copiedId);
      }
      onPick(value, "output");
    } catch (err) {
      console.error("Failed to copy output file:", err);
      setError(`Failed to copy "${file.name}" to inputs`);
    } finally {
      setIsCopying(false);
    }
  };

  const displayedFiles = useMemo(() => {
    let result = searchResults ? projectInputSearchResults(searchResults, folder, source) : [...files];
    if (favoritesOnly) {
      result = result.filter((file) => favorites.includes(file.id));
    }
    const pickableType = supportsVideoUpload ? "video" : "image";
    result = result.filter((file) => file.type === "folder" || file.type === pickableType);
    return sortInputPickerFiles(result, sortMode);
  }, [favorites, favoritesOnly, files, folder, searchResults, sortMode, source, supportsVideoUpload]);

  const { folders, nonFolders } = useMemo(() => ({
    folders: displayedFiles.filter((file) => file.type === "folder"),
    nonFolders: displayedFiles.filter((file) => file.type !== "folder"),
  }), [displayedFiles]);

  const fileSections = useMemo(() => {
    const sections: Array<{ key: string; label: string; files: FileItem[] }> = [];
    for (const file of nonFolders) {
      let key: string;
      let label: string;
      if (sortMode.startsWith("name")) {
        key = file.name.trim().charAt(0).toUpperCase() || "#";
        label = `Starting with ${key}`;
      } else if (sortMode.startsWith("size")) {
        const roundedMb = (file.size ?? 0) < 1024 * 1024 ? 0 : Math.round((file.size ?? 0) / (1024 * 1024));
        key = roundedMb === 0 ? "<1MB" : `${roundedMb}MB`;
        label = key;
      } else {
        key = file.date ? new Date(file.date).toISOString().slice(0, 10) : "unknown";
        label = formatDateLabel(file.date);
      }
      const last = sections[sections.length - 1];
      if (last?.key === key) last.files.push(file);
      else sections.push({ key, label, files: [file] });
    }
    return sections;
  }, [nonFolders, sortMode]);

  const navigateToFolder = (name: string) => {
    setFolder((current) => current ? `${current}/${name}` : name);
  };

  const crumbs = useMemo(() => {
    const result: Array<{ name: string; path: string | null }> = [
      { name: isOutput ? "Outputs" : "Inputs", path: null },
    ];
    if (folder) {
      const parts = folder.split("/");
      parts.forEach((name, index) => result.push({
        name,
        path: parts.slice(0, index + 1).join("/"),
      }));
    }
    return result;
  }, [folder, isOutput]);

  const closeMenu = () => setMenuOpen(false);
  return (
    <FullscreenWidgetModal isOpen={open} title={`Select ${noun}`} onClose={onClose} background="opaque">
        <div className="relative flex min-h-full flex-col gap-3" data-swipe-nav-ignore="true">
          {isCopying && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/70">
              <span className="text-sm text-slate-300">Copying file...</span>
            </div>
          )}
          <div className="input-picker-toolbar sticky top-0 z-30 -mx-1 flex items-center gap-2 bg-slate-950/95 px-1 py-2">
            <SearchBar
              value={search}
              onChange={setSearch}
              onClear={() => setSearch("")}
              placeholder={isOutput ? "Search outputs..." : "Search inputs..."}
              className="min-w-0 flex-1"
              autoFocus
            />
            <div className="relative shrink-0">
              <ContextMenuButton
                buttonRef={menuButtonRef}
                onClick={() => setMenuOpen((current) => !current)}
                ariaLabel="Input picker options"
                className="border border-white/10 bg-slate-900/95 text-slate-200 hover:bg-slate-800"
              />
              {menuOpen && (
                <div ref={menuRef} className="input-picker-menu absolute right-0 top-12 z-40 w-52">
                  <ContextMenuBuilder
                    items={[
                      {
                        key: "favorites",
                        label: "Favorites Only",
                        icon: <HeartIcon className="h-4 w-4" />,
                        rightSlot: favoritesOnly ? <CheckIcon className="h-4 w-4 text-cyan-300" /> : null,
                        onClick: () => {
                          const next = !favoritesOnly;
                          setFavoritesOnly(next);
                          // Favorites is a flat whole-tree view, so drop any
                          // folder/search scope when entering it.
                          if (next) {
                            setFolder(null);
                            setSearch("");
                            setSearchResults(null);
                          }
                        },
                      },
                      { type: "divider", key: "filter-sort-divider" },
                      {
                        key: "sort-name",
                        label: "Sort by Name",
                        rightSlot: sortDirection(sortMode, "name"),
                        onClick: () => setSortMode((current) => nextSortMode(current, "name")),
                      },
                      {
                        key: "sort-date",
                        label: "Sort by Date",
                        rightSlot: sortDirection(sortMode, "modified"),
                        onClick: () => setSortMode((current) => nextSortMode(current, "modified")),
                      },
                      {
                        key: "sort-size",
                        label: "Sort by Size",
                        rightSlot: sortDirection(sortMode, "size"),
                        onClick: () => setSortMode((current) => nextSortMode(current, "size")),
                      },
                      { type: "divider", key: "view-divider" },
                      {
                        key: "show-hidden",
                        label: showHidden ? "Hide Hidden Files" : "Show Hidden Files",
                        icon: showHidden
                          ? <EyeOffIcon className="h-4 w-4" />
                          : <EyeIcon className="h-4 w-4" />,
                        onClick: () => {
                          setShowHidden((current) => !current);
                          closeMenu();
                        },
                      },
                      {
                        key: "view-mode",
                        label: viewMode === "grid" ? "List View" : "Grid View",
                        icon: viewMode === "grid"
                          ? <DocumentLinesIcon className="h-4 w-4" />
                          : <DiceIcon className="h-4 w-4" />,
                        onClick: () => {
                          setViewMode((current) => current === "grid" ? "list" : "grid");
                          closeMenu();
                        },
                      },
                    ]}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="input-picker-source-toggle flex shrink-0 rounded-lg border border-white/10 bg-slate-900/95 p-1 text-sm">
            {(["input", "output"] as const).map((option) => {
              const active = source === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => switchSource(option)}
                  className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
                    active
                      ? "bg-cyan-500/20 text-cyan-200"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  aria-pressed={active}
                >
                  {option === "input" ? "Inputs" : "Outputs"}
                </button>
              );
            })}
          </div>

          <div className="flex items-center overflow-hidden whitespace-nowrap rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-sm">
            {crumbs.map((crumb, index) => {
              const clickable = index < crumbs.length - 1;
              return (
                <div key={crumb.path ?? "root"} className="flex min-w-0 items-center">
                  {index > 0 && <span className="mx-1.5 shrink-0 text-slate-500">/</span>}
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => setFolder(crumb.path)}
                    className={`truncate ${clickable ? "text-cyan-300 hover:text-cyan-200" : "font-medium text-slate-100"}`}
                  >
                    {crumb.name}
                  </button>
                </div>
              );
            })}
          </div>

          {search.trim() && (
            <div className="text-xs text-slate-400">
              {searchResults?.length ?? 0} total {(searchResults?.length ?? 0) === 1 ? "match" : "matches"}
            </div>
          )}

          <OutputsFoldersSection
            folders={folders}
            foldersCollapsed={foldersCollapsed}
            toggleFoldersCollapsed={() => setFoldersCollapsed((current) => !current)}
            selectionMode={false}
            selectedIds={[]}
            favorites={favorites}
            setCurrentFolder={navigateToFolder}
            handleOpen={() => {}}
            handleMenu={noop}
            toggleSelection={noop}
            showContextMenus={false}
          />

          <OutputsFilesSection
            fileSections={fileSections}
            collapsedSections={collapsedSections}
            viewMode={viewMode}
            selectionMode={false}
            selectedIds={[]}
            favorites={favorites}
            setCurrentFolder={navigateToFolder}
            handleOpen={(file) => void pickFile(file)}
            handleMenu={noop}
            toggleSelection={noop}
            toggleSectionCollapsed={(key) => setCollapsedSections((current) => ({
              ...current,
              [key]: !current[key],
            }))}
            selectIds={noop}
            showContextMenus={false}
          />

          {isLoading && <div className="py-8 text-center text-sm text-slate-400">Loading...</div>}
          {!isLoading && displayedFiles.length === 0 && (
            <div className="py-8 text-center text-sm text-slate-400">
              No matching {isOutput ? "output" : "input"} {noun}s
            </div>
          )}
        </div>
    </FullscreenWidgetModal>
  );
}
