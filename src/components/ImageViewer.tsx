import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MediaViewer } from './ImageViewer/MediaViewer';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import { useHistoryWorkflowByFileId } from '@/hooks/useHistoryWorkflowByFileId';
import { buildViewerImages, type ViewerImage } from '@/utils/viewerImages';
import { deleteFile, type FileItem } from '@/api/client';
import { Dialog } from '@/components/modals/Dialog';
import { UseImageModal } from '@/components/modals/UseImageModal';
import {
  loadWorkflowFromFile,
  resolveFilePath,
  resolveFileSource,
  resolveViewerItemWorkflowLoad,
} from '@/utils/workflowOperations';

interface ImageViewerProps {
  onClose: () => void;
}

export function ImageViewer({ onClose }: ImageViewerProps) {
  const open = useImageViewerStore((s) => s.viewerOpen);
  const images = useImageViewerStore((s) => s.viewerImages);
  const index = useImageViewerStore((s) => s.viewerIndex);
  const initialScale = useImageViewerStore((s) => s.viewerScale);
  const initialTranslate = useImageViewerStore((s) => s.viewerTranslate);
  const followQueueActive = useWorkflowStore((s) => s.followQueue);
  const setViewerState = useImageViewerStore((s) => s.setViewerState);
  const workflow = useWorkflowStore((s) => s.workflow);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const executingPromptId = useWorkflowStore((s) => s.executingPromptId);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const running = useQueueStore((s) => s.running);
  const history = useHistoryStore((s) => s.history);
  const [deleteTarget, setDeleteTarget] = useState<FileItem | null>(null);
  const [loadWorkflowTarget, setLoadWorkflowTarget] = useState<ViewerImage | null>(null);
  const [loadNodeTarget, setLoadNodeTarget] = useState<FileItem | null>(null);
  const [loadNodeOpen, setLoadNodeOpen] = useState(false);
  const lastFollowPromptRef = useRef<string | null>(null);

  const isDirty = useMemo(
    () => Boolean(workflow && originalWorkflow && JSON.stringify(workflow) !== JSON.stringify(originalWorkflow)),
    [workflow, originalWorkflow]
  );

  const followQueueSwitchId = useMemo(() => {
    if (!open || !followQueueActive) return null;
    return history[0]?.prompt_id ?? null;
  }, [open, followQueueActive, history]);

  const runKey = executingPromptId || (running.length === 1 ? running[0].prompt_id : null);
  const overallProgress = useOverallProgress({
    workflow,
    runKey,
    isRunning: isExecuting || running.length > 0,
    workflowDurationStats,
  });
  const isGenerating = isExecuting || running.length > 0;
  const displayProgress = Math.min(100, Math.max(0, overallProgress ?? 0));
  const current = index >= 0 ? (images[index] ?? images[0] ?? null) : null;
  const showLoadingPlaceholder = (!current && (followQueueActive || isGenerating)) || (index < 0 && isGenerating);
  const historyWorkflowByFileId = useHistoryWorkflowByFileId();

  useEffect(() => {
    if (!open || !followQueueActive) {
      lastFollowPromptRef.current = null;
      return;
    }
    if (!lastFollowPromptRef.current && history[0]?.prompt_id) {
      lastFollowPromptRef.current = history[0]?.prompt_id ?? null;
    }
  }, [open, followQueueActive, history]);

  useEffect(() => {
    if (!open || !followQueueActive) return;
    if (history.length === 0) return;
    const latest = history[0];
    if (lastFollowPromptRef.current === latest.prompt_id) return;
    if (latest.outputs.images.length === 0) return;

    const allImages = buildViewerImages(history, { alt: 'Generation' });
    if (allImages.length === 0) return;

    lastFollowPromptRef.current = latest.prompt_id;
    setViewerState({
      viewerImages: allImages,
      viewerIndex: 0,
      viewerScale: 1,
      viewerTranslate: { x: 0, y: 0 },
    });
  }, [open, followQueueActive, history, setViewerState]);

  const handleIndexChange = (nextIndex: number) => {
    setViewerState({ viewerIndex: nextIndex });
  };

  const handleTransformChange = (nextScale: number, nextTranslate: { x: number; y: number }) => {
    setViewerState({ viewerScale: nextScale, viewerTranslate: nextTranslate });
  };

  const handleDeleteRequest = (item: ViewerImage) => {
    if (!item.file) return;
    setDeleteTarget(item.file);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const deletedFile = deleteTarget;
    try {
      const filePath = resolveFilePath(deletedFile);
      await deleteFile(filePath, resolveFileSource(deletedFile));
      const nextImages = images.filter((entry) => entry.file?.id !== deletedFile.id);
      const deletedIndex = images.findIndex((entry) => entry.file?.id === deletedFile.id);
      const nextIndex = (() => {
        if (nextImages.length === 0) return 0;
        if (deletedIndex < 0) return index;
        if (deletedIndex < index) return index - 1;
        if (deletedIndex === index) return Math.min(index, nextImages.length - 1);
        return index;
      })();
      setViewerState({
        viewerImages: nextImages,
        viewerIndex: nextIndex,
      });
      if (nextImages.length === 0) {
        onClose();
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
      window.alert('Failed to delete file.');
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleLoadWorkflowRequest = (item: ViewerImage) => {
    if (!item.file && !item.workflow) return;
    if (isDirty) {
      setLoadWorkflowTarget(item);
      return;
    }
    void handleLoadWorkflow(item);
  };

  const handleLoadWorkflow = async (item: ViewerImage) => {
    try {
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
        onClose();
        queueMicrotask(() => setCurrentPanel('workflow'));
        return;
      }
      if (!item.file) return;
      await loadWorkflowFromFile({
        file: item.file,
        loadWorkflow,
        onLoaded: () => {
          onClose();
          queueMicrotask(() => setCurrentPanel('workflow'));
        },
      });
    } catch (err) {
      console.error('Failed to load workflow from file:', err);
      window.alert('Failed to load workflow from file.');
    } finally {
      setLoadWorkflowTarget(null);
    }
  };

  const handleLoadInWorkflow = (item: ViewerImage) => {
    if (!item.file || item.file.type !== 'image') return;
    setLoadNodeTarget(item.file);
    setLoadNodeOpen(true);
  };

  const handleLoadNodeClose = () => {
    setLoadNodeOpen(false);
    setLoadNodeTarget(null);
  };

  const handleLoadNodeComplete = () => {
    handleLoadNodeClose();
    onClose();
    queueMicrotask(() => setCurrentPanel('workflow'));
  };

  if (!open) return null;

  return (
    <>
      <MediaViewer
        open={open}
        items={images}
        index={index}
        onIndexChange={handleIndexChange}
        onClose={onClose}
        onDelete={handleDeleteRequest}
        onLoadWorkflow={handleLoadWorkflowRequest}
        onLoadInWorkflow={handleLoadInWorkflow}
        showMetadataToggle
        showLoadingPlaceholder={showLoadingPlaceholder}
        loadingProgress={displayProgress}
        loadingLabel={isGenerating ? `${displayProgress}%` : 'Waiting for output'}
        initialScale={initialScale}
        initialTranslate={initialTranslate}
        onTransformChange={handleTransformChange}
        zoomResetKey={followQueueSwitchId}
      />
      {loadWorkflowTarget && createPortal(
        <Dialog
          onClose={() => setLoadWorkflowTarget(null)}
          title="Unsaved changes"
          description="Are you sure you want to load this workflow? You have unsaved changes."
          actions={[
            {
              label: 'Cancel',
              onClick: () => setLoadWorkflowTarget(null),
              className: 'px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100'
            },
            {
              label: 'Continue',
              onClick: () => {
                void (async () => {
                  await handleLoadWorkflow(loadWorkflowTarget);
                  setLoadWorkflowTarget(null);
                })();
              },
              className: 'px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700'
            }
          ]}
        />,
        document.body
      )}
      <UseImageModal
        open={loadNodeOpen}
        file={loadNodeTarget}
        source={loadNodeTarget ? resolveFileSource(loadNodeTarget) : 'output'}
        onClose={handleLoadNodeClose}
        onLoaded={handleLoadNodeComplete}
      />
      {deleteTarget && createPortal(
        <Dialog
          onClose={() => setDeleteTarget(null)}
          title="Delete file?"
          description={`This will permanently delete "${deleteTarget.name}" from the server. This cannot be undone.`}
          actions={[
            {
              label: 'Cancel',
              onClick: () => setDeleteTarget(null),
              className: 'px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100'
            },
            {
              label: 'Delete',
              onClick: () => { void handleDeleteConfirm(); },
              className: 'px-3 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700'
            }
          ]}
        />,
        document.body
      )}
    </>
  );
}
