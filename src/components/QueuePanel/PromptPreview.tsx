import { useMemo, useState, type ReactNode } from 'react';
import type { Workflow } from '@/api/types';
import { useQueueStore } from '@/hooks/useQueue';
import { Collapsible } from '@/components/Collapsible';
import { FoldIcon } from '@/components/FoldIcon';
import { CloudDownloadIcon } from '@/components/icons';
import {
  computeQueueWorkflowDiff,
  type DiffSegment,
  type QueueWorkflowDiff,
} from '@/utils/workflowDiff';

export interface PromptPreviewInputImage {
  /** Stable key for the rendered thumbnail. */
  key: string;
  /** Full-resolution URL, used for click/viewer identity. */
  src: string;
  /** Preview URL displayed in the thumbnail. */
  displaySrc: string;
  /** Whether this image has already been downloaded to the device. */
  isDownloaded: boolean;
  /** Index into the card's media list, forwarded to the click handler. */
  index: number;
}

interface PromptPreviewProps {
  promptId: string;
  // Namespace for this card's scroll-anchor ids, so the preview's rows can be
  // pinned individually when the user is scrolled to one of them.
  anchorBaseId: string;
  // The workflow embedded in the queue item, used as a fallback to show full
  // prompt text (without highlights) when no diff was recorded at enqueue time.
  workflow?: Workflow;
  // Input images for this prompt, rendered as a folded "Inputs" chunk at the
  // bottom of the preview box.
  inputImages?: PromptPreviewInputImage[];
  onInputImageClick?: (src: string, index: number) => void;
}

function DiffText({ segments }: { segments: DiffSegment[] }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'added') {
          return (
            <span key={i} className="rounded-sm bg-emerald-500/25 text-emerald-100">
              {seg.text}
            </span>
          );
        }
        if (seg.type === 'removed') {
          return (
            <span
              key={i}
              className="rounded-sm bg-red-500/25 text-red-200 line-through decoration-red-300/60"
            >
              {seg.text}
            </span>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </>
  );
}

/**
 * A single foldable prompt-preview chunk: a clickable label row with a rotating
 * fold icon, plus content that slides open/closed via <Collapsible>.
 */
function FoldChunk({
  label,
  labelClassName,
  iconClassName,
  defaultOpen = true,
  anchorId,
  children,
}: {
  label: ReactNode;
  labelClassName?: string;
  iconClassName?: string;
  defaultOpen?: boolean;
  anchorId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div data-scroll-anchor-id={anchorId}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        data-queue-fold-anchor
        className="flex w-full items-center gap-1 text-left"
      >
        <FoldIcon open={open} className={`h-6 w-6 shrink-0 ${iconClassName ?? 'text-slate-500'}`} />
        <span className={labelClassName}>{label}</span>
      </button>
      <Collapsible open={open}>
        <div className="pt-1">{children}</div>
      </Collapsible>
    </div>
  );
}

export function PromptPreview({
  promptId,
  anchorBaseId,
  workflow,
  inputImages = [],
  onInputImageClick,
}: PromptPreviewProps) {
  const storedDiff = useQueueStore((s) => s.workflowDiffs[promptId]);
  const [sectionOpen, setSectionOpen] = useState(false);

  const diff = useMemo<QueueWorkflowDiff | null>(() => {
    if (storedDiff) return storedDiff;
    if (workflow) return computeQueueWorkflowDiff(null, workflow);
    return null;
  }, [storedDiff, workflow]);

  const hasNodeChanges = Boolean(diff && diff.nodeChanges.length > 0);
  const hasPrompts = Boolean(diff && diff.prompts.length > 0);
  const hasInputs = inputImages.length > 0;

  if (!hasNodeChanges && !hasPrompts && !hasInputs) {
    return null;
  }

  return (
    <div className="border-b border-white/10 bg-slate-950/55 px-3 py-3">
      <button
        type="button"
        onClick={() => setSectionOpen((prev) => !prev)}
        data-queue-fold-anchor
        data-scroll-anchor-id={`${anchorBaseId}::preview`}
        className={`flex w-full items-center gap-1 text-left ${sectionOpen ? 'mb-2' : ''}`}
      >
        <FoldIcon open={sectionOpen} className="h-6 w-6 shrink-0 text-slate-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Prompt preview
        </span>
      </button>
      <Collapsible open={sectionOpen}>
        <div
          className="max-h-[40vh] space-y-3 overflow-y-auto pr-1"
          style={{ overflowAnchor: 'none' }}
        >
          {hasNodeChanges && diff && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Changes
              </div>
              {diff.nodeChanges.map((node) => (
                <FoldChunk
                  key={node.nodeId}
                  anchorId={`${anchorBaseId}::change::${node.nodeId}`}
                  label={node.label}
                  labelClassName="text-[11px] font-semibold text-amber-300"
                  iconClassName="text-amber-300/70"
                >
                  <div className="space-y-1 text-sm leading-snug">
                    {node.changes.map((change, i) => (
                      <div
                        key={`${change.field}-${i}`}
                        className="rounded bg-black/20 px-2 py-1 text-xs text-slate-300 [overflow-wrap:anywhere]"
                      >
                        <span className="text-slate-500">{change.field}: </span>
                        <span className="rounded-sm bg-red-500/20 px-1 text-red-200 line-through decoration-red-300/50">
                          {change.before || '∅'}
                        </span>
                        <span className="px-1 text-slate-500">→</span>
                        <span className="rounded-sm bg-emerald-500/20 px-1 text-emerald-100">
                          {change.after || '∅'}
                        </span>
                      </div>
                    ))}
                  </div>
                </FoldChunk>
              ))}
            </div>
          )}

          {hasPrompts && diff && (
            <div className="space-y-2">
              {hasNodeChanges && (
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Prompts
                </div>
              )}
              {diff.prompts.map((prompt) => (
                <FoldChunk
                  key={prompt.nodeId}
                  anchorId={`${anchorBaseId}::prompt::${prompt.nodeId}`}
                  label={prompt.label}
                  labelClassName="text-[11px] font-semibold text-cyan-300"
                  iconClassName="text-cyan-300/70"
                >
                  <div className="rounded bg-black/20 px-2 py-1.5 text-sm leading-snug text-slate-200 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    <DiffText segments={prompt.segments} />
                  </div>
                </FoldChunk>
              ))}
            </div>
          )}

          {hasInputs && (
            <FoldChunk
              label="Inputs"
              anchorId={`${anchorBaseId}::inputs`}
              labelClassName="text-[11px] font-semibold text-amber-300"
              iconClassName="text-amber-300/70"
              defaultOpen={false}
            >
              <div className="grid grid-cols-2 gap-1">
                {inputImages.map((img) => (
                  <div key={img.key} className="relative">
                    <img
                      src={img.displaySrc}
                      alt="Generation input"
                      className="aspect-square w-full rounded object-cover"
                      loading="lazy"
                      onClick={() => onInputImageClick?.(img.src, img.index)}
                    />
                    {img.isDownloaded && (
                      <div className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white">
                        <CloudDownloadIcon className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </FoldChunk>
          )}
        </div>
      </Collapsible>
    </div>
  );
}
