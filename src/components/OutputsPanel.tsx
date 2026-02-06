import { useEffect, useMemo, useState, useRef } from 'react';
import { useOutputsStore } from '@/hooks/useOutputs';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import type { FileItem } from '@/api/client';
import type { ViewerImage } from '@/utils/viewerImages';
import { getMediaType } from '@/utils/media';
import { deleteFile, moveFiles, createFolder, getUserImages } from '@/api/client';
import {
  FolderIcon, EllipsisVerticalIcon, CheckIcon,
  BookmarkIconSvg, BookmarkOutlineIcon, ChevronDownIcon, ChevronRightIcon,
  TrashIcon, WorkflowLoadIcon, ThickArrowRightIcon, VideoCameraIcon
} from '@/components/icons';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { FilterModal } from './OutputsPanel/FilterModal';
import { OutputsWorkflowConfirmModal } from '@/components/modals/OutputsWorkflowConfirmModal';
import { MediaViewer } from '@/components/ImageViewer/MediaViewer';
import { UseImageModal } from '@/components/modals/UseImageModal';
import { loadWorkflowFromFile, resolveFilePath } from '@/utils/workflowOperations';

const FOLDERS_COLLAPSED_KEY = 'outputs-folders-collapsed';
const DAY_MS = 24 * 60 * 60 * 1000;

function formatDateLabel(timestamp?: number): string {
  if (!timestamp) return 'Unknown date';
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(timestamp);
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((todayStart.getTime() - dateStart.getTime()) / DAY_MS);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function FileCard({
  file,
  viewMode,
  selectionMode,
  isSelected,
  isFavorited,
  onNavigateFolder,
  onOpen,
  onMenu,
  onToggleSelection
}: {
  file: FileItem;
  viewMode: 'grid' | 'list';
  selectionMode: boolean;
  isSelected: boolean;
  isFavorited: boolean;
  onNavigateFolder: (folder: string) => void;
  onOpen: (file: FileItem) => void;
  onMenu: (file: FileItem, e: React.MouseEvent) => void;
  onToggleSelection: (id: string) => void;
}) {
  const isFolder = file.type === 'folder';
  const [previewError, setPreviewError] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPreviewError(false);
  }, [file.previewUrl, file.id]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleClick = () => {
    if (selectionMode) {
      onToggleSelection(file.id);
    } else if (isFolder) {
      onNavigateFolder(file.name);
    } else {
      onOpen(file);
    }
  };

  const handleMenuButtonClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onMenu(file, event);
  };

  if (viewMode === 'list') {
    return (
      <div
        className={`file-card-list-item flex items-center gap-3 p-2 hover:bg-gray-50 border-b border-gray-100 last:border-0 ${isSelected ? 'bg-blue-50' : ''}`}
        onClick={handleClick}
      >
        {selectionMode && (
          <div className={`selection-checkbox w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 bg-white'}`}>
             {isSelected && <CheckIcon className="w-3.5 h-3.5" />}
          </div>
        )}
        <div className={`file-preview-container w-10 h-10 flex-shrink-0 flex items-center justify-center rounded text-gray-500 overflow-hidden relative ${isFolder ? '' : 'bg-gray-100'}`}>
           {isFolder ? (
             <FolderIcon className="w-6 h-6 text-amber-500" />
           ) : file.previewUrl && !previewError ? (
             <img
               src={file.previewUrl}
               className="w-full h-full object-cover"
               loading="lazy"
               onError={() => setPreviewError(true)}
             />
           ) : (
             file.type === 'video' ? (
               <VideoCameraIcon className="w-5 h-5 text-gray-500" />
             ) : (
               <span className="text-xs font-bold">IMG</span>
             )
           )}
        </div>
        <div className="file-info-container flex-1 min-w-0">
          <div className="file-name text-sm font-medium text-gray-900 truncate">{file.name}</div>
        </div>
        <div className="file-actions-container flex items-center gap-2">
          {isFavorited && (
            <BookmarkIconSvg className="w-4 h-4 text-yellow-500" />
          )}
          <button
            className="p-2 text-gray-400 hover:text-gray-700"
            onClick={handleMenuButtonClick}
          >
            <EllipsisVerticalIcon className="w-5 h-5 -rotate-90" />
          </button>
        </div>
      </div>
    );
  }

  // Grid
  return (
    <div className="file-card-grid-item flex flex-col gap-1">
      <div
        className={`relative aspect-square bg-gray-100 rounded-lg overflow-hidden transition-all ${isSelected ? 'ring-4 ring-blue-500 ring-offset-2' : ''}`}
        onClick={handleClick}
      >
        {isFolder ? (
          <div className="folder-grid-content w-full h-full flex flex-col items-center justify-center text-gray-500">
            <FolderIcon className="w-12 h-12 mb-2 text-amber-500" />
          </div>
        ) : file.previewUrl && !previewError ? (
          <img
            src={file.previewUrl}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setPreviewError(true)}
          />
        ) : (
          <div className="media-placeholder w-full h-full flex items-center justify-center bg-gray-800 text-white font-bold">
            {file.type === 'video' ? (
              <VideoCameraIcon className="w-10 h-10 text-white/80" />
            ) : (
              'IMG'
            )}
          </div>
        )}

        {selectionMode ? (
          <div className="selection-badge-container absolute top-2 left-2">
            <div className={`selection-badge w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-sm ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-white bg-black/20'}`}>
              {isSelected && <CheckIcon className="w-4 h-4" />}
            </div>
          </div>
        ) : (
          <div className="file-menu-trigger-container absolute top-1 right-1 flex flex-col items-center gap-1">
            <button
              className="p-1 bg-gray-500/40 rounded-full text-white hover:bg-gray-500/60"
              onClick={handleMenuButtonClick}
            >
              <EllipsisVerticalIcon className="w-4 h-4 -rotate-90" />
            </button>
            {isFavorited && (
              <BookmarkIconSvg className="w-4 h-4 text-yellow-400 drop-shadow" />
            )}
          </div>
        )}

        {file.type === 'video' && <div className="video-label absolute top-1 left-1 bg-black/50 px-1 rounded text-[10px] text-white">VID</div>}
      </div>
      <div className="file-name text-xs text-gray-700 truncate px-1">{file.name}</div>
    </div>
  );
}

export function OutputsPanel({ visible }: { visible: boolean }) {
  const {
    source, currentFolder, isLoading, viewMode, filter, sort, favorites,
    selectionMode, selectedIds,
    setCurrentFolder, navigateToPath, fetchFolders, fetchFiles,
    toggleFavorite, toggleSelection, getDisplayedFiles, refresh, selectIds, toggleSelectionMode,
    setFilter, setSort
  } = useOutputsStore();
  const selectionActionOpen = useOutputsStore((s) => s.selectionActionOpen);
  const setSelectionActionOpen = useOutputsStore((s) => s.setSelectionActionOpen);
  const filterModalOpen = useOutputsStore((s) => s.filterModalOpen);
  const setFilterModalOpen = useOutputsStore((s) => s.setFilterModalOpen);
  const newFolderModalOpen = useOutputsStore((s) => s.newFolderModalOpen);
  const setNewFolderModalOpen = useOutputsStore((s) => s.setNewFolderModalOpen);
  const setOutputsViewerOpen = useOutputsStore((s) => s.setOutputsViewerOpen);
  const addFavorites = useOutputsStore((s) => s.addFavorites);
  const removeFavorites = useOutputsStore((s) => s.removeFavorites);
  const clearSelection = useOutputsStore((s) => s.clearSelection);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const workflow = useWorkflowStore((s) => s.workflow);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);

  const isDirty = useMemo(
    () => Boolean(workflow && originalWorkflow && JSON.stringify(workflow) !== JSON.stringify(originalWorkflow)),
    [workflow, originalWorkflow]
  );

  const [menuTarget, setMenuTarget] = useState<{ file: FileItem, x: number, y: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [loadWorkflowTarget, setLoadWorkflowTarget] = useState<FileItem | null>(null);
  const [outputsWorkflowConfirmFile, setOutputsWorkflowConfirmFile] = useState<FileItem | null>(null);
  const [loadNodePickerOpen, setLoadNodePickerOpen] = useState(false);
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [movePath, setMovePath] = useState<string | null>(null);
  const [moveFolders, setMoveFolders] = useState<FileItem[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [moveItemIds, setMoveItemIds] = useState<string[]>([]);
  const [moveOriginPath, setMoveOriginPath] = useState<string | null>(null);
  const [createFolderName, setCreateFolderName] = useState('');
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImages, setViewerImages] = useState<ViewerImage[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasFetchedRef = useRef(false);
  const [foldersCollapsed, setFoldersCollapsed] = useState(() => {
    const saved = localStorage.getItem(FOLDERS_COLLAPSED_KEY);
    return saved === 'true';
  });
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const deleteOnCompleteRef = useRef<((file: FileItem) => void) | null>(null);
  const loadOnCompleteRef = useRef<(() => void) | null>(null);
  const loadWorkflowCloseViewerRef = useRef(false);

  const closeDeleteModal = () => {
    setDeleteTarget(null);
    deleteOnCompleteRef.current = null;
  };

  const closeLoadModal = () => {
    setLoadNodePickerOpen(false);
    setLoadWorkflowTarget(null);
    loadOnCompleteRef.current = null;
  };

  const openDeleteForFile = (file: FileItem, options?: { onDeleted?: (file: FileItem) => void }) => {
    deleteOnCompleteRef.current = options?.onDeleted ?? null;
    setDeleteTarget(file);
  };

  const openLoadInWorkflow = (file: FileItem, options?: { onLoaded?: () => void }) => {
    if (file.type !== 'image') return;
    loadOnCompleteRef.current = options?.onLoaded ?? null;
    setLoadWorkflowTarget(file);
    setLoadNodePickerOpen(true);
  };

  useDismissOnOutsideClick({
    open: !!menuTarget,
    onDismiss: () => setMenuTarget(null),
    triggerRef: { current: null },
    contentRef: menuRef
  });

  // Reset hasFetchedRef when source changes
  useEffect(() => {
    hasFetchedRef.current = false;
  }, [source]);

  // Fetch when panel becomes active
  useEffect(() => {
    if (visible && !hasFetchedRef.current && !isLoading) {
      hasFetchedRef.current = true;
      fetchFolders();
      fetchFiles();
    }
  }, [visible, fetchFolders, fetchFiles, isLoading]);

  useEffect(() => {
    if (!visible && viewerOpen) {
      setViewerOpen(false);
      setOutputsViewerOpen(false);
    }
  }, [visible, viewerOpen, setOutputsViewerOpen]);

  useEffect(() => {
    if (!visible && filterModalOpen) {
      setFilterModalOpen(false);
    }
  }, [visible, filterModalOpen, setFilterModalOpen]);

  const displayedFiles = getDisplayedFiles();
  const sortMode = useOutputsStore((s) => s.sort.mode);
  const openOutputsViewer = (file: FileItem) => {
    const displayed = getDisplayedFiles();
    const mediaFiles = displayed.filter((f) => (f.type === 'image' || f.type === 'video') && f.fullUrl);
    const media = mediaFiles.map((f) => ({
      src: f.fullUrl!,
      alt: f.name,
      mediaType: getMediaType(f.name),
      file: f,
      filename: f.name
    }));
    const index = mediaFiles.findIndex((f) => f.id === file.id);
    if (index >= 0) {
      setViewerImages(media);
      setViewerIndex(index);
      setViewerOpen(true);
      setOutputsViewerOpen(true);
    }
  };

  const handleOutputsViewerClose = () => {
    setViewerOpen(false);
    setOutputsViewerOpen(false);
  };

  const handleOutputsViewerDelete = (item: ViewerImage) => {
    if (!item.file) return;
    openDeleteForFile(item.file, {
      onDeleted: (deletedFile) => {
        setViewerImages((prev) => {
          const deletedIndex = prev.findIndex((entry) => entry.file?.id === deletedFile.id);
          const next = prev.filter((entry) => entry.file?.id !== deletedFile.id);
          setViewerIndex((prevIndex) => {
            if (next.length === 0) return 0;
            if (deletedIndex === -1) return prevIndex;
            if (deletedIndex < prevIndex) return prevIndex - 1;
            if (deletedIndex === prevIndex) return Math.min(prevIndex, next.length - 1);
            return prevIndex;
          });
          if (next.length === 0) {
            setViewerOpen(false);
            setOutputsViewerOpen(false);
          }
          return next;
        });
      }
    });
  };

  const handleOutputsViewerLoadInWorkflow = (item: ViewerImage) => {
    if (!item.file || item.file.type !== 'image') return;
    openLoadInWorkflow(item.file, {
      onLoaded: () => {
        setViewerOpen(false);
        setOutputsViewerOpen(false);
      }
    });
  };

  const handleOutputsViewerLoadWorkflow = (item: ViewerImage) => {
    if (!item.file) return;
    requestLoadWorkflowFromFile(item.file, { closeViewer: true });
  };

  // Separate folders from files
  const { folders, nonFolders } = useMemo(() => {
    const folders: FileItem[] = [];
    const nonFolders: FileItem[] = [];
    for (const file of displayedFiles) {
      if (file.type === 'folder') {
        folders.push(file);
      } else {
        nonFolders.push(file);
      }
    }
    return { folders, nonFolders };
  }, [displayedFiles]);

  const isNameSort = sortMode.startsWith('name');
  const isSizeSort = sortMode.startsWith('size');
  const shouldGroupByDate = filter.favoritesOnly || (!isNameSort && !isSizeSort);
  const fileSections = useMemo(() => {
    if (isNameSort) {
      const sections: Array<{ key: string; label: string; files: FileItem[] }> = [];
      for (const file of nonFolders) {
        const key = file.name?.trim()?.charAt(0).toUpperCase() || '#';
        const label = `Starting with ${key}`;
        const last = sections[sections.length - 1];
        if (last && last.key === key) {
          last.files.push(file);
        } else {
          sections.push({ key, label, files: [file] });
        }
      }
      return sections;
    }
    if (isSizeSort) {
      const sections: Array<{ key: string; label: string; files: FileItem[] }> = [];
      for (const file of nonFolders) {
        const sizeBytes = file.size ?? 0;
        const sizeMb = sizeBytes / (1024 * 1024);
        const roundedMb = sizeMb < 1 ? 0 : Math.round(sizeMb);
        const key = roundedMb === 0 ? '<1MB' : `${roundedMb}MB`;
        const label = roundedMb === 0 ? '<1MB' : `${roundedMb}MB`;
        const last = sections[sections.length - 1];
        if (last && last.key === key) {
          last.files.push(file);
        } else {
          sections.push({ key, label, files: [file] });
        }
      }
      return sections;
    }
    if (!shouldGroupByDate) {
      return [{
        key: 'all',
        label: 'All files',
        files: nonFolders
      }];
    }
    const sections: Array<{ key: string; label: string; files: FileItem[] }> = [];
    for (const file of nonFolders) {
      const key = file.date ? new Date(file.date).toISOString().slice(0, 10) : 'unknown';
      const label = formatDateLabel(file.date);
      const last = sections[sections.length - 1];
      if (last && last.key === key) {
        last.files.push(file);
      } else {
        sections.push({ key, label, files: [file] });
      }
    }
    return sections;
  }, [nonFolders, shouldGroupByDate, isNameSort, isSizeSort]);

  const toggleFoldersCollapsed = () => {
    const newValue = !foldersCollapsed;
    setFoldersCollapsed(newValue);
    localStorage.setItem(FOLDERS_COLLAPSED_KEY, String(newValue));
  };

  const toggleSectionCollapsed = (key: string) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleOpen = (file: FileItem) => {
      openOutputsViewer(file);
  };

  const handleMenu = (file: FileItem, e: React.MouseEvent) => {
      e.preventDefault();
      const x = Math.min(e.clientX, window.innerWidth - 200);
      const y = Math.min(e.clientY, window.innerHeight - 200);
      setMenuTarget({ file, x, y });
  };

  const handleFavorite = () => {
     if (!menuTarget) return;
     toggleFavorite(menuTarget.file.id);
     setMenuTarget(null);
  };

  const handleSelectSingle = () => {
    if (!menuTarget) return;
    if (!selectionMode) {
      toggleSelectionMode();
    }
    selectIds([menuTarget.file.id], 'replace');
    setMenuTarget(null);
  };

  const handleLoadInWorkflow = () => {
    if (!menuTarget) return;
    if (menuTarget.file.type !== 'image') return;
    setLoadWorkflowTarget(menuTarget.file);
    setLoadNodePickerOpen(true);
    setMenuTarget(null);
  };

  const handleDeleteRequest = () => {
    if (!menuTarget) return;
    setDeleteTarget(menuTarget.file);
    setMenuTarget(null);
  };

  const handleBulkDeleteRequest = () => {
    if (selectedIds.length === 0) return;
    setSelectionActionOpen(false);
    setDeleteSelectionOpen(true);
  };

  const loadWorkflowFromFileInternal = async (file: FileItem, options?: { closeViewer?: boolean }) => {
    try {
      await loadWorkflowFromFile({
        file,
        source,
        loadWorkflow,
        onLoaded: () => {
          setCurrentPanel('workflow');
          if (options?.closeViewer) {
            setViewerOpen(false);
            setOutputsViewerOpen(false);
          }
        },
      });
    } catch (err) {
      console.error('Failed to load workflow from file:', err);
      window.alert('Failed to load workflow from file.');
    }
  };

  const requestLoadWorkflowFromFile = (file: FileItem, options?: { closeViewer?: boolean }) => {
    if (file.type === 'folder') {
      window.alert('Workflow metadata is not available for folders.');
      return;
    }
    if (isDirty) {
      loadWorkflowCloseViewerRef.current = Boolean(options?.closeViewer);
      setOutputsWorkflowConfirmFile(file);
      return;
    }
    loadWorkflowFromFileInternal(file, options);
  };

  const handleLoadWorkflow = () => {
    if (!menuTarget) return;
    const file = menuTarget.file;
    setMenuTarget(null);
    requestLoadWorkflowFromFile(file, { closeViewer: false });
  };

  const handleOutputsWorkflowConfirm = async () => {
    if (!outputsWorkflowConfirmFile) return;
    const file = outputsWorkflowConfirmFile;
    const closeViewer = loadWorkflowCloseViewerRef.current;
    loadWorkflowCloseViewerRef.current = false;
    setOutputsWorkflowConfirmFile(null);
    await loadWorkflowFromFileInternal(file, { closeViewer });
  };

  const handleOutputsWorkflowCancel = () => {
    loadWorkflowCloseViewerRef.current = false;
    setOutputsWorkflowConfirmFile(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const deletedFile = deleteTarget;
    try {
      const filePath = resolveFilePath(deleteTarget, source);
      await deleteFile(filePath, source);
      refresh();
      deleteOnCompleteRef.current?.(deletedFile);
      deleteOnCompleteRef.current = null;
    } catch (err) {
      console.error('Failed to delete file:', err);
      window.alert('Failed to delete file.');
    } finally {
      setDeleteTarget(null);
    }
  };

  const confirmDeleteSelection = async () => {
    if (selectedIds.length === 0) {
      setDeleteSelectionOpen(false);
      return;
    }
    try {
      const prefix = `${source}/`;
      const paths = selectedIds.map((id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id));
      await Promise.all(paths.map((path) => deleteFile(path, source)));
      refresh();
      clearSelection();
    } catch (err) {
      console.error('Failed to delete selected files:', err);
      window.alert('Failed to delete selected files.');
    } finally {
      setDeleteSelectionOpen(false);
    }
  };

  const handleFavoriteSelection = () => {
    if (selectedIds.length === 0) return;
    const allFavorited = selectedIds.every((id) => favorites.includes(id));
    if (allFavorited) {
      removeFavorites(selectedIds);
    } else {
      addFavorites(selectedIds);
    }
    setSelectionActionOpen(false);
  };

  const handleMoveSelection = () => {
    if (selectedIds.length === 0) return;
    setSelectionActionOpen(false);
    setMoveItemIds([...selectedIds]);
    setMoveOriginPath(currentFolder);
    setMovePath(currentFolder);
    setMovePickerOpen(true);
  };

  const handleMoveSingle = () => {
    if (!menuTarget) return;
    setMoveItemIds([menuTarget.file.id]);
    setMoveOriginPath(currentFolder);
    setMovePath(currentFolder);
    setMovePickerOpen(true);
    setMenuTarget(null);
  };

  const closeMoveModal = () => {
    setMovePickerOpen(false);
    setMoveItemIds([]);
    setMoveOriginPath(null);
  };

  const submitMove = async () => {
    if (moveItemIds.length === 0) return;
    try {
      const prefix = `${source}/`;
      const paths = moveItemIds.map((id) => (id.startsWith(prefix) ? id.slice(prefix.length) : id));
      await moveFiles(paths, movePath, source);
      refresh();
      if (selectionMode) {
        clearSelection();
        toggleSelectionMode();
      }
    } catch (err) {
      console.error('Failed to move selected files:', err);
      window.alert('Failed to move selected files.');
    } finally {
      closeMoveModal();
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const path = movePath ? `${movePath}/${name}` : name;
    try {
      await createFolder(path, source);
      setNewFolderName('');
      setMoveLoading(true);
      const result = await getUserImages(source, 1000, 0, 'modified', false, movePath);
      setMoveFolders(result.filter((item) => item.type === 'folder'));
    } catch (err) {
      console.error('Failed to create folder:', err);
      window.alert('Failed to create folder.');
    } finally {
      setMoveLoading(false);
    }
  };

  const handleCreateNewFolder = async () => {
    const name = createFolderName.trim();
    if (!name) return;
    const path = currentFolder ? `${currentFolder}/${name}` : name;
    try {
      await createFolder(path, source);
      setCreateFolderName('');
      setNewFolderModalOpen(false);
      refresh();
    } catch (err) {
      console.error('Failed to create folder:', err);
      window.alert('Failed to create folder.');
    }
  };

  const breadcrumbs = useMemo(() => {
    const rootName = source === 'output' ? 'Outputs' : 'Inputs';
    const crumbs: Array<{ name: string; path: string | null }> = [{ name: rootName, path: null }];

    if (currentFolder) {
      const parts = currentFolder.split('/');
      parts.forEach((part, index) => {
        crumbs.push({
          name: part,
          path: parts.slice(0, index + 1).join('/')
        });
      });
    }
    return crumbs;
  }, [source, currentFolder]);

  const renderBreadcrumbs = () => {
    const total = breadcrumbs.length;
    // logic: Root always visible. Current (last) always visible.
    // If total > 3, show Root / ... / Parent / Current

    const displayCrumbs: Array<{ name: string; path: string | null; isEllipsis?: boolean; isClickable: boolean }> = [];

    if (total <= 3) {
      breadcrumbs.forEach((crumb, idx) => {
        displayCrumbs.push({
          ...crumb,
          isClickable: idx < total - 1
        });
      });
    } else {
      // Root
      displayCrumbs.push({ ...breadcrumbs[0], isClickable: true });
      // Ellipsis
      displayCrumbs.push({
        name: '...',
        path: breadcrumbs[total - 3].path, // Parent of the parent
        isEllipsis: true,
        isClickable: true
      });
      // Parent
      displayCrumbs.push({ ...breadcrumbs[total - 2], isClickable: true });
      // Current
      displayCrumbs.push({ ...breadcrumbs[total - 1], isClickable: false });
    }

    return (
      <div id="outputs-breadcrumb-trail" className="flex items-center text-sm overflow-hidden whitespace-nowrap">
        {displayCrumbs.map((crumb, idx) => (
          <div key={idx} className="flex items-center min-w-0">
            {idx > 0 && <span className="mx-1.5 text-gray-400 shrink-0">/</span>}
            <button
              onClick={() => crumb.isClickable && navigateToPath(crumb.path)}
              disabled={!crumb.isClickable}
              className={`
                truncate transition-colors
                ${crumb.isClickable ? 'text-blue-600 hover:text-blue-700 active:opacity-70' : 'text-gray-700 font-medium'}
                ${crumb.isEllipsis ? 'px-1 bg-gray-100 rounded' : ''}
              `}
              title={crumb.name}
            >
              {crumb.name}
            </button>
          </div>
        ))}
      </div>
    );
  };

  useEffect(() => {
    if (!movePickerOpen) return;
    let canceled = false;
    const loadFolders = async () => {
      setMoveLoading(true);
      try {
        const result = await getUserImages(source, 1000, 0, 'modified', false, movePath);
        if (canceled) return;
        setMoveFolders(result.filter((item) => item.type === 'folder'));
      } catch (err) {
        if (canceled) return;
        console.error('Failed to load folders:', err);
        setMoveFolders([]);
      } finally {
        if (!canceled) setMoveLoading(false);
      }
    };
    loadFolders();
    return () => {
      canceled = true;
    };
  }, [movePickerOpen, movePath, source]);

  useEffect(() => {
    if (selectionActionOpen && selectedIds.length === 0) {
      setSelectionActionOpen(false);
    }
  }, [selectionActionOpen, selectedIds.length, setSelectionActionOpen]);

  const handleSelectionClear = () => {
    const state = useOutputsStore.getState();
    state.clearSelection();
    state.toggleSelectionMode();
  };

  const handleMoveBack = () => {
    if (!movePath) return;
    const parts = movePath.split('/');
    parts.pop();
    setMovePath(parts.length ? parts.join('/') : null);
  };

  const handleMoveFolderClick = (folderName: string) => () => {
    setMovePath(movePath ? `${movePath}/${folderName}` : folderName);
  };

  return (
    <div
      id="outputs-panel-wrapper"
      className="absolute inset-x-0 top-[60px] bottom-0"
      style={{ display: visible ? 'block' : 'none' }}
    >
      <div id="outputs-panel-root" className="h-full bg-white flex flex-col pt-[4px] pb-[80px]">
       {/* Header with breadcrumb */}
       <div id="outputs-panel-header" className="px-4 py-3 flex flex-col gap-3 border-b border-gray-100">
          <div id="outputs-header-top-row" className="flex items-center justify-between min-h-[24px]">
            {renderBreadcrumbs()}

            {selectionMode && (
               <div className="selection-status-container flex items-center gap-2 shrink-0 ml-2">
                  <span className="text-[10px] font-bold text-blue-600 uppercase">{selectedIds.length} selected</span>
                  <button
                     onClick={handleSelectionClear}
                     className="text-[10px] text-gray-500 underline uppercase font-bold"
                  >
                     Clear
                  </button>
               </div>
            )}
          </div>
       </div>

       {/* Content */}
       <div id="outputs-content-container" className="flex-1 overflow-y-auto p-4">
          {/* Folders Section (always list view, collapsible) */}
          {folders.length > 0 && (
            <div id="outputs-folders-section" className="mb-4">
              <button
                onClick={toggleFoldersCollapsed}
                className="flex items-center gap-2 w-full text-left mb-2 py-1 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                {foldersCollapsed ? (
                  <ChevronRightIcon className="w-4 h-4" />
                ) : (
                  <ChevronDownIcon className="w-4 h-4" />
                )}
                <span>Folders ({folders.length})</span>
              </button>
              {!foldersCollapsed && (
                <div className="flex flex-col border border-gray-200 rounded-lg overflow-hidden">
                  {folders.map(file => (
                    <FileCard
                      key={file.id}
                      file={file}
                      viewMode="list"
                      selectionMode={selectionMode}
                      isSelected={selectedIds.includes(file.id)}
                      isFavorited={favorites.includes(file.id)}
                      onNavigateFolder={setCurrentFolder}
                      onOpen={handleOpen}
                      onMenu={handleMenu}
                      onToggleSelection={toggleSelection}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Files Grid/List */}
          <div id="outputs-files-section" className="flex flex-col gap-4">
            {fileSections.map((section) => (
              <div key={section.key} className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <button
                    className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800"
                    onClick={() => toggleSectionCollapsed(section.key)}
                  >
                    {collapsedSections[section.key] ? (
                      <ChevronRightIcon className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDownIcon className="w-3.5 h-3.5" />
                    )}
                    <span>{section.label} ({section.files.length})</span>
                  </button>
                  {selectionMode && (
                    <button
                      className="text-[10px] font-bold uppercase text-blue-600 hover:text-blue-700"
                      onClick={() => selectIds(section.files.map((file) => file.id))}
                    >
                      Select all
                    </button>
                  )}
                </div>
                {!collapsedSections[section.key] && (
                  viewMode === 'grid' ? (
                    <div className="grid grid-cols-2 gap-4 auto-rows-min">
                      {section.files.map((file) => (
                        <FileCard
                          key={file.id}
                          file={file}
                          viewMode={viewMode}
                          selectionMode={selectionMode}
                          isSelected={selectedIds.includes(file.id)}
                          isFavorited={favorites.includes(file.id)}
                          onNavigateFolder={setCurrentFolder}
                          onOpen={handleOpen}
                          onMenu={handleMenu}
                          onToggleSelection={toggleSelection}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {section.files.map((file) => (
                        <FileCard
                          key={file.id}
                          file={file}
                          viewMode={viewMode}
                          selectionMode={selectionMode}
                          isSelected={selectedIds.includes(file.id)}
                          isFavorited={favorites.includes(file.id)}
                          onNavigateFolder={setCurrentFolder}
                          onOpen={handleOpen}
                          onMenu={handleMenu}
                          onToggleSelection={toggleSelection}
                        />
                      ))}
                    </div>
                  )
                )}
              </div>
            ))}
          </div>

          {/* Loading Indicator */}
          {isLoading && (
            <div id="outputs-loading-indicator" className="py-4 flex justify-center">
              <span className="text-gray-400 text-sm">Loading...</span>
            </div>
          )}

          {!isLoading && displayedFiles.length === 0 && (
             <div id="outputs-empty-message" className="text-center text-gray-400 py-8">
               {currentFolder
                 ? 'No images in this folder'
                 : source === 'output'
                   ? 'No generated images yet'
                   : 'No imported images'}
             </div>
          )}
       </div>

       {/* Context Menu */}
       {menuTarget && (
         <>
           <div
             id="outputs-context-menu-overlay"
             className="fixed inset-0 z-[1690]"
             onClick={() => setMenuTarget(null)}
             onPointerDown={(event) => event.stopPropagation()}
           />
           <div
             id="outputs-context-menu"
             ref={menuRef}
             className="fixed z-[1700] bg-white shadow-xl rounded-lg border border-gray-200 w-52 py-1"
             style={{ top: menuTarget.y, left: menuTarget.x }}
             onPointerDown={(event) => event.stopPropagation()}
             onClick={(event) => event.stopPropagation()}
           >
              <button
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                onClick={handleFavorite}
              >
                {favorites.includes(menuTarget.file.id) ? <BookmarkIconSvg className="w-4 h-4" /> : <BookmarkOutlineIcon className="w-4 h-4" />}
                {favorites.includes(menuTarget.file.id) ? 'Unfavorite' : 'Favorite'}
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                onClick={handleSelectSingle}
              >
                <CheckIcon className="w-4 h-4 text-gray-500" />
                Select
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                onClick={handleMoveSingle}
              >
                <FolderIcon className="w-4 h-4 text-gray-500" />
                Move
              </button>
              {menuTarget.file.type === 'image' && (
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                  onClick={handleLoadWorkflow}
                >
                  <WorkflowLoadIcon className="w-4 h-4 text-gray-500" />
                  Load workflow
                </button>
              )}
              {menuTarget.file.type === 'image' && (
                <button
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                  onClick={handleLoadInWorkflow}
                >
                  <ThickArrowRightIcon className="w-4 h-4 text-gray-500" />
                  Use in workflow
                </button>
              )}
              <button
                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                onClick={handleDeleteRequest}
              >
                <TrashIcon className="w-4 h-4" />
                Delete
              </button>
           </div>
         </>
       )}
       {selectionActionOpen && (
         <div
           id="outputs-selection-actions"
           className="fixed inset-0 z-[1800] bg-black/40 flex items-center justify-center p-4"
           onClick={() => setSelectionActionOpen(false)}
           role="dialog"
           aria-modal="true"
         >
           <div
             className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
             onClick={(event) => event.stopPropagation()}
           >
             <div className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
               {selectedIds.length} selected
             </div>
             <button
               className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2"
               onClick={handleFavoriteSelection}
             >
               {selectedIds.every((id) => favorites.includes(id))
                 ? <BookmarkOutlineIcon className="w-4 h-4" />
                 : <BookmarkIconSvg className="w-4 h-4" />}
               {selectedIds.every((id) => favorites.includes(id)) ? 'Unfavorite' : 'Favorite'}
             </button>
             <button
               className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2"
               onClick={handleMoveSelection}
             >
               <FolderIcon className="w-4 h-4 text-gray-500" />
               Move
             </button>
             <button
               className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
               onClick={handleBulkDeleteRequest}
             >
               <TrashIcon className="w-4 h-4" />
               Delete
             </button>
             <button
               className="w-full text-left px-4 py-3 text-sm text-gray-600 hover:bg-gray-50"
               onClick={() => setSelectionActionOpen(false)}
             >
               Cancel
             </button>
           </div>
         </div>
       )}
       {movePickerOpen && (
         <div
           id="outputs-move-picker-overlay"
           className="fixed inset-0 z-[1850] bg-black/50 flex items-center justify-center p-4"
           onClick={closeMoveModal}
           role="dialog"
           aria-modal="true"
         >
           <div
             id="outputs-move-picker"
             className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden"
             onClick={(event) => event.stopPropagation()}
           >
             <div className="px-4 py-3 text-sm font-semibold text-gray-700 border-b border-gray-100">
               {movePath !== moveOriginPath
                 ? <>Move to <FolderIcon className="w-4 h-4 text-amber-500 inline" /> {movePath || 'root'}</>
                 : 'Move to...'}
             </div>
             <div className="max-h-[50vh] overflow-y-auto">
               {moveLoading && (
                 <div className="px-4 py-3 text-sm text-gray-400">Loading folders...</div>
               )}
               {!moveLoading && movePath && (
                 <button
                   className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2"
                   onClick={handleMoveBack}
                 >
                   <span className="text-gray-500">..</span>
                 </button>
               )}
               {!moveLoading && moveFolders.filter((f) => !moveItemIds.includes(f.id)).length === 0 && (
                 <div className="px-4 py-3 text-sm text-gray-400">No folders</div>
               )}
               {!moveLoading && moveFolders.filter((f) => !moveItemIds.includes(f.id)).map((folder) => (
                 <button
                   key={folder.id}
                   className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 flex items-center gap-2"
                   onClick={handleMoveFolderClick(folder.name)}
                 >
                   <FolderIcon className="w-4 h-4 text-amber-500" />
                   {folder.name}
                 </button>
               ))}
               <div className="px-4 py-3 border-t border-gray-100">
                 <div className="flex items-center gap-2">
                   <input
                     value={newFolderName}
                     onChange={(event) => setNewFolderName(event.target.value)}
                     placeholder="New folder"
                     className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                   />
                   <button
                     className="px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                     onClick={handleCreateFolder}
                   >
                     Create
                   </button>
                 </div>
               </div>
             </div>
             <div className="px-4 py-3 border-t border-gray-100 flex justify-end gap-2">
               <button
                 className="px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                 onClick={closeMoveModal}
               >
                 Cancel
               </button>
               <button
                 className={`px-3 py-2 text-sm font-medium rounded-lg ${movePath !== moveOriginPath ? 'text-white bg-blue-600 hover:bg-blue-700' : 'text-gray-400 bg-gray-200 cursor-not-allowed'}`}
                 onClick={submitMove}
                 disabled={movePath === moveOriginPath}
               >
                 Submit
               </button>
             </div>
           </div>
         </div>
       )}
       {deleteTarget && (
        <div
          id="outputs-delete-confirm-overlay"
          className="fixed inset-0 z-[2100] bg-black/50 flex items-center justify-center p-4"
          onClick={closeDeleteModal}
          role="dialog"
          aria-modal="true"
        >
          <div
            id="outputs-delete-confirm-modal"
            className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div id="outputs-delete-confirm-title" className="text-gray-900 text-base font-semibold">Delete file?</div>
            <div id="outputs-delete-confirm-description" className="text-gray-600 text-sm mt-1">
              {deleteTarget.type === 'folder'
                ? `This will permanently delete the folder "${deleteTarget.name}" and all of its contents from the server. This cannot be undone.`
                : `This will permanently delete "${deleteTarget.name}" from the server. This cannot be undone.`}
            </div>
            <div id="outputs-delete-confirm-actions" className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
                onClick={closeDeleteModal}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700"
                onClick={confirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
       )}
       {deleteSelectionOpen && (
        <div
          id="outputs-delete-selection-overlay"
          className="fixed inset-0 z-[1800] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setDeleteSelectionOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            id="outputs-delete-selection-modal"
            className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-gray-900 text-base font-semibold">Delete selected files?</div>
            <div className="text-gray-600 text-sm mt-1">
              This will permanently delete {selectedIds.length} selected file{selectedIds.length === 1 ? '' : 's'} from the server. This cannot be undone.
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
                onClick={() => setDeleteSelectionOpen(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700"
                onClick={confirmDeleteSelection}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
       )}
       {newFolderModalOpen && (
        <div
          id="outputs-new-folder-overlay"
          className="fixed inset-0 z-[1850] bg-black/50 flex items-center justify-center p-4"
          onClick={() => { setNewFolderModalOpen(false); setCreateFolderName(''); }}
          role="dialog"
          aria-modal="true"
        >
          <div
            id="outputs-new-folder-modal"
            className="w-full max-w-sm bg-white border border-gray-200 rounded-xl shadow-lg p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-gray-900 text-base font-semibold">New folder</div>
            <div className="text-gray-600 text-sm mt-1">
              Create a new folder in {currentFolder ? <><FolderIcon className="w-3.5 h-3.5 text-amber-500 inline" /> {currentFolder}</> : 'root'}
            </div>
            <input
              value={createFolderName}
              onChange={(event) => setCreateFolderName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') handleCreateNewFolder(); }}
              placeholder="Folder name"
              className="mt-3 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100"
                onClick={() => { setNewFolderModalOpen(false); setCreateFolderName(''); }}
              >
                Cancel
              </button>
              <button
                className={`px-3 py-2 rounded-lg text-sm font-medium ${createFolderName.trim() ? 'text-white bg-blue-600 hover:bg-blue-700' : 'text-gray-400 bg-gray-200 cursor-not-allowed'}`}
                onClick={handleCreateNewFolder}
                disabled={!createFolderName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
       )}
       <UseImageModal
         open={loadNodePickerOpen}
         file={loadWorkflowTarget}
         source={source}
         onClose={closeLoadModal}
         onLoaded={() => {
           setLoadNodePickerOpen(false);
           setLoadWorkflowTarget(null);
           loadOnCompleteRef.current?.();
           loadOnCompleteRef.current = null;
         }}
       />
       <FilterModal
         open={filterModalOpen}
         onClose={() => setFilterModalOpen(false)}
         filter={filter}
         sort={sort}
         onChangeFilter={setFilter}
         onChangeSort={setSort}
       />
       <OutputsWorkflowConfirmModal
         file={outputsWorkflowConfirmFile}
         onCancel={handleOutputsWorkflowCancel}
         onConfirm={handleOutputsWorkflowConfirm}
       />
       <MediaViewer
         open={viewerOpen}
         items={viewerImages}
         index={viewerIndex}
         onClose={handleOutputsViewerClose}
         onIndexChange={setViewerIndex}
         onDelete={handleOutputsViewerDelete}
         onLoadInWorkflow={handleOutputsViewerLoadInWorkflow}
         onLoadWorkflow={handleOutputsViewerLoadWorkflow}
         showMetadataToggle
        />
      </div>
    </div>
  );
}
