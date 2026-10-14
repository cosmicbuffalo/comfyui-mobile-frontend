import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { FeedbackFollow, SystemStats } from '@/api/client';
import type { Workflow } from '@/api/types';
import { FeedbackReplyDialog } from '@/components/FeedbackReplyDialog';
import { ExternalLinkIcon, MegaphoneIcon, PlusIcon, ReplyIcon, TrashIcon } from '@/components/icons';
import { Dialog } from '@/components/modals/Dialog';
import { FullscreenModalHeader } from '@/components/modals/FullscreenModalHeader';
import { Z_LAYERS } from '@/components/zLayers';
import { feedbackIssueUrl } from '@/utils/feedbackUrl';
import { hasUnseenActivity, useFeedbackFollowsStore } from '@/hooks/useFeedbackFollows';
import type { FeedbackIssueStatus } from '@/utils/feedbackApi';
import { useI18n } from '@/i18n';
import { FeedbackDialog } from './FeedbackDialog';

/** Feedback this server follows, with view, reply and stop following, plus a way to send more. */
export function FeedbackHistoryPanel({
  systemStats,
  workflow,
  onClose,
}: {
  systemStats: SystemStats | null;
  workflow: Workflow | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const follows = useFeedbackFollowsStore((s) => s.follows);
  const statuses = useFeedbackFollowsStore((s) => s.statuses);
  const markSeen = useFeedbackFollowsStore((s) => s.markSeen);
  const [sendingNew, setSendingNew] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const replyFollow = follows.find((f) => f.number === replyingTo);

  if (sendingNew) {
    return <FeedbackDialog systemStats={systemStats} workflow={workflow} onClose={() => setSendingNew(false)} />;
  }

  // Unseen activity first, then newest first.
  const rows = follows
    .map((follow) => ({ follow, status: statuses[follow.number], unseen: hasUnseenActivity(follow, statuses[follow.number]) }))
    .sort((a, b) => Number(b.unseen) - Number(a.unseen) || b.follow.followedAt - a.follow.followedAt);

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 h-[100dvh] bg-slate-950 text-slate-100 flex flex-col safe-area-top"
      style={{ zIndex: Z_LAYERS.fullscreenPanel }}
    >
      <FullscreenModalHeader title={t('Feedback History')} onClose={onClose} />

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto w-full max-w-2xl space-y-2 pb-28">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-slate-900/95 p-6 text-center text-sm text-slate-400">
              <MegaphoneIcon className="w-6 h-6 text-slate-500" />
              {t("You aren't following any feedback.")}
            </div>
          ) : (
            rows.map(({ follow, status, unseen }) => (
              <FeedbackHistoryRow
                key={follow.number}
                follow={follow}
                status={status}
                unseen={unseen}
                onReply={() => setReplyingTo(follow.number)}
              />
            ))
          )}
        </div>
      </div>

      <div
        className="shrink-0 border-t border-white/10 bg-slate-900 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
      >
        <div className="mx-auto w-full max-w-2xl">
          <button
            type="button"
            onClick={() => setSendingNew(true)}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-950 bg-cyan-500 hover:bg-cyan-400"
          >
            <PlusIcon className="w-4 h-4" />
            {t('Send New Feedback')}
          </button>
        </div>
      </div>

      {replyFollow && (
        <FeedbackReplyDialog
          follow={replyFollow}
          onSent={() => {
            markSeen(replyFollow.number).catch(() => {});
          }}
          onClose={() => setReplyingTo(null)}
        />
      )}
    </div>,
    document.body,
  );
}

function FeedbackHistoryRow({
  follow,
  status,
  unseen,
  onReply,
}: {
  follow: FeedbackFollow;
  status: FeedbackIssueStatus | undefined;
  unseen: boolean;
  onReply: () => void;
}) {
  const { t } = useI18n();
  const unfollow = useFeedbackFollowsStore((s) => s.unfollow);
  const [unfollowStep, setUnfollowStep] = useState<'closed' | 'confirming' | 'stopping' | 'failed'>('closed');

  const state = status?.locked ? 'locked' : status?.state;
  const pill = state === 'locked'
    ? { label: t('Locked'), className: 'bg-amber-500/15 text-amber-200' }
    : state === 'closed'
      ? { label: t('Closed'), className: 'bg-violet-500/15 text-violet-200' }
      : state === 'open'
        ? { label: t('Open'), className: 'bg-emerald-500/15 text-emerald-200' }
        : null;

  return (
    <article
      className={`flex items-center gap-2 rounded-lg border bg-slate-900/95 py-2.5 pl-3 pr-2 ${
        unseen ? 'border-cyan-400/40 shadow-[inset_3px_0_0_0_rgb(34_211_238)]' : 'border-white/10'
      }`}
    >
      <div className="min-w-0 flex-1">
        <a
          href={feedbackIssueUrl(follow.number)}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-100"
        >
          <span className="truncate group-hover:underline">{follow.title}</span>
          <ExternalLinkIcon className="w-3.5 h-3.5 shrink-0 text-slate-500 group-hover:text-slate-300" />
        </a>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
          <span>#{follow.number}</span>
          {pill && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${pill.className}`}>{pill.label}</span>
          )}
          {unseen && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] font-semibold text-cyan-200">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
              {t('New activity')}
            </span>
          )}
        </div>
      </div>

      {follow.canReply && state !== 'locked' && (
        <button
          type="button"
          onClick={onReply}
          aria-label={t('Reply')}
          className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md bg-cyan-500 text-slate-950 hover:bg-cyan-400"
        >
          <ReplyIcon className="w-4 h-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setUnfollowStep('confirming')}
        aria-label={t('Stop following')}
        className="shrink-0 h-9 w-9 flex items-center justify-center rounded-md bg-red-500 text-slate-950 hover:bg-red-400"
      >
        <TrashIcon className="w-4 h-4" />
      </button>

      {unfollowStep !== 'closed' && (
        <Dialog
          onClose={() => setUnfollowStep('closed')}
          disableClose={unfollowStep === 'stopping'}
          zIndex={Z_LAYERS.panelDialog}
          fullscreen
          title={t('Stop following feedback #{number}?', { number: follow.number })}
          description={
            <div className="space-y-3">
              <p>{t("You won't see replies to it in the app anymore, and can't reply to it from here. The issue itself stays on GitHub.")}</p>
              {unfollowStep === 'failed' && (
                <p role="alert" className="text-sm text-red-200 bg-red-950/80 border border-red-400/20 rounded-lg p-2">
                  {t("Couldn't stop following. Check your connection and try again.")}
                </p>
              )}
            </div>
          }
          actions={[
            { label: t('Cancel'), onClick: () => setUnfollowStep('closed'), disabled: unfollowStep === 'stopping' },
            {
              label: t('Stop following'),
              variant: 'danger',
              disabled: unfollowStep === 'stopping',
              // On success the row, and this dialog with it, goes away.
              onClick: () => {
                setUnfollowStep('stopping');
                unfollow(follow.number).catch(() => setUnfollowStep('failed'));
              },
            },
          ]}
        />
      )}
    </article>
  );
}
