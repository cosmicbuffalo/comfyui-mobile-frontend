import { useEffect, useState } from 'react';
import { SlidePanel } from './SlidePanel';
import { useHistoryStore } from '@/hooks/useHistory';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { getImageUrl } from '@/api/client';
import type { Workflow } from '@/api/types';
import { buildViewerImages, type ViewerImage } from '@/utils/viewerImages';
import { downloadImage } from '@/utils/downloads';
import { CloudDownloadIcon, DocumentLinesIcon, EllipsisVerticalIcon, CheckIcon, XSmallIcon } from '@/components/icons';
import { HistoryImageMenu } from './history/HistoryImageMenu';
import { isVideoFilename } from '@/utils/media';

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  onImageClick?: (images: Array<ViewerImage>, index: number) => void;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

export function HistoryPanel({ open, onClose, onImageClick }: HistoryPanelProps) {
  const history = useHistoryStore((s) => s.history);
  const isLoading = useHistoryStore((s) => s.isLoading);
  const fetchHistory = useHistoryStore((s) => s.fetchHistory);
  const deleteItem = useHistoryStore((s) => s.deleteItem);
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const previewVisibility = useWorkflowStore((s) => s.previewVisibility);
  const previewVisibilityDefault = useWorkflowStore((s) => s.previewVisibilityDefault);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [menuState, setMenuState] = useState<{
    open: boolean;
    top: number;
    right: number;
    imageSrc: string;
    workflow?: Workflow;
    promptId?: string;
  } | null>(null);
  const viewerImages = buildViewerImages(history, {
    alt: (index) => `Output ${index + 1}`
  });

  useEffect(() => {
    if (!menuState?.open) return;
    const handleScroll = () => setMenuState(null);
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      const menuEl = document.getElementById('history-image-menu');
      if (menuEl && target && menuEl.contains(target)) return;
      setMenuState(null);
    };
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [menuState?.open]);

  useEffect(() => {
    if (open) {
      fetchHistory();
    }
  }, [open, fetchHistory]);

  const handleDelete = async (promptId: string) => {
    await deleteItem(promptId);
    if ('vibrate' in navigator) navigator.vibrate(10);
  };

  const handleDownload = async (src: string) => {
    await downloadImage(src, (downloadedSrc) => {
      setDownloaded((prev) => ({ ...prev, [downloadedSrc]: true }));
    });
  };

  return (
    <SlidePanel open={open} onClose={onClose} side="right" title="History">
      {isLoading && history.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading...</div>
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <div className="flex items-center justify-center mb-3">
            <DocumentLinesIcon className="w-10 h-10 text-gray-300" />
          </div>
          <p className="text-lg font-medium">No history yet</p>
          <p className="text-sm mt-1">Run a workflow to see results here</p>
        </div>
      ) : (
        <div className="space-y-4">
          {history.map((item) => (
            <div
              key={item.prompt_id}
              className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm"
            >
              {/* Timestamp */}
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                <span className="text-xs text-gray-500">
                  {formatTimestamp(item.timestamp)}
                </span>
              </div>

              {/* Images grid */}
              {item.outputs.images.length > 0 && (
                <div className="p-2">
                  {(() => {
                    const outputImages = item.outputs.images.filter((img) => img.type === 'output');
                    const previewImages = item.outputs.images.filter((img) => img.type !== 'output');
                    const hasSavedImages = outputImages.length > 0;
                    const hasPreviewImages = previewImages.length > 0;
                    const previewsVisible = Boolean(
                      item.prompt_id
                        ? previewVisibility[item.prompt_id] ?? previewVisibilityDefault
                        : previewVisibilityDefault
                    );
                    const shouldShowPreviews = previewsVisible || (!hasSavedImages && hasPreviewImages);
                    const displayImages = shouldShowPreviews ? [...outputImages, ...previewImages] : outputImages;

                    return (
                      <div className="grid grid-cols-2 gap-1.5">
                        {(() => {
                          let saveIndex = 0;
                          let previewIndex = 0;
                          return displayImages.slice(0, 4).map((img, idx) => {
                            const isPreview = img.type !== 'output';
                            const labelIndex = isPreview ? ++previewIndex : ++saveIndex;
                            const labelText = `${isPreview ? 'Preview' : 'Save'} #${labelIndex}`;
                          const durationLabel = formatDuration(item.durationSeconds);
                          const success = item.success !== false;
                          const src = getImageUrl(img.filename, img.subfolder, img.type);
                          return (
                            <div
                              key={idx}
                              className="relative"
                              onContextMenu={(event) => {
                                event.preventDefault();
                                const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                                const right = Math.max(8, window.innerWidth - rect.right);
                                setMenuState({
                                  open: true,
                                  top: rect.top + 8,
                                  right,
                                  imageSrc: src,
                                  workflow: item.workflow,
                                  promptId: item.prompt_id
                                });
                              }}
                              onClick={() => {
                                const targetIndex = viewerImages.findIndex((entry) => entry.src === src);
                                onImageClick?.(viewerImages, targetIndex >= 0 ? targetIndex : idx);
                              }}
                            >
                              {isVideoFilename(img.filename) ? (
                                <video
                                  src={src}
                                  className="w-full aspect-square object-cover rounded-lg bg-gray-100"
                                  muted
                                  loop
                                  playsInline
                                  preload="metadata"
                                />
                              ) : (
                                <img
                                  src={src}
                                  alt={`Output ${idx + 1}`}
                                  className="w-full aspect-square object-cover rounded-lg bg-gray-100"
                                  loading="lazy"
                                />
                              )}
                              <button
                                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                                  const right = Math.max(8, window.innerWidth - rect.right);
                                  setMenuState({
                                    open: true,
                                    top: rect.bottom + 6,
                                    right,
                                    imageSrc: src,
                                    workflow: item.workflow,
                                    promptId: item.prompt_id
                                  });
                                }}
                                aria-label="Image options"
                              >
                                <EllipsisVerticalIcon className="w-4 h-4 -rotate-90" />
                              </button>
                              <div
                                className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold ${
                                  success ? 'bg-green-600/90 text-white' : 'bg-red-600/90 text-white'
                                }`}
                              >
                                {success ? (
                                  <CheckIcon className="w-3.5 h-3.5" />
                                ) : (
                                  <XSmallIcon className="w-3.5 h-3.5" />
                                )}
                                <span>{durationLabel}</span>
                              </div>
                              {downloaded[src] && (
                                <div className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center">
                                  <CloudDownloadIcon className="w-4 h-4" />
                                </div>
                              )}
                              <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 text-white text-xs font-medium rounded backdrop-blur-sm shadow-sm pointer-events-none">
                                {labelText}
                              </div>
                            </div>
                          );
                          });
                        })()}
                      </div>
                    );
                  })()}
                  {item.outputs.images.length > 4 && (
                    <div className="text-center text-xs text-gray-500 mt-2">
                      +{item.outputs.images.length - 4} more images
                    </div>
                  )}
                </div>
              )}

              {item.outputs.images.length === 0 && (
                <div className="p-4 text-center text-gray-400 text-sm">
                  No images output
                </div>
              )}

            </div>
          ))}
        </div>
      )}

      <HistoryImageMenu
        menuState={menuState}
        onClose={() => setMenuState(null)}
        onLoadWorkflow={(workflow, promptId) => {
          loadWorkflow(workflow, `history-${promptId || 'workflow'}.json`);
          onClose();
        }}
        onDownload={handleDownload}
        onDelete={handleDelete}
      />
    </SlidePanel>
  );
}

function formatDuration(seconds?: number): string {
  const safeSeconds = seconds === undefined || Number.isNaN(seconds) ? 0 : seconds;
  if (safeSeconds < 10) return `${safeSeconds.toFixed(1)}s`;
  return `${Math.round(safeSeconds)}s`;
}
