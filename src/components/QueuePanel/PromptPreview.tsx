import { useMemo, useState, type ReactNode } from 'react';
import type { Workflow } from '@/api/types';
import { useQueueStore } from '@/hooks/useQueue';
import { Collapsible } from '@/components/Collapsible';
import { FoldIcon } from '@/components/FoldIcon';
import { useI18n } from '@/i18n';
import {
  collectQueueSeeds,
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
  /** Stable file id (getHistoryImageFileId). Carried for the per-device
   *  download-history badge, which ships with that feature in 3.1.1 — nothing
   *  in this release renders it. */
  fileId: string;
  /** Index into the card's media list, forwarded to the click handler. */
  index: number;
}

interface PromptPreviewProps {
  promptId: string;
  // Namespace for this card's scroll-anchor ids, so the preview's rows can be
  // pinned individually when the user is scrolled to one of them.
  anchorBaseId: string;
  // The workflow embedded in the queue item, used as a fallback to show full
  // prompt text (without highlights) when no diff was recorded at enqueue time,
  // and to name the nodes the seeds below belong to.
  workflow?: Workflow;
  // The API prompt this item was queued with, as the server hands it back. It
  // is where the seeds a run actually used are readable for an item that
  // predates the enqueue-time recording, or came from another device.
  prompt?: Record<string, unknown>;
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
  prompt,
  inputImages = [],
  onInputImageClick,
}: PromptPreviewProps) {
  const { t } = useI18n();
  const storedDiff = useQueueStore((s) => s.workflowDiffs[promptId]);
  const [sectionOpen, setSectionOpen] = useState(false);

  const diff = useMemo<QueueWorkflowDiff | null>(() => {
    if (storedDiff) return storedDiff;
    if (workflow) return computeQueueWorkflowDiff(null, workflow);
    return null;
  }, [storedDiff, workflow]);

  // Recorded at enqueue time when this client queued the run; otherwise read
  // back out of the prompt the server kept, which is what makes the seeds
  // readable for runs queued before this shipped or from another device.
  const seeds = useMemo(() => {
    const recorded = diff?.seeds;
    if (recorded && recorded.length > 0) return recorded;
    return prompt ? collectQueueSeeds(prompt, workflow) : [];
  }, [diff, prompt, workflow]);

  const hasNodeChanges = Boolean(diff && diff.nodeChanges.length > 0);
  const hasPrompts = Boolean(diff && diff.prompts.length > 0);
  const hasSeeds = seeds.length > 0;
  const hasInputs = inputImages.length > 0;

  if (!hasNodeChanges && !hasPrompts && !hasSeeds && !hasInputs) {
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
          {t('Prompt preview')}
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
                {t('Changes')}
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
                  {t('Prompts')}
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

          {hasSeeds && (
            <FoldChunk
              label={t('Seeds')}
              anchorId={`${anchorBaseId}::seeds`}
              labelClassName="text-[11px] font-semibold text-violet-300"
              iconClassName="text-violet-300/70"
            >
              <div className="space-y-1">
                {seeds.map((seed) => (
                  <div
                    key={`${seed.nodeId}::${seed.field}`}
                    className="queue-seed-row flex items-baseline justify-between gap-2 rounded bg-black/20 px-2 py-1 text-xs"
                  >
                    <span className="text-slate-400 [overflow-wrap:anywhere]">{seed.label}</span>
                    {/* select-all so a seed worth keeping can be tapped and copied. */}
                    <span className="queue-seed-value shrink-0 select-all font-mono text-slate-200">
                      {seed.value}
                    </span>
                  </div>
                ))}
              </div>
            </FoldChunk>
          )}

          {hasInputs && (
            <FoldChunk
              label={t('Inputs')}
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
                      alt={t('Generation input')}
                      className="aspect-square w-full rounded object-cover"
                      loading="lazy"
                      onClick={() => onInputImageClick?.(img.src, img.index)}
                    />
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
