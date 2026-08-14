import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MediaViewer } from './ImageViewer/MediaViewer';
import { MAX_WORKFLOW_SESSIONS, useWorkflowStore, isWorkflowModified } from '@/hooks/useWorkflow';
import { useNavigationStore } from '@/hooks/useNavigation';
import { useImageViewerStore } from '@/hooks/useImageViewer';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { useOutputsStore } from '@/hooks/useOutputs';
import { useOverallProgress } from '@/hooks/useOverallProgress';
import { useHistoryWorkflowByFileId } from '@/hooks/useHistoryWorkflowByFileId';
import { buildOutputPreferredViewerImages, getHistoryImageFileId, type ViewerImage } from '@/utils/viewerImages';
import { deleteFile, type FileItem } from '@/api/client';
import { shareOrDownloadFile } from '@/utils/downloads';
import { Dialog } from '@/components/modals/Dialog';
import { UseImageModal } from '@/components/modals/UseImageModal';
import { useI18n } from '@/i18n';
import {
  loadWorkflowFromFile,
  resolveFilePath,
  resolveFileSource,
  resolveViewerItemWorkflowLoad,
} from '@/utils/workflowOperations';

interface ImageViewerProps {
  onClose: () => void;
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      window.setTimeout(resolve, 0);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function ImageViewer({ onClose }: ImageViewerProps) {
  const { t } = useI18n();
  const open = useImageViewerStore((s) => s.viewerOpen);
  const images = useImageViewerStore((s) => s.viewerImages);
  const index = useImageViewerStore((s) => s.viewerIndex);
  const initialScale = useImageViewerStore((s) => s.viewerScale);
  const initialTranslate = useImageViewerStore((s) => s.viewerTranslate);
  const followQueueActive = useWorkflowStore((s) => s.followQueue);
  const setViewerState = useImageViewerStore((s) => s.setViewerState);
  const workflow = useWorkflowStore((s) => s.workflow);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  const sessions = useWorkflowStore((s) => s.sessions);
  const activeSessionId = useWorkflowStore((s) => s.activeSessionId);
  const promptToSession = useWorkflowStore((s) => s.promptToSession);
  const workflowDurationStats = useWorkflowStore((s) => s.workflowDurationStats);
  const isExecuting = useWorkflowStore((s) => s.isExecuting);
  const executingPromptId = useWorkflowStore((s) => s.executingPromptId);
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const running = useQueueStore((s) => s.running);
  const pending = useQueueStore((s) => s.pending);
  const livePromptOutputs = useQueueStore((s) => s.livePromptOutputs);
  const localPromptOrder = useQueueStore((s) => s.localPromptOrder);
  const history = useHistoryStore((s) => s.history);
  const hasMoreHistory = useHistoryStore((s) => s.hasMoreHistory);
  const loadMoreHistory = useHistoryStore((s) => s.loadMoreHistory);
  const removeOutputImages = useHistoryStore((s) => s.removeOutputImages);
  const favorites = useOutputsStore((s) => s.favorites);
  const rejected = useOutputsStore((s) => s.rejected);
  const favoriteItem = useOutputsStore((s) => s.favoriteItem);
  const unfavoriteItem = useOutputsStore((s) => s.unfavoriteItem);
  const toggleRejected = useOutputsStore((s) => s.toggleRejected);
  const [deleteTarget, setDeleteTarget] = useState<{ file: FileItem; promptId?: string } | null>(null);
  const [loadWorkflowTarget, setLoadWorkflowTarget] = useState<ViewerImage | null>(null);
  const [loadNodeTarget, setLoadNodeTarget] = useState<FileItem | null>(null);
  const [loadNodeOpen, setLoadNodeOpen] = useState(false);
  const [loadWorkflowProgress, setLoadWorkflowProgress] = useState<number | null>(null);
  const lastFollowKeyRef = useRef<string | null>(null);
  const followQueueWasActiveRef = useRef(false);
  const nextFollowFinishOrderRef = useRef(1);
  const [followFinishOrder, setFollowFinishOrder] = useState<Record<string, number>>({});

  const isDirty = useMemo(
    () => isWorkflowModified(workflow, originalWorkflow),
    [workflow, originalWorkflow]
  );
  const canOpenWorkflowInNewTab =
    Boolean(activeSessionId && workflow) && sessions.length < MAX_WORKFLOW_SESSIONS;

  // Record a stable order for every prompt we track while follow mode is open,
  // the single source of "newest" for both the jump target and the browse
  // ordering. It must survive the live→history handoff (markPromptCompleted
  // deletes a prompt's livePromptOutputs the moment its history entry lands), so
  // it lives in component state keyed by prompt_id. Two capture sources, each
  // covering the other's blind spot:
  //   1. livePromptOutputs entries with a final `output` image — the websocket
  //      `executed` frame. Race-free: a fast prompt that leaves running/pending
  //      before an effect can observe it is still caught here.
  //   2. prompts seen in running/pending — covers a run whose output reaches us
  //      only via history (e.g. a fully-cached execution emits no `executed`
  //      output frame) yet was observed in the queue on this device.
  useEffect(() => {
    if (!open || !followQueueActive) {
      nextFollowFinishOrderRef.current = 1;
      setFollowFinishOrder({});
      return;
    }

    const inActiveSession = (promptId: string) => {
      // Same session scoping as the live list: a run finishing in another tab
      // must not be followed here. Unknown prompts fall back to the active tab.
      const sid = promptToSession[promptId];
      return sid == null || sid === activeSessionId;
    };

    // Insertion order of livePromptOutputs keys == order of `executed` frames ==
    // completion order. Queue observations extend it for prompts with no live
    // output frame. A prompt already stamped keeps its first-seen order.
    const trackedPromptIds = [
      ...Object.entries(livePromptOutputs)
        .filter(([promptId, outputs]) =>
          inActiveSession(promptId) && outputs.some((img) => img.type === 'output'))
        .map(([promptId]) => promptId),
      ...[...running, ...pending]
        .map((item) => item.prompt_id)
        .filter((promptId): promptId is string => Boolean(promptId) && inActiveSession(promptId)),
    ];
    if (trackedPromptIds.length === 0) return;

    setFollowFinishOrder((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const promptId of trackedPromptIds) {
        if (next[promptId] != null) continue;
        next[promptId] = nextFollowFinishOrderRef.current;
        nextFollowFinishOrderRef.current += 1;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [followQueueActive, open, livePromptOutputs, running, pending, promptToSession, activeSessionId]);

  // The active session's just-finished outputs (newest first), built from the
  // queue store's live outputs. Scoped to the active session so a run finishing
  // in another tab doesn't yank this viewer. Only final `output` images count —
  // preview/temp images (e.g. from PreviewImage nodes mid-run) must not trigger
  // jumps to in-progress previews. Empty unless the viewer + follow mode are on.
  const followQueueLiveItems = useMemo(() => {
    if (!open || !followQueueActive) return [];
    const historyByPromptId = new Map(history.map((item) => [item.prompt_id, item]));
    return Object.entries(livePromptOutputs)
      .filter(([promptId]) => {
        // Unknown prompts (e.g. queued from the desktop frontend) are attributed
        // to the active session, matching the websocket routing fallback.
        const sid = promptToSession[promptId];
        return sid == null || sid === activeSessionId;
      })
      .map(([promptId, outputs]) => [
        promptId,
        outputs.filter((img) => img.type === 'output'),
      ] as [string, typeof outputs])
      .filter(([promptId, outputs]) => {
        if (outputs.length === 0) return false;
        const historyItem = historyByPromptId.get(promptId);
        if (!historyItem) return true;
        const historyKeys = new Set(
          historyItem.outputs.images.map((img) => getHistoryImageFileId(img)),
        );
        return outputs.some((img) => !historyKeys.has(getHistoryImageFileId(img)));
      })
      // Newest first by completion order, falling back to submit order for a
      // just-arrived prompt whose finish-order effect hasn't committed yet. A
      // still-running prompt has no `output` images yet, so it's already excluded
      // above — no need to special-case running order.
      .sort(([a], [b]) => (
        (followFinishOrder[b] ?? localPromptOrder[b] ?? 0)
        - (followFinishOrder[a] ?? localPromptOrder[a] ?? 0)
      ))
      .map(([promptId, outputs]) => ({
        prompt_id: promptId,
        outputs: { images: outputs },
        prompt: {},
      }));
  }, [open, followQueueActive, history, livePromptOutputs, localPromptOrder, followFinishOrder, promptToSession, activeSessionId]);

  // History entries for prompts we saw finish while following (their live
  // outputs were handed off to history and deleted from livePromptOutputs).
  const followQueueFinishedHistoryItems = useMemo(() => {
    if (!open || !followQueueActive) return [];
    return history.filter(
      (item) => item.prompt_id && followFinishOrder[item.prompt_id] != null,
    );
  }, [followFinishOrder, followQueueActive, history, open]);

  // Browsable list. The followed items — live outputs plus finished-while-
  // following history — are MERGED and sorted by a single completion-order map so
  // index 0 is always the genuinely newest generation, regardless of whether its
  // image currently lives in the live map or has already been handed off to
  // history. A live item not yet assigned a finish order (its capture effect
  // hasn't committed) is treated as freshest so a just-arrived output still wins.
  // Global history follows for swiping back.
  const followQueueItems = useMemo(() => {
    if (!open || !followQueueActive) return [];
    const livePromptIds = new Set(followQueueLiveItems.map((item) => item.prompt_id));
    const orderOf = (promptId: string | undefined) =>
      (promptId != null ? followFinishOrder[promptId] : undefined) ?? Number.POSITIVE_INFINITY;
    const followed = [
      ...followQueueLiveItems,
      ...followQueueFinishedHistoryItems.filter((item) => !livePromptIds.has(item.prompt_id)),
    ].sort((a, b) => orderOf(b.prompt_id) - orderOf(a.prompt_id));
    const followedPromptIds = new Set(followed.map((item) => item.prompt_id));
    return [
      ...followed,
      ...history.filter((item) => !followedPromptIds.has(item.prompt_id)),
    ];
  }, [open, followQueueActive, followQueueLiveItems, followQueueFinishedHistoryItems, followFinishOrder, history]);

  const followQueueViewerImages = useMemo(
    () => buildOutputPreferredViewerImages(followQueueItems, { alt: t('Generation') }),
    [followQueueItems, t],
  );

  // Jump trigger: the newest followed output (index 0 of the merged list above).
  // Only a followed prompt — one with a live output or a recorded finish order —
  // yanks the viewer; a plain history refresh (index 0 is untracked history) does
  // not. Keeping this in lockstep with followQueueItems[0] guarantees the jump
  // shows the same image the key was computed from.
  const followQueueLatestKey = useMemo(() => {
    const latest = followQueueItems[0];
    if (!latest?.prompt_id) return null;
    const isFollowed =
      followFinishOrder[latest.prompt_id] != null
      || followQueueLiveItems.some((item) => item.prompt_id === latest.prompt_id);
    if (!isFollowed) return null;
    const latestImages = latest.outputs?.images ?? [];
    if (latestImages.length === 0) return null;
    const outputKey = latestImages
      .map((img) => getHistoryImageFileId(img))
      .join('|');
    return `${latest.prompt_id}:${outputKey}`;
  }, [followQueueItems, followFinishOrder, followQueueLiveItems]);

  const followQueueSwitchId = followQueueItems[0]?.prompt_id ?? null;

  const runKey = executingPromptId || (running.length === 1 ? running[0].prompt_id : null);
  // Live latent preview for the run in flight (global store, keyed by prompt_id
  // — the same source the queue card renders). Only used for the placeholder
  // below; an output already on screen is never covered by a preview.
  const latentPreviewEntry = useWorkflowStore(
    (s) => (runKey ? s.latentPreviewByPrompt?.[runKey] : undefined),
  );
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
  // Nothing to show yet (follow mode opened before this tab's first output
  // landed): paint the sampler's live latent preview behind the progress bar so
  // the wait shows the run taking shape rather than a bare spinner. Null when
  // latent previews are off in Preferences — the bare spinner then stands.
  const loadingPreviewSrc = showLoadingPlaceholder && isGenerating
    ? latentPreviewEntry?.url ?? null
    : null;
  const historyWorkflowByFileId = useHistoryWorkflowByFileId();

  // Clear any open modal state when the viewer closes, so reopening doesn't
  // surface a stale confirmation/use-image modal that was open at close time.
  useEffect(() => {
    if (open) return;
    setDeleteTarget(null);
    setLoadWorkflowTarget(null);
    setLoadNodeTarget(null);
    setLoadNodeOpen(false);
  }, [open]);

  // Auto-jump to this tab's newest output as the queue progresses. On the
  // !active → active transition we only seed the ref (don't yank to whatever is
  // currently newest); thereafter a changed key means a fresh output arrived.
  //
  // Both of those rules are suspended while the viewer is displaying NOTHING
  // (follow mode opened with an empty history, so App had no images to seed):
  // there is no user-chosen image to preserve, and the alternative is the bare
  // loading placeholder forever. Without this, a followed output that already
  // existed when follow mode opened — or one whose jump was missed — could
  // never reach the screen, because the only path out of the empty state was a
  // *change* in the latest key.
  useEffect(() => {
    if (!open || !followQueueActive) {
      lastFollowKeyRef.current = null;
      followQueueWasActiveRef.current = false;
      return;
    }
    const nothingDisplayed = images.length === 0;
    if (!followQueueWasActiveRef.current) {
      followQueueWasActiveRef.current = true;
      if (!nothingDisplayed) {
        lastFollowKeyRef.current = followQueueLatestKey;
        return;
      }
    }
    if (!followQueueLatestKey) return;
    if (followQueueLatestKey === lastFollowKeyRef.current && !nothingDisplayed) return;
    if (followQueueViewerImages.length === 0) return;

    lastFollowKeyRef.current = followQueueLatestKey;
    setViewerState({
      viewerImages: followQueueViewerImages,
      viewerIndex: 0,
      viewerScale: 1,
      viewerTranslate: { x: 0, y: 0 },
    });
  }, [open, followQueueActive, followQueueLatestKey, followQueueViewerImages, images, setViewerState]);

  // As older history pages load in (they append to the end of the follow-queue
  // list), extend the browsable list so the user can keep arrowing past where
  // they were. Only extend an already-populated list (App owns the initial
  // display — never seed from empty here) and only when the front is unchanged;
  // a changed front means a fresh output arrived, which the auto-jump effect
  // above owns (it resets to index 0).
  useEffect(() => {
    if (!open || !followQueueActive) return;
    if (images.length === 0) return;
    if (followQueueViewerImages.length <= images.length) return;
    if (followQueueViewerImages[0]?.src !== images[0]?.src) return;
    setViewerState({ viewerImages: followQueueViewerImages });
  }, [open, followQueueActive, followQueueViewerImages, images, setViewerState]);

  const handleIndexChange = (nextIndex: number) => {
    setViewerState({ viewerIndex: nextIndex });
    // Mirror the queue panel's scroll-to-load: while following the live queue,
    // navigating within 5 of the end of the loaded runs pulls the next history
    // page so the user can keep arrowing back. loadMoreHistory self-guards
    // against overlapping/last-page loads.
    if (followQueueActive && hasMoreHistory && nextIndex >= images.length - 5) {
      void loadMoreHistory();
    }
  };

  const handleTransformChange = (nextScale: number, nextTranslate: { x: number; y: number }) => {
    setViewerState({ viewerScale: nextScale, viewerTranslate: nextTranslate });
  };

  const handleDeleteRequest = (item: ViewerImage) => {
    if (!item.file) return;
    setDeleteTarget({ file: item.file, promptId: item.promptId });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const { file: deletedFile } = deleteTarget;
    try {
      const filePath = resolveFilePath(deletedFile);
      await deleteFile(filePath, resolveFileSource(deletedFile));

      // Remove just this image from any history (queue) entry that references
      // it. The entry's card stays as long as it still has other outputs, and is
      // deleted outright only when this was its last image — so deleting one
      // frame of a batch no longer drops the whole card. Keyed by file id, so
      // promptId isn't required (a browsed output still reconciles).
      await removeOutputImages([deletedFile.id]);

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
      window.alert(t('Failed to delete file.'));
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleLoadWorkflowRequest = (item: ViewerImage) => {
    if (!item.file && !item.workflow) return;
    if (isDirty && !canOpenWorkflowInNewTab) {
      setLoadWorkflowTarget(item);
      return;
    }
    void handleLoadWorkflowWithProgress(item);
  };

  const handleLoadWorkflow = async (item: ViewerImage, options?: { navigate?: boolean }) => {
    const navigate = options?.navigate !== false;
    try {
      const resolvedWorkflowLoad = resolveViewerItemWorkflowLoad(
        item,
        historyWorkflowByFileId,
      );
      if (resolvedWorkflowLoad) {
        loadWorkflow(
          resolvedWorkflowLoad.workflow,
          resolvedWorkflowLoad.filename,
          { source: resolvedWorkflowLoad.source, navigate },
        );
        if (navigate) {
          onClose();
          queueMicrotask(() => setCurrentPanel('workflow'));
        }
        return true;
      }
      if (!item.file) return false;
      let loaded = false;
      await loadWorkflowFromFile({
        file: item.file,
        loadWorkflow: (workflowToLoad, filename, loadOptions) => {
          loadWorkflow(workflowToLoad, filename, {
            ...loadOptions,
            navigate,
          });
          loaded = true;
        },
        onLoaded: () => {
          if (navigate) {
            onClose();
            queueMicrotask(() => setCurrentPanel('workflow'));
          }
        },
      });
      return loaded;
    } catch (err) {
      console.error('Failed to load workflow from file:', err);
      window.alert('Failed to load workflow from file.');
      return false;
    } finally {
      setLoadWorkflowTarget(null);
    }
  };

  const handleLoadWorkflowWithProgress = async (item: ViewerImage) => {
    if (loadWorkflowProgress != null) return;
    setLoadWorkflowProgress(12);
    await waitForPaint();
    setLoadWorkflowProgress(55);
    await waitForPaint();
    const loaded = await handleLoadWorkflow(item, { navigate: false });
    if (!loaded) {
      // Load failed (or there was no workflow) — stay in the viewer instead of
      // closing it and navigating to an unchanged workflow panel.
      setLoadWorkflowProgress(null);
      return;
    }
    setLoadWorkflowProgress(100);
    await waitForPaint();
    await sleep(90);
    setLoadWorkflowProgress(null);
    onClose();
    queueMicrotask(() => setCurrentPanel('workflow'));
  };

  const handleLoadInWorkflow = (item: ViewerImage) => {
    if (!item.file || item.file.type !== 'image') return;
    setLoadNodeTarget(item.file);
    setLoadNodeOpen(true);
  };

  const handleToggleFavorite = (item: ViewerImage) => {
    if (!item.file) return;
    favoriteItem(item.file.id);
  };

  // The `x` affordance: unfavorite a favorited item, otherwise toggle rejected.
  const handleReject = (item: ViewerImage) => {
    if (!item.file) return;
    const id = item.file.id;
    if (favorites.includes(id)) {
      unfavoriteItem(id);
    } else {
      toggleRejected(id);
    }
  };

  const isItemFavorited = (item: ViewerImage): boolean => {
    if (!item.file) return false;
    return favorites.includes(item.file.id);
  };

  const isItemRejected = (item: ViewerImage): boolean => {
    if (!item.file) return false;
    return rejected.includes(item.file.id);
  };

  const handleDownload = (item: ViewerImage) => {
    if (!item.src) return Promise.resolve(undefined);
    const filename = item.filename || item.file?.name || 'image.png';
    // Return the promise so the DownloadButton can keep its spinner up until
    // the native save completes, AND so MediaViewer can show its in-viewer
    // "Saving to Photos…" / "Saved to Photos." toast on the resolved outcome.
    return shareOrDownloadFile(item.src, filename);
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
        onToggleFavorite={handleToggleFavorite}
        isFavorited={isItemFavorited}
        onReject={handleReject}
        isRejected={isItemRejected}
        onDownload={handleDownload}
        showMetadataToggle
        showLoadingPlaceholder={showLoadingPlaceholder}
        loadingPreviewSrc={loadingPreviewSrc}
        loadingProgress={displayProgress}
        loadingLabel={isGenerating ? `${displayProgress}%` : t('Waiting for output')}
        loadWorkflowProgress={loadWorkflowProgress}
        initialScale={initialScale}
        initialTranslate={initialTranslate}
        onTransformChange={handleTransformChange}
        zoomResetKey={followQueueSwitchId}
      />
      {loadWorkflowTarget && createPortal(
        <Dialog
          fullscreen
          background="translucent"
          onClose={() => setLoadWorkflowTarget(null)}
          title={t('Unsaved changes')}
          description={t('Are you sure you want to load this workflow? You have unsaved changes.')}
          actions={[
            {
              label: t('Cancel'),
              onClick: () => setLoadWorkflowTarget(null),
              variant: 'secondary'
            },
            {
              label: t('Continue'),
              autoFocus: true,
              onClick: () => {
                void (async () => {
                  await handleLoadWorkflowWithProgress(loadWorkflowTarget);
                  setLoadWorkflowTarget(null);
                })();
              },
              variant: 'danger'
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
        background="translucent"
      />
      {deleteTarget && createPortal(
        <Dialog
          fullscreen
          background="translucent"
          onClose={() => setDeleteTarget(null)}
          title={t('Delete file?')}
          description={t('This will permanently delete "{name}" from the server. This cannot be undone.', { name: deleteTarget.file.name })}
          actions={[
            {
              label: t('Cancel'),
              onClick: () => setDeleteTarget(null),
              variant: 'secondary'
            },
            {
              label: t('Delete'),
              autoFocus: true,
              onClick: () => { void handleDeleteConfirm(); },
              variant: 'danger'
            }
          ]}
        />,
        document.body
      )}
    </>
  );
}
