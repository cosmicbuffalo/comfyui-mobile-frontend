import { memo, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOutputsStore, MAX_OUTPUTS_TABS, type OutputsTab, type FilterState, type SortState } from '@/hooks/useOutputs';
import { isWorkflowModified, MAX_WORKFLOW_SESSIONS, useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useHistoryWorkflowByFileId } from '@/hooks/useHistoryWorkflowByFileId';
import { getVisualViewportFrame, useVisualViewportFrame } from '@/hooks/useVisualViewportFrame';
import type { FileItem } from '@/api/client';
import {
  buildBreadcrumbs,
  buildFileSections,
  collapseBreadcrumbs,
  isCrumbHidden,
} from '@/utils/outputsBrowser';
import type { ViewerImage } from '@/utils/viewerImages';
import { getMediaType } from '@/utils/media';
import { deleteFile, moveFiles, createFolder, getUserImages, getRecursiveFolders, renameFile, getScreenPreviewUrl } from '@/api/client';
import {
  FolderIcon, BookmarkIconSvg, BookmarkOutlineIcon, DownloadDeviceIcon, EyeIcon, EyeOffIcon, TrashIcon,
  PlusIcon, MinusIcon, CornerDownRightIcon, FunnelArrowsIcon
} from '@/components/icons';
import { shareOrDownloadFile, shareOrDownloadBatch } from '@/utils/downloads';
import { useDismissOnOutsideClick } from '@/hooks/useDismissOnOutsideClick';
import { useAnchoredMenuPosition } from '@/hooks/useAnchoredMenuPosition';
import { FilterModal } from './OutputsPanel/FilterModal';
import { resolveSelectionDownloadTargets } from './OutputsPanel/selectionDownload';
import { SearchBar } from '@/components/SearchBar';
import { MediaViewer } from '@/components/ImageViewer/MediaViewer';
import { UseImageModal } from '@/components/modals/UseImageModal';
import { ModalFrame } from '@/components/modals/ModalFrame';
import { Dialog } from '@/components/modals/Dialog';
import {
  loadWorkflowFromFile,
  resolveFilePath,
  resolveViewerItemWorkflowLoad,
} from '@/utils/workflowOperations';
import { getSelectionRangeIds } from '@/utils/selectionRange';
import { getStickySectionScrollTarget } from '@/utils/stickySection';
import { OutputsFoldersSection } from './OutputsPanel/FoldersSection';
import { OutputsFilesSection } from './OutputsPanel/FilesSection';
import { OutputsContextMenu } from './OutputsPanel/ContextMenu';

const FOLDERS_COLLAPSED_KEY = 'outputs-folders-collapsed';
const STICKY_SECTION_TOP = -16;
// How many output cards to render initially / add per scroll-growth step, so a
// folder with thousands of files doesn't mount every card up front.
const OUTPUTS_RENDER_PAGE = 60;

export const OutputsPanel = memo(function OutputsPanel({ visible }: { visible: boolean }) {
  // Fine-grained selectors: a bare useOutputsStore() destructure would
  // re-render this whole panel on every store write, even while hidden.
  const source = useOutputsStore((s) => s.source);
  const currentFolder = useOutputsStore((s) => s.currentFolder);
  const isLoading = useOutputsStore((s) => s.isLoading);
  const error = useOutputsStore((s) => s.error);
  const viewMode = useOutputsStore((s) => s.viewMode);
  const showHidden = useOutputsStore((s) => s.showHidden);
  const filter = useOutputsStore((s) => s.filter);
  const sort = useOutputsStore((s) => s.sort);
  const favorites = useOutputsStore((s) => s.favorites);
  const selectionMode = useOutputsStore((s) => s.selectionMode);
  const selectedIds = useOutputsStore((s) => s.selectedIds);
  const hiddenFolderPaths = useOutputsStore((s) => s.hiddenFolderPaths);
  const tabs = useOutputsStore((s) => s.tabs);
  const activeTabId = useOutputsStore((s) => s.activeTabId);
  const addTab = useOutputsStore((s) => s.addTab);
  const closeTab = useOutputsStore((s) => s.closeTab);
  const switchToTab = useOutputsStore((s) => s.switchToTab);
  const setCurrentFolder = useOutputsStore((s) => s.setCurrentFolder);
  const navigateToPath = useOutputsStore((s) => s.navigateToPath);
  const fetchFolders = useOutputsStore((s) => s.fetchFolders);
  const fetchFiles = useOutputsStore((s) => s.fetchFiles);
  const toggleFavorite = useOutputsStore((s) => s.toggleFavorite);
  const toggleSelection = useOutputsStore((s) => s.toggleSelection);
  const getDisplayedFiles = useOutputsStore((s) => s.getDisplayedFiles);
  const refresh = useOutputsStore((s) => s.refresh);
  const selectIds = useOutputsStore((s) => s.selectIds);
  const deselectIds = useOutputsStore((s) => s.deselectIds);
  const toggleSelectionMode = useOutputsStore((s) => s.toggleSelectionMode);
  const setFilter = useOutputsStore((s) => s.setFilter);
  const setSort = useOutputsStore((s) => s.setSort);
  const setItemHidden = useOutputsStore((s) => s.setItemHidden);
  const setItemsHidden = useOutputsStore((s) => s.setItemsHidden);
  const selectionActionOpen = useOutputsStore((s) => s.selectionActionOpen);
  const setSelectionActionOpen = useOutputsStore((s) => s.setSelectionActionOpen);
  const filterModalOpen = useOutputsStore((s) => s.filterModalOpen);
  const setFilterModalOpen = useOutputsStore((s) => s.setFilterModalOpen);
  const newFolderModalOpen = useOutputsStore((s) => s.newFolderModalOpen);
  const setNewFolderModalOpen = useOutputsStore((s) => s.setNewFolderModalOpen);
  const setOutputsViewerOpen = useOutputsStore((s) => s.setOutputsViewerOpen);
  const searchOpen = useOutputsStore((s) => s.searchOpen);
  const searchDraft = useOutputsStore((s) => s.searchDraft);
  const setSearchDraft = useOutputsStore((s) => s.setSearchDraft);
  const runPromptSearch = useOutputsStore((s) => s.runPromptSearch);
  const clearPromptSearch = useOutputsStore((s) => s.clearPromptSearch);
  const promptSearchActive = useOutputsStore((s) => s.promptSearchActive);
  const promptSearchLoading = useOutputsStore((s) => s.promptSearchLoading);
  const promptSearchError = useOutputsStore((s) => s.promptSearchError);
  const promptSearchResults = useOutputsStore((s) => s.promptSearchResults);
  const addFavorites = useOutputsStore((s) => s.addFavorites);
  const removeFavorites = useOutputsStore((s) => s.removeFavorites);
  const clearSelection = useOutputsStore((s) => s.clearSelection);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const workflow = useWorkflowStore((s) => s.workflow);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  const sessions = useWorkflowStore((s) => s.sessions);
  const activeSessionId = useWorkflowStore((s) => s.activeSessionId);

  const isDirty = useMemo(
    () => isWorkflowModified(workflow, originalWorkflow),
    [workflow, originalWorkflow]
  );
  const canOpenWorkflowInNewTab =
    Boolean(activeSessionId && workflow) && sessions.length < MAX_WORKFLOW_SESSIONS;

  const [menuTarget, setMenuTarget] = useState<{ file: FileItem } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [loadWorkflowTarget, setLoadWorkflowTarget] = useState<FileItem | null>(null);
  const [outputsWorkflowConfirmFile, setOutputsWorkflowConfirmFile] = useState<FileItem | null>(null);
  const [loadNodePickerOpen, setLoadNodePickerOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [movePath, setMovePath] = useState<string | null>(null);
  const [moveFolders, setMoveFolders] = useState<FileItem[]>([]);
  const [moveLoading, setMoveLoading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [moveItemIds, setMoveItemIds] = useState<string[]>([]);
  const [moveOriginPath, setMoveOriginPath] = useState<string | null>(null);
  const [createFolderName, setCreateFolderName] = useState('');
  // Track the visual viewport so the (full-height) move modal shrinks above the
  // on-screen keyboard when the user types into the new-folder field.
  const moveViewport = useVisualViewportFrame(movePickerOpen);
  // Folder search within the move picker.
  const [moveSearchQuery, setMoveSearchQuery] = useState('');
  const [moveSearchDirs, setMoveSearchDirs] = useState<FileItem[]>([]);
  const [moveSearchLoading, setMoveSearchLoading] = useState(false);
  // The move picker has its own sort/filter, independent of the main grid's.
  // Sort persists across reopens (session); the filter resets each open.
  const [moveSort, setMoveSort] = useState<SortState>(() => sort);
  const [moveFilter, setMoveFilter] = useState<FilterState>({ search: '', favoritesOnly: false, type: 'all' });
  const setMoveFilterPartial = (partial: Partial<FilterState>) =>
    setMoveFilter((f) => ({ ...f, ...partial }));
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImages, setViewerImages] = useState<ViewerImage[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  // Incremental render budget for the file grid (grows on scroll).
  const [visibleCount, setVisibleCount] = useState(OUTPUTS_RENDER_PAGE);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const outputsContentRef = useRef<HTMLDivElement>(null);
  const hasFetchedRef = useRef(false);
  // Anchor for shift+click range ops. Carries the direction of the click that
  // set it (`select`) so a shift+click extends that same action across the
  // range: select-anchor → bulk select, deselect-anchor → bulk deselect.
  const selectionAnchorRef = useRef<{ id: string; select: boolean } | null>(null);
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

  const { menuStyle, resetMenuPosition } = useAnchoredMenuPosition({
    open: !!menuTarget,
    buttonRef: menuButtonRef,
    menuRef,
    repositionToken: menuTarget?.file.id,
    menuWidth: 176,
    horizontalAnchorOffset: 160,
    viewportPadding: 8,
    bottomBarReserve: 104
  });

  useDismissOnOutsideClick({
    open: !!menuTarget,
    onDismiss: () => {
      setMenuTarget(null);
      resetMenuPosition();
    },
    triggerRef: menuButtonRef,
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

  useEffect(() => {
    if (!searchOpen) return;
    requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, [searchOpen]);

  const displayedFiles = getDisplayedFiles();
  const sortMode = useOutputsStore((s) => s.sort.mode);
  const historyWorkflowByFileId = useHistoryWorkflowByFileId();

  const openOutputsViewer = (file: FileItem) => {
    const displayed = getDisplayedFiles();
    const mediaFiles = displayed.filter((f) => (f.type === 'image' || f.type === 'video') && f.fullUrl);
    const media = mediaFiles.map((f) => {
      const historyMatch = historyWorkflowByFileId.get(f.id);
      return {
      src: f.fullUrl!,
      displaySrc: f.type === 'image' ? getScreenPreviewUrl(f.fullUrl!) : undefined,
      alt: f.name,
      mediaType: getMediaType(f.name),
      workflow: historyMatch?.workflow,
      promptId: historyMatch?.promptId,
      file: f,
      filename: f.name
      };
    });
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
    const resolvedWorkflowLoad = resolveViewerItemWorkflowLoad(
      item,
      historyWorkflowByFileId,
    );
    if (resolvedWorkflowLoad) {
      loadWorkflow(
        resolvedWorkflowLoad.workflow,
        resolvedWorkflowLoad.filename,
        { source: resolvedWorkflowLoad.source },
      );
      setCurrentPanel('workflow');
      setViewerOpen(false);
      setOutputsViewerOpen(false);
      return;
    }
    if (!item.file) return;
    requestLoadWorkflowFromFile(item.file, { closeViewer: true });
  };

  // While the outputs viewer is open, keep its list reconciled with the live
  // file list. If a file is deleted or hidden elsewhere (queue auto-hide on the
  // last image of a run, an action in another tab, a background refresh), drop it
  // from the viewer so it can't render a broken image or be swiped onto a file
  // that no longer exists. We only prune (never re-add/reorder) so navigation
  // stays stable, and we keep the user on the nearest surviving item.
  useEffect(() => {
    if (!viewerOpen) return;
    const liveIds = new Set(
      displayedFiles
        .filter((f) => (f.type === 'image' || f.type === 'video') && f.fullUrl)
        .map((f) => f.id),
    );
    const survives = (entry: ViewerImage) => !entry.file || liveIds.has(entry.file.id);
    if (viewerImages.every(survives)) return;
    const next = viewerImages.filter(survives);
    if (next.length === 0) {
      setViewerOpen(false);
      setOutputsViewerOpen(false);
      setViewerImages([]);
      return;
    }
    const survivedBefore = viewerImages.slice(0, viewerIndex).filter(survives).length;
    setViewerImages(next);
    setViewerIndex(Math.max(0, Math.min(survivedBefore, next.length - 1)));
  }, [viewerOpen, displayedFiles, viewerImages, viewerIndex, setOutputsViewerOpen]);

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
  const fileSections = useMemo(
    () => buildFileSections(nonFolders, { isNameSort, isSizeSort, shouldGroupByDate }),
    [nonFolders, shouldGroupByDate, isNameSort, isSizeSort],
  );

  const selectableIds = useMemo(() => {
    const ids: string[] = [];
    if (!foldersCollapsed) {
      ids.push(...folders.map((file) => file.id));
    }
    for (const section of fileSections) {
      ids.push(...section.files.map((file) => file.id));
    }
    return ids;
  }, [fileSections, folders, foldersCollapsed]);

  // --- Incremental rendering of the file grid ------------------------------
  // Reset the budget AND scroll position when the user navigates to a different
  // view (folder / source / sort / search / filter) — otherwise entering a deep
  // folder while scrolled down lands the user partway into a freshly-truncated
  // list. Live file additions within the same view do NOT reset, so a websocket
  // output doesn't yank the user back to the top.
  useEffect(() => {
    setVisibleCount(OUTPUTS_RENDER_PAGE);
    outputsContentRef.current?.scrollTo({ top: 0 });
    // Drop the range-select anchor too: after the visible set changes (different
    // folder/source/filter), an anchor from the old view may no longer be in the
    // selectable list, which would make a subsequent range click silently fall
    // back to a plain toggle.
    selectionAnchorRef.current = null;
  }, [currentFolder, source, sortMode, promptSearchActive,
      filter.search, filter.type, filter.favoritesOnly]);

  // Grow the budget while the rendered content doesn't fill the viewport (e.g.
  // the first page is shorter than the screen), so there's always something to
  // scroll toward and a small-but-not-tiny folder shows fully.
  useEffect(() => {
    const el = outputsContentRef.current;
    if (!el) return;
    if (visibleCount >= nonFolders.length) return;
    if (el.scrollHeight <= el.clientHeight + 20) {
      setVisibleCount((prev) => Math.min(nonFolders.length, prev + OUTPUTS_RENDER_PAGE));
    }
  }, [visibleCount, nonFolders.length]);

  const handleOutputsScroll = () => {
    const el = outputsContentRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (remaining < 600) {
      setVisibleCount((prev) =>
        prev < nonFolders.length
          ? Math.min(nonFolders.length, prev + OUTPUTS_RENDER_PAGE)
          : prev,
      );
    }
  };

  const scrollCollapsedStickySectionToTop = (sectionElement: HTMLElement | null) => {
    const scrollContainer = outputsContentRef.current;
    if (!sectionElement || !scrollContainer) return;
    const target = getStickySectionScrollTarget(
      sectionElement,
      scrollContainer,
      STICKY_SECTION_TOP,
    );
    if (target == null) return;
    requestAnimationFrame(() => {
      scrollContainer.scrollTo({ top: target, behavior: 'smooth' });
    });
  };

  const toggleFoldersCollapsed = (sectionElement: HTMLElement | null) => {
    const newValue = !foldersCollapsed;
    if (newValue) scrollCollapsedStickySectionToTop(sectionElement);
    setFoldersCollapsed(newValue);
    localStorage.setItem(FOLDERS_COLLAPSED_KEY, String(newValue));
  };

  const toggleSectionCollapsed = (key: string, sectionElement: HTMLElement | null) => {
    if (!collapsedSections[key]) scrollCollapsedStickySectionToTop(sectionElement);
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
      e.stopPropagation();
      menuButtonRef.current = e.currentTarget as HTMLButtonElement;
      setMenuTarget({ file });
  };

  const handleFavorite = () => {
     if (!menuTarget) return;
     toggleFavorite(menuTarget.file.id);
     setMenuTarget(null);
  };

  const handleToggleHidden = () => {
    if (!menuTarget) return;
    void setItemHidden(menuTarget.file.id, !menuTarget.file.hiddenSelf);
    setMenuTarget(null);
  };

  const handleSelectSingle = () => {
    if (!menuTarget) return;
    if (!selectionMode) {
      toggleSelectionMode();
    }
    selectIds([menuTarget.file.id], 'replace');
    selectionAnchorRef.current = { id: menuTarget.file.id, select: true };
    setMenuTarget(null);
  };

  const handleToggleSelection = (
    id: string,
    event: React.MouseEvent,
    options?: { range?: boolean },
  ) => {
    const anchor = selectionAnchorRef.current;
    if ((event.shiftKey || options?.range) && anchor) {
      const rangeIds = getSelectionRangeIds(selectableIds, anchor.id, id);
      if (rangeIds) {
        // Apply the anchor click's direction across the whole range: a
        // select-anchor bulk-selects, a deselect-anchor bulk-deselects. The
        // anchor stays put so further shift+clicks re-range from the same item.
        if (anchor.select) selectIds(rangeIds);
        else deselectIds(rangeIds);
        return;
      }
    }

    // Plain toggle: anchor this item AND remember whether it selected or
    // deselected, so a following shift+click extends that same action.
    const willSelect = !selectedIds.includes(id);
    toggleSelection(id);
    selectionAnchorRef.current = { id, select: willSelect };
  };

  // Stable callback identities for the (potentially thousands of) memoized
  // FileCards. The underlying handlers read fresh state each render and some
  // depend on selectedIds, so a plain useCallback would change identity on every
  // selection and defeat the memo. Routing through a ref keeps the wrapper
  // identity fixed while always invoking the latest handler (no stale closure),
  // so changing the selection only re-renders the toggled card, not the grid.
  const handleOpenRef = useRef(handleOpen);
  handleOpenRef.current = handleOpen;
  const handleMenuRef = useRef(handleMenu);
  handleMenuRef.current = handleMenu;
  const handleToggleSelectionRef = useRef(handleToggleSelection);
  handleToggleSelectionRef.current = handleToggleSelection;
  const stableHandleOpen = useCallback(
    (file: FileItem) => handleOpenRef.current(file),
    [],
  );
  const stableHandleMenu = useCallback(
    (file: FileItem, e: React.MouseEvent) => handleMenuRef.current(file, e),
    [],
  );
  const stableToggleSelection = useCallback(
    (id: string, event: React.MouseEvent, options?: { range?: boolean }) =>
      handleToggleSelectionRef.current(id, event, options),
    [],
  );

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

  const handleDownload = () => {
    if (!menuTarget) return;
    const file = menuTarget.file;
    setMenuTarget(null);
    if (!file.fullUrl) return;
    void shareOrDownloadFile(file.fullUrl, file.name);
  };

  const handleDownloadSelection = () => {
    if (selectedIds.length === 0) return;
    // Selection can span folders/tabs, so resolve every selected id — not just
    // the current folder view (displayed files use their real fullUrl; others
    // reconstruct from the id).
    const displayedById = new Map(displayedFiles.map((f) => [f.id, f]));
    const targets = resolveSelectionDownloadTargets(selectedIds, displayedById);
    if (targets.length === 0) return;
    setSelectionActionOpen(false);
    void shareOrDownloadBatch(targets);
  };

  const handleRenameRequest = () => {
    if (!menuTarget) return;
    setRenameTarget(menuTarget.file);
    setRenameValue(menuTarget.file.name);
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
    if (isDirty && !canOpenWorkflowInNewTab) {
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

  // Dot-prefixed items aren't manually toggleable, so the bulk hide action only
  // targets the rest of the selection. When every target is already hidden the
  // action unhides them; otherwise it hides the whole set.
  const selectionHideTargets = useMemo(
    () => displayedFiles.filter((f) => selectedIds.includes(f.id) && !f.name.startsWith('.')),
    [displayedFiles, selectedIds]
  );
  const selectionAllHidden = selectionHideTargets.length > 0 && selectionHideTargets.every((f) => f.hiddenSelf);

  // Folders vs files in the selection (folders identified from the current view)
  // so the delete confirmation states the real consequence — a selected folder
  // is deleted recursively with all its contents.
  const selectionDeleteCounts = useMemo(() => {
    const byId = new Map(displayedFiles.map((f) => [f.id, f]));
    let folders = 0;
    for (const id of selectedIds) {
      if (byId.get(id)?.type === 'folder') folders += 1;
    }
    return { folders, files: selectedIds.length - folders };
  }, [displayedFiles, selectedIds]);

  const handleHideSelection = () => {
    setSelectionActionOpen(false);
    if (selectedIds.length === 0) return;
    // Operate on every selected id (which can span folders/tabs), not just the
    // current-folder view — `setItemsHidden` is id/path-based like bulk delete
    // and favorites. Toggle direction follows the visible selection.
    void setItemsHidden(selectedIds, !selectionAllHidden);
    clearSelection();
  };

  // Distinct folders that open tabs are pointing at (within the current source),
  // offered as jump shortcuts in the move picker. The active tab uses the live
  // currentFolder; the user's current location is therefore always included,
  // regardless of how many tabs are open.
  const moveShortcutFolders = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<string | null> = [];
    for (const tab of tabs) {
      const tabSource = tab.id === activeTabId ? source : tab.source;
      if (tabSource !== source) continue;
      const folder = tab.id === activeTabId ? currentFolder : tab.folder;
      const key = folder ?? '\u0000root';
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(folder);
    }
    return result;
  }, [tabs, activeTabId, source, currentFolder]);

  // Sort + filter move-picker folders by the move picker's own sort/filter
  // (independent of the main grid). Search results only carry name/date, so
  // size sort is a no-op for them.
  const sortFilterMoveFolders = (folders: FileItem[]) => {
    const filtered = moveFilter.favoritesOnly
      ? folders.filter((f) => favorites.includes(f.id))
      : folders;
    const direction = moveSort.mode.endsWith('-reverse') ? -1 : 1;
    const sorted = [...filtered];
    if (moveSort.mode.startsWith('name')) {
      sorted.sort((a, b) => a.name.localeCompare(b.name) * direction);
    } else if (moveSort.mode.startsWith('size')) {
      sorted.sort((a, b) => ((a.size ?? 0) - (b.size ?? 0)) * direction);
    } else {
      sorted.sort((a, b) => ((a.date ?? 0) - (b.date ?? 0)) * -1 * direction);
    }
    return sorted;
  };

  const moveFoldersSorted = useMemo(
    () => sortFilterMoveFolders(moveFolders.filter((f) => !moveItemIds.includes(f.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moveFolders, moveItemIds, moveSort.mode, moveFilter.favoritesOnly, favorites]
  );

  const moveSearchResults = useMemo(() => {
    const q = moveSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return sortFilterMoveFolders(
      moveSearchDirs.filter((d) => !moveItemIds.includes(d.id) && d.name.toLowerCase().includes(q))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveSearchDirs, moveSearchQuery, moveItemIds, moveSort.mode, moveFilter.favoritesOnly, favorites]);

  const moveSearchActive = moveSearchQuery.trim().length > 0;

  // The move filter resets on every open (sort is intentionally remembered).
  const resetMoveFilterOnOpen = () =>
    setMoveFilter({ search: '', favoritesOnly: false, type: 'all' });

  const handleMoveSelection = () => {
    if (selectedIds.length === 0) return;
    setSelectionActionOpen(false);
    setMoveItemIds([...selectedIds]);
    setMoveOriginPath(currentFolder);
    setMovePath(null); // start at root; the origin is reachable via its shortcut
    resetMoveFilterOnOpen();
    setMovePickerOpen(true);
  };

  const handleMoveSingle = () => {
    if (!menuTarget) return;
    setMoveItemIds([menuTarget.file.id]);
    setMoveOriginPath(currentFolder);
    setMovePath(null); // start at root; the origin is reachable via its shortcut
    resetMoveFilterOnOpen();
    setMovePickerOpen(true);
    setMenuTarget(null);
  };

  const closeRenameModal = () => {
    setRenameTarget(null);
    setRenameValue('');
  };

  const confirmRename = async () => {
    if (!renameTarget) return;
    const nextName = renameValue.trim();
    if (!nextName) return;
    if (nextName === renameTarget.name) {
      closeRenameModal();
      return;
    }
    try {
      const filePath = resolveFilePath(renameTarget, source);
      await renameFile(filePath, nextName, source);
      refresh();
      closeRenameModal();
    } catch (err) {
      console.error('Failed to rename item:', err);
      window.alert('Failed to rename item.');
    }
  };

  const closeMoveModal = () => {
    setMovePickerOpen(false);
    setMoveItemIds([]);
    setMoveOriginPath(null);
    setMoveSearchQuery('');
    setMoveSearchDirs([]);
  };

  // Jump the move navigation to a searched folder and drop back to browsing.
  const handleMoveSearchResultClick = (folderId: string) => {
    const prefix = `${source}/`;
    const path = folderId.startsWith(prefix) ? folderId.slice(prefix.length) : folderId;
    setMovePath(path);
    setMoveSearchQuery('');
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

  // A new-folder name is valid when it's non-empty and free of path separators
  // or dot-only names (mirrors the backend's rename/mkdir validation).
  const newFolderNameValid = (() => {
    const t = newFolderName.trim();
    return t !== '' && !t.includes('/') && !t.includes('\\') && t !== '.' && t !== '..';
  })();

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!newFolderNameValid) return;
    const path = movePath ? `${movePath}/${name}` : name;
    try {
      await createFolder(path, source);
      setNewFolderName('');
      setMoveLoading(true);
      const result = await getUserImages(source, 1000, 0, 'modified', false, movePath, showHidden);
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


  // Render one tab's breadcrumb trail. For the active tab, clicking a crumb
  // navigates within it (and the current/last crumb is inert). For an inactive
  // tab, clicking any crumb switches to that tab AND navigates it there.
  const renderTrail = (crumbs: Array<{ name: string; path: string | null }>, isActive: boolean, tabId: string) => {
    const displayCrumbs = collapseBreadcrumbs(crumbs);

    const onCrumbClick = (path: string | null, clickable: boolean) => {
      if (isActive) {
        if (clickable) navigateToPath(path);
      } else {
        // Every crumb in an inactive tab is a switch target.
        switchToTab(tabId, path);
      }
    };

    return (
      <div className="outputs-breadcrumb-trail flex items-center text-sm overflow-hidden whitespace-nowrap min-w-0 flex-1">
        {displayCrumbs.map((crumb, idx) => {
          // Inactive tabs: all crumbs clickable (to switch). Active tab: the
          // current/last crumb is inert.
          const clickable = isActive ? crumb.isClickable : true;
          // Hidden crumbs are dimmed gray + italic so they clearly read as
          // hidden, regardless of whether they're a clickable link.
          const hidden = !crumb.isEllipsis && isCrumbHidden(crumb.path, hiddenFolderPaths);
          // The active tab's current folder (its inert last crumb) is where the
          // user actually is — keep it white even when hidden (italic still cues
          // the hidden state).
          const isCurrentActive = isActive && !crumb.isClickable;
          return (
            <div key={idx} className="flex items-center min-w-0">
              {idx > 0 && <span className="mx-1.5 text-slate-500 shrink-0">/</span>}
              <button
                onClick={() => onCrumbClick(crumb.path, crumb.isClickable)}
                disabled={!clickable}
                className={`
                  truncate transition-colors duration-200
                  ${hidden ? 'italic' : ''}
                  ${isCurrentActive
                    ? 'text-slate-100'
                    : hidden
                      ? 'text-slate-500 hover:text-slate-400'
                      : clickable ? 'text-cyan-300 hover:text-cyan-200 active:opacity-70' : 'text-slate-100'}
                  ${crumb.isEllipsis ? 'px-1 bg-slate-900/95 rounded' : ''}
                `}
                title={crumb.name}
              >
                {crumb.name}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  // One header row per tab. The active tab mirrors live source/currentFolder;
  // inactive tabs render from their own stored source/folder snapshot.
  const renderTabsHeader = () => {
    const multi = tabs.length > 1;
    return (
      <div id="outputs-panel-header" className="px-2 py-2 flex flex-col gap-1 border-b border-white/10">
        {tabs.map((tab: OutputsTab) => {
          const isActive = tab.id === activeTabId;
          const crumbs = isActive ? buildBreadcrumbs(source, currentFolder) : buildBreadcrumbs(tab.source, tab.folder);
          return (
            <div
              key={tab.id}
              className={`flex items-center gap-2 rounded-lg px-2 py-1 min-h-[28px] ${isActive && multi ? 'bg-slate-800' : ''}`}
            >
              {renderTrail(crumbs, isActive, tab.id)}
              {isActive && selectionMode && (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-bold text-cyan-300 uppercase">{selectedIds.length} selected</span>
                  <button
                    onClick={handleSelectionClear}
                    className="text-[10px] text-slate-400 hover:text-slate-100 underline uppercase font-bold"
                  >
                    Clear
                  </button>
                </div>
              )}
              {isActive ? (
                tabs.length < MAX_OUTPUTS_TABS && (
                  <button
                    onClick={addTab}
                    aria-label="Open a new tab"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-slate-300 hover:text-slate-100 hover:bg-white/10"
                  >
                    <PlusIcon className="w-4 h-4" />
                  </button>
                )
              ) : (
                <button
                  onClick={() => closeTab(tab.id)}
                  aria-label="Close tab"
                  className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-100 hover:bg-white/10"
                >
                  <MinusIcon className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // Breadcrumb trail for the move picker's current destination. Works like the
  // normal trails: clicking a segment jumps the move navigation there.
  const renderMoveTrail = () => {
    const displayCrumbs = collapseBreadcrumbs(buildBreadcrumbs(source, movePath));
    return (
      <div className="flex items-center text-sm overflow-hidden whitespace-nowrap min-w-0 flex-1">
        {displayCrumbs.map((crumb, idx) => {
          // Same hidden rules as the panel breadcrumbs: hidden crumbs are dim
          // gray + italic, except the current/destination crumb stays white.
          const hidden = !crumb.isEllipsis && isCrumbHidden(crumb.path, hiddenFolderPaths);
          const isCurrent = !crumb.isClickable;
          return (
            <div key={idx} className="flex items-center min-w-0">
              {idx > 0 && <span className="mx-1.5 text-slate-500 shrink-0">/</span>}
              <button
                onClick={() => crumb.isClickable && setMovePath(crumb.path)}
                disabled={!crumb.isClickable}
                className={`
                  truncate transition-colors duration-200
                  ${hidden ? 'italic' : ''}
                  ${isCurrent
                    ? 'text-slate-100'
                    : hidden
                      ? 'text-slate-500 hover:text-slate-400'
                      : 'text-cyan-300 hover:text-cyan-200 active:opacity-70'}
                  ${crumb.isEllipsis ? 'px-1 bg-slate-900/95 rounded' : ''}
                `}
                title={crumb.name}
              >
                {crumb.name}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  useEffect(() => {
    if (!movePickerOpen) return;
    let canceled = false;
    const loadFolders = async () => {
      setMoveLoading(true);
      try {
        const result = await getUserImages(source, 1000, 0, 'modified', false, movePath, showHidden);
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
  }, [movePickerOpen, movePath, source, showHidden]);

  // While a folder search is active, pull every folder nested under the current
  // move location so the query can be matched (debounced; re-fetched per
  // location/source).
  useEffect(() => {
    if (!movePickerOpen || !moveSearchQuery.trim()) {
      setMoveSearchDirs([]);
      setMoveSearchLoading(false);
      return;
    }
    let canceled = false;
    setMoveSearchLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        const dirs = await getRecursiveFolders(source, movePath, showHidden);
        if (!canceled) setMoveSearchDirs(dirs);
      } catch (err) {
        if (canceled) return;
        console.error('Failed to search folders:', err);
        setMoveSearchDirs([]);
      } finally {
        if (!canceled) setMoveSearchLoading(false);
      }
    }, 200);
    return () => {
      canceled = true;
      window.clearTimeout(handle);
    };
  }, [movePickerOpen, moveSearchQuery, movePath, source, showHidden]);

  useEffect(() => {
    if (selectionActionOpen && selectedIds.length === 0) {
      setSelectionActionOpen(false);
    }
  }, [selectionActionOpen, selectedIds.length, setSelectionActionOpen]);

  useEffect(() => {
    if (!visible || !selectionMode) return;
    if (
      viewerOpen ||
      filterModalOpen ||
      selectionActionOpen ||
      newFolderModalOpen ||
      deleteSelectionOpen ||
      movePickerOpen ||
      renameTarget ||
      deleteTarget ||
      loadNodePickerOpen ||
      outputsWorkflowConfirmFile ||
      menuTarget
    ) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      clearSelection();
      toggleSelectionMode();
      selectionAnchorRef.current = null;
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    visible,
    selectionMode,
    viewerOpen,
    filterModalOpen,
    selectionActionOpen,
    newFolderModalOpen,
    deleteSelectionOpen,
    movePickerOpen,
    renameTarget,
    deleteTarget,
    loadNodePickerOpen,
    outputsWorkflowConfirmFile,
    menuTarget,
    clearSelection,
    toggleSelectionMode,
  ]);

  const handleSelectionClear = () => {
    const state = useOutputsStore.getState();
    state.clearSelection();
    state.toggleSelectionMode();
    selectionAnchorRef.current = null;
  };

  const handleMoveFolderClick = (folderName: string) => () => {
    setMovePath(movePath ? `${movePath}/${folderName}` : folderName);
  };

  const handleApplySearch = () => {
    void runPromptSearch(searchDraft);
  };

  return (
    <div
      id="outputs-panel-wrapper"
      className="absolute inset-x-0 bottom-0"
      style={{ display: visible ? 'block' : 'none', top: 'var(--top-bar-offset, 69px)' }}
    >
      <div
        id="outputs-panel-root"
        className="h-full bg-slate-950/88 text-slate-100 flex flex-col pt-4"
        style={{ paddingBottom: 'var(--bottom-bar-offset, 80px)' }}
      >
       {/* The breadcrumb/tabs header. At the root with a single tab it only
           duplicates the top-bar source toggle, so it's hidden — but once there
           are multiple tabs we always keep it visible (even at root) so the tab
           rows never disappear. */}
       {(currentFolder || selectionMode || tabs.length > 1) && renderTabsHeader()}

       {searchOpen && (
         <div className="node-search-bar bg-slate-900/95 border-b border-white/10 px-4 py-2">
           <form
             className="flex items-center gap-2"
             onSubmit={(event) => {
               event.preventDefault();
               handleApplySearch();
             }}
           >
             <SearchBar
               inputRef={searchInputRef}
               value={searchDraft}
               onChange={setSearchDraft}
               placeholder="Search outputs..."
               inputClassName="border-white/10 bg-slate-950/80 text-slate-100 placeholder:text-slate-500 focus:ring-cyan-400"
               showClearButton={false}
               className="flex-1 min-w-0"
             />
             <button
               type="button"
               className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-950 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-400"
               onClick={handleApplySearch}
               disabled={promptSearchLoading}
             >
               Apply
             </button>
           </form>
         </div>
       )}

       <div ref={outputsContentRef} id="outputs-content-container" onScroll={handleOutputsScroll} className="flex-1 overflow-y-auto overflow-x-hidden p-4">
          {promptSearchError && (
            <div
              id="outputs-prompt-search-error"
              className="mb-4 rounded-lg border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-200"
            >
              Prompt search failed: {promptSearchError}
            </div>
          )}
          {promptSearchActive && (
            <div
              id="outputs-prompt-search-banner"
              className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/95 px-3 py-2 text-sm text-slate-300"
            >
              <span>
                <span className="text-cyan-300 font-medium">
                  {promptSearchResults.length} total {promptSearchResults.length === 1 ? 'match' : 'matches'}
                </span>
                {' '}— showing {nonFolders.length} in this folder
              </span>
              <button
                type="button"
                className="text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                onClick={clearPromptSearch}
              >
                Clear
              </button>
            </div>
          )}
          <OutputsFoldersSection
            folders={folders}
            foldersCollapsed={foldersCollapsed}
            toggleFoldersCollapsed={toggleFoldersCollapsed}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            favorites={favorites}
            setCurrentFolder={setCurrentFolder}
            handleOpen={handleOpen}
            handleMenu={handleMenu}
            toggleSelection={handleToggleSelection}
          />

          <OutputsFilesSection
            fileSections={fileSections}
            collapsedSections={collapsedSections}
            viewMode={viewMode}
            selectionMode={selectionMode}
            selectedIds={selectedIds}
            favorites={favorites}
            setCurrentFolder={setCurrentFolder}
            handleOpen={stableHandleOpen}
            handleMenu={stableHandleMenu}
            toggleSelection={stableToggleSelection}
            toggleSectionCollapsed={toggleSectionCollapsed}
            selectIds={selectIds}
            maxRenderedFiles={visibleCount}
          />

          {isLoading && (
            <div id="outputs-loading-indicator" className="py-4 flex justify-center">
              <span className="text-slate-400 text-sm">Loading...</span>
            </div>
          )}

          {!isLoading && error && (
            <div id="outputs-error-message" className="text-center py-8">
              <div className="text-rose-300 text-sm mb-3">
                Couldn&apos;t load outputs: {error}
              </div>
              <button
                type="button"
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-100 text-sm border border-white/10 active:bg-slate-700"
                onClick={() => refresh()}
              >
                Retry
              </button>
            </div>
          )}

          {!isLoading && !error && displayedFiles.length === 0 && (
             <div id="outputs-empty-message" className="text-center text-slate-400 py-8">
               {currentFolder
                 ? 'No images in this folder'
                 : source === 'output'
                   ? 'No generated images yet'
                   : 'No imported images'}
             </div>
          )}
       </div>

       <OutputsContextMenu
         menuTarget={menuTarget}
         favorites={favorites}
         setMenuTarget={setMenuTarget}
         menuRef={menuRef}
         menuStyle={menuStyle}
         handleFavorite={handleFavorite}
         handleToggleHidden={handleToggleHidden}
         handleSelectSingle={handleSelectSingle}
         handleMoveSingle={handleMoveSingle}
         handleRenameRequest={handleRenameRequest}
         handleLoadWorkflow={handleLoadWorkflow}
         handleLoadInWorkflow={handleLoadInWorkflow}
         handleDownload={handleDownload}
         handleDeleteRequest={handleDeleteRequest}
       />
       {selectionActionOpen && (
        <ModalFrame
          onClose={() => setSelectionActionOpen(false)}
          zIndex={1800}
        >
             <div className="px-4 py-3 text-sm font-semibold text-slate-100 border-b border-white/10">
               {selectedIds.length} selected
             </div>
             <button
               className="w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-white/10 flex items-center gap-2"
               onClick={handleFavoriteSelection}
             >
               {selectedIds.every((id) => favorites.includes(id))
                 ? <BookmarkOutlineIcon className="w-4 h-4" />
                 : <BookmarkIconSvg className="w-4 h-4" />}
               {selectedIds.every((id) => favorites.includes(id)) ? 'Unfavorite' : 'Favorite'}
             </button>
             <button
               className="w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-white/10 flex items-center gap-2"
               onClick={handleMoveSelection}
             >
               <FolderIcon className="w-4 h-4 text-cyan-300" />
               Move
             </button>
             <button
               className="w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-white/10 flex items-center gap-2"
               onClick={handleDownloadSelection}
             >
               <DownloadDeviceIcon className="w-4 h-4 text-slate-400" />
               Download
             </button>
             {selectionHideTargets.length > 0 && (
               <button
                 className="w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-white/10 flex items-center gap-2"
                 onClick={handleHideSelection}
               >
                 {selectionAllHidden
                   ? <EyeIcon className="w-4 h-4 text-slate-400" />
                   : <EyeOffIcon className="w-4 h-4 text-slate-400" />}
                 {selectionAllHidden ? 'Unhide' : 'Hide'}
               </button>
             )}
             <button
               className="w-full text-left px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2"
               onClick={handleBulkDeleteRequest}
             >
               <TrashIcon className="w-4 h-4" />
               Delete
             </button>
             <button
               className="w-full text-left px-4 py-3 text-sm text-slate-400 hover:bg-white/10"
               onClick={() => setSelectionActionOpen(false)}
             >
               Cancel
             </button>
         </ModalFrame>
       )}
       {movePickerOpen && (() => {
         const vp = moveViewport ?? getVisualViewportFrame();
         return (
           <div
             className="fixed left-0 top-0 z-[2400] bg-black/50 flex items-center justify-center p-4 overflow-hidden"
             style={{ width: `${vp.width}px`, height: `${vp.height}px`, transform: `translate(${vp.offsetLeft}px, ${vp.offsetTop}px)` }}
             onClick={closeMoveModal}
             role="dialog"
             aria-modal="true"
           >
             <div
               className="w-full max-w-sm h-full flex flex-col rounded-xl shadow-lg overflow-hidden bg-slate-900 border border-white/10 text-slate-100"
               onClick={(event) => event.stopPropagation()}
             >
               <div className="shrink-0 px-4 py-3 text-sm font-semibold text-slate-100 border-b border-white/10">
                 Move {moveItemIds.length} item{moveItemIds.length === 1 ? '' : 's'} to...
               </div>
               {/* Folder search + filter/sort, above the tab-location shortcuts.
                   Searches folders nested under the current move location. */}
               <div className="shrink-0 px-4 py-2 border-b border-white/10 flex items-center gap-2">
                 <SearchBar
                   value={moveSearchQuery}
                   onChange={setMoveSearchQuery}
                   placeholder="Search folders..."
                   inputClassName="border-white/10 bg-slate-950/80 text-slate-100 placeholder:text-slate-500 focus:ring-cyan-400"
                   className="flex-1 min-w-0"
                 />
                 <button
                   type="button"
                   onClick={() => setFilterModalOpen(true)}
                   aria-label="Filter and sort"
                   className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-slate-300 hover:text-slate-100 hover:bg-white/10"
                 >
                   <FunnelArrowsIcon className="w-5 h-5" />
                 </button>
               </div>
               {/* Jump shortcuts for the folders open tabs point at (plus the
                   current location). The folder the selection is moving FROM is
                   marked with a leading arrow icon (no highlight). */}
               {moveShortcutFolders.length > 0 && (
                 <div className="shrink-0 border-b border-white/10 py-1">
                   <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                     Open tab locations
                   </div>
                   {moveShortcutFolders.map((folder) => {
                     const isOrigin = (folder ?? null) === (moveOriginPath ?? null);
                     return (
                       <button
                         key={folder ?? ' root'}
                         onClick={() => setMovePath(folder)}
                         className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 hover:bg-white/10"
                       >
                         <span className="w-4 shrink-0 flex items-center justify-center">
                           {isOrigin && <CornerDownRightIcon className="w-4 h-4 text-cyan-300 rotate-90" />}
                         </span>
                         <FolderIcon className="w-4 h-4 shrink-0 text-cyan-300" />
                         <span className="truncate text-slate-200">
                           {folder || (source === 'output' ? 'Outputs' : source === 'input' ? 'Inputs' : 'Temp')}
                         </span>
                       </button>
                     );
                   })}
                 </div>
               )}
               {/* Destination breadcrumbs — the only highlighted row. Clicking a
                   segment jumps the move navigation there (replaces the old ".."). */}
               <div className="shrink-0 flex items-center px-4 py-2.5 border-b border-white/10 bg-slate-800">
                 {renderMoveTrail()}
               </div>
               <div className="flex-1 min-h-0 overflow-y-auto">
                 {moveSearchActive ? (
                   <>
                     {moveSearchLoading && moveSearchResults.length === 0 && (
                       <div className="px-4 py-3 text-sm text-slate-400">Searching…</div>
                     )}
                     {!moveSearchLoading && moveSearchResults.length === 0 && (
                       <div className="px-4 py-3 text-sm text-slate-400">No matching folders</div>
                     )}
                     {moveSearchResults.map((folder) => {
                       const relPath = folder.id.startsWith(`${source}/`) ? folder.id.slice(source.length + 1) : folder.id;
                       const segs = relPath.split('/');
                       const folderHidden = Boolean(folder.hidden);
                       return (
                         <button
                           key={folder.id}
                           onClick={() => handleMoveSearchResultClick(folder.id)}
                           className="w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 hover:bg-white/10"
                         >
                           <FolderIcon className={`w-4 h-4 shrink-0 ${folderHidden ? 'text-slate-500' : 'text-cyan-300'}`} />
                           {folderHidden && <EyeOffIcon className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
                           {/* Result shown as its full breadcrumb path. */}
                           <span className="min-w-0 flex-1 flex items-center overflow-hidden whitespace-nowrap">
                             {segs.map((seg, i) => (
                               <span key={i} className="flex items-center min-w-0">
                                 {i > 0 && <span className="mx-1 text-slate-500 shrink-0">/</span>}
                                 <span className={`truncate ${i === segs.length - 1 ? (folderHidden ? 'text-slate-300' : 'text-slate-100') : 'text-slate-500'} ${folderHidden ? 'italic' : ''}`}>{seg}</span>
                               </span>
                             ))}
                           </span>
                         </button>
                       );
                     })}
                   </>
                 ) : (
                   <>
                     {moveLoading && (
                       <div className="px-4 py-3 text-sm text-slate-400">Loading folders...</div>
                     )}
                     {!moveLoading && moveFoldersSorted.length === 0 && (
                       <div className="px-4 py-3 text-sm text-slate-400">No folders</div>
                     )}
                     {!moveLoading && moveFoldersSorted.map((folder) => {
                       const folderHidden = Boolean(folder.hidden);
                       return (
                         <button
                           key={folder.id}
                           className="w-full text-left px-4 py-3 text-sm flex items-center gap-2 hover:bg-white/10"
                           onClick={handleMoveFolderClick(folder.name)}
                         >
                           <FolderIcon className={`w-4 h-4 shrink-0 ${folderHidden ? 'text-slate-500' : 'text-cyan-300'}`} />
                           {folderHidden && <EyeOffIcon className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
                           <span className={`min-w-0 flex-1 truncate ${folderHidden ? 'italic text-slate-400' : 'text-slate-200'}`}>{folder.name}</span>
                           {typeof folder.count === 'number' && (
                             <span className="shrink-0 text-xs text-slate-400">{folder.count} {folder.count === 1 ? 'item' : 'items'}</span>
                           )}
                         </button>
                       );
                     })}
                   </>
                 )}
               </div>
               {/* New-folder form hugs the bottom, just above the action buttons. */}
               <div className="shrink-0 px-4 py-3 border-t border-white/10">
                 <div className="flex items-center gap-2">
                   <FolderIcon className={`w-5 h-5 shrink-0 transition-colors ${newFolderNameValid ? 'text-cyan-300' : 'text-slate-600'}`} />
                   <input
                     value={newFolderName}
                     onChange={(event) => setNewFolderName(event.target.value)}
                     placeholder="New folder"
                     data-swipe-nav-ignore="true"
                     className="flex-1 min-w-0 border border-white/10 bg-slate-950/80 text-slate-100 placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                   />
                   <button
                     className="px-3 py-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200 disabled:text-slate-600"
                     onClick={handleCreateFolder}
                     disabled={!newFolderNameValid}
                   >
                     Create
                   </button>
                 </div>
               </div>
               <div className="shrink-0 px-4 py-3 border-t border-white/10 flex justify-end gap-2">
                 <button
                   className="px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 rounded-lg"
                   onClick={closeMoveModal}
                 >
                   Cancel
                 </button>
                 <button
                   className={`px-3 py-2 text-sm font-semibold rounded-lg ${movePath !== moveOriginPath ? 'text-slate-950 bg-cyan-500 hover:bg-cyan-400' : 'text-slate-500 bg-slate-800 cursor-not-allowed'}`}
                   onClick={submitMove}
                   disabled={movePath === moveOriginPath}
                 >
                   Submit
                 </button>
               </div>
             </div>
           </div>
         );
       })()}
       {deleteTarget && (
         <Dialog
           fullscreen={viewerOpen}
           onClose={closeDeleteModal}
           title="Delete file?"
           description={
             deleteTarget.type === 'folder'
               ? `This will permanently delete the folder "${deleteTarget.name}" and all of its contents from the server. This cannot be undone.`
               : `This will permanently delete "${deleteTarget.name}" from the server. This cannot be undone.`
           }
           actions={[
             {
               label: 'Cancel',
               onClick: closeDeleteModal,
               variant: 'secondary'
             },
             {
               label: 'Delete',
               autoFocus: true,
               onClick: confirmDelete,
               variant: 'danger'
             }
           ]}
         />
       )}
       {deleteSelectionOpen && (
         <Dialog
           onClose={() => setDeleteSelectionOpen(false)}
           title="Delete selection?"
           description={(() => {
             const { files, folders } = selectionDeleteCounts;
             const fileLabel = `${files} file${files === 1 ? '' : 's'}`;
             const folderLabel = `${folders} folder${folders === 1 ? '' : 's'}`;
             const target =
               folders === 0 ? fileLabel : files === 0 ? folderLabel : `${fileLabel} and ${folderLabel}`;
             return `This will permanently delete ${target} from the server${folders > 0 ? `, including all contents of the selected folder${folders === 1 ? '' : 's'}` : ''}. This cannot be undone.`;
           })()}
           zIndex={1800}
           actions={[
             {
               label: 'Cancel',
               onClick: () => setDeleteSelectionOpen(false),
               variant: 'secondary'
             },
             {
               label: 'Delete',
               autoFocus: true,
               onClick: confirmDeleteSelection,
               variant: 'danger'
             }
           ]}
        />
       )}
       {renameTarget && (
         <ModalFrame
           onClose={closeRenameModal}
           zIndex={1850}
         >
          <div className="p-4">
            <div className="text-slate-100 text-base font-semibold">
              Rename {renameTarget.type === 'folder' ? 'folder' : 'file'}
            </div>
            <div className="text-slate-400 text-sm mt-1 truncate">
              Current: {renameTarget.name}
            </div>
            <input
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void confirmRename(); }}
              placeholder={renameTarget.type === 'folder' ? 'Folder name' : 'File name'}
              data-swipe-nav-ignore="true"
              className="mt-3 w-full border border-white/10 bg-slate-950/80 text-slate-100 placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/10"
                onClick={closeRenameModal}
              >
                Cancel
              </button>
              <button
                className={`px-3 py-2 rounded-lg text-sm font-medium ${
                  renameValue.trim() && renameValue.trim() !== renameTarget.name
                    ? 'text-slate-950 bg-cyan-500 hover:bg-cyan-400'
                    : 'text-slate-500 bg-slate-800 cursor-not-allowed'
                }`}
                onClick={() => { void confirmRename(); }}
                disabled={!renameValue.trim() || renameValue.trim() === renameTarget.name}
              >
                Rename
              </button>
            </div>
          </div>
         </ModalFrame>
       )}
       {newFolderModalOpen && (
         <ModalFrame
           onClose={() => { setNewFolderModalOpen(false); setCreateFolderName(''); }}
           zIndex={1850}
         >
           <div className="p-4">
            <div className="text-slate-100 text-base font-semibold">New folder</div>
            <div className="text-slate-400 text-sm mt-1">
              Create a new folder in {currentFolder ? <><FolderIcon className="w-3.5 h-3.5 text-cyan-300 inline" /> {currentFolder}</> : 'root'}
            </div>
            <input
              value={createFolderName}
              onChange={(event) => setCreateFolderName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') handleCreateNewFolder(); }}
              placeholder="Folder name"
              data-swipe-nav-ignore="true"
              className="mt-3 w-full border border-white/10 bg-slate-950/80 text-slate-100 placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/10"
                onClick={() => { setNewFolderModalOpen(false); setCreateFolderName(''); }}
              >
                Cancel
              </button>
              <button
                className={`px-3 py-2 rounded-lg text-sm font-semibold ${createFolderName.trim() ? 'text-slate-950 bg-cyan-500 hover:bg-cyan-400' : 'text-slate-500 bg-slate-800 cursor-not-allowed'}`}
                onClick={handleCreateNewFolder}
                disabled={!createFolderName.trim()}
              >
                Create
              </button>
            </div>
           </div>
         </ModalFrame>
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
         filter={movePickerOpen ? moveFilter : filter}
         sort={movePickerOpen ? moveSort : sort}
         onChangeFilter={movePickerOpen ? setMoveFilterPartial : setFilter}
         onChangeSort={movePickerOpen ? setMoveSort : setSort}
         zIndex={movePickerOpen ? 2500 : 1600}
         hideTypeFilter={movePickerOpen}
       />
       {outputsWorkflowConfirmFile && createPortal(
         <Dialog
           fullscreen={viewerOpen}
           onClose={handleOutputsWorkflowCancel}
           title="Unsaved changes"
           description="Are you sure you want to load this workflow? You have unsaved changes."
           actions={[
             {
               label: 'Cancel',
               onClick: handleOutputsWorkflowCancel,
               variant: 'secondary'
             },
             {
               label: 'Continue',
               onClick: () => { void handleOutputsWorkflowConfirm(); },
               variant: 'danger'
             }
           ]}
         />,
         document.body
       )}
       <MediaViewer
         open={viewerOpen}
         items={viewerImages}
         index={viewerIndex}
         onClose={handleOutputsViewerClose}
         onIndexChange={setViewerIndex}
         onDelete={handleOutputsViewerDelete}
         onLoadInWorkflow={handleOutputsViewerLoadInWorkflow}
         onLoadWorkflow={handleOutputsViewerLoadWorkflow}
         onToggleFavorite={(item) => item.file && toggleFavorite(item.file.id)}
         isFavorited={(item) => Boolean(item.file && favorites.includes(item.file.id))}
         onDownload={(item) => item.src && void shareOrDownloadFile(item.src, item.filename || item.file?.name || 'image.png')}
         showMetadataToggle
        />
      </div>
    </div>
  );
});
