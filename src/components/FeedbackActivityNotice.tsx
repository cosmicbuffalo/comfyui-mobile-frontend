import { useState } from 'react';
import { FeedbackReplyDialog } from '@/components/FeedbackReplyDialog';
import { XMarkIcon } from '@/components/icons';
import { feedbackIssueUrl } from '@/utils/feedbackUrl';
import { hasUnseenActivity, useFeedbackFollowsStore } from '@/hooks/useFeedbackFollows';
import { useI18n } from '@/i18n';

/**
 * Banner for new activity on feedback this server follows (see
 * useFeedbackActivityCheck). Sending a reply or dismissing marks it seen;
 * viewing doesn't, so the user can read the thread and come back to reply.
 */
export function FeedbackActivityNotice({ hidden }: { hidden: boolean }) {
  const { t } = useI18n();
  const follows = useFeedbackFollowsStore((s) => s.follows);
  const statuses = useFeedbackFollowsStore((s) => s.statuses);
  const markSeen = useFeedbackFollowsStore((s) => s.markSeen);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);

  const replyFollow = follows.find((f) => f.number === replyingTo);
  const follow = follows.find((f) => hasUnseenActivity(f, statuses[f.number]));
  // Locked issues take no replies, and a mentioned GitHub user replies on GitHub.
  const canReply = !!follow && follow.canReply && !statuses[follow.number]?.locked;
  const seen = (number: number) => {
    markSeen(number).catch(() => {});
  };

  return (
    <>
      {follow && !hidden && replyingTo == null && (
        <div
          className="fixed inset-x-0 z-[2000] flex justify-center px-4 pointer-events-none"
          style={{ top: 'calc(var(--top-bar-offset, 69px) + 1rem)' }}
        >
          <div className="relative w-full max-w-sm rounded-lg border border-white/10 bg-slate-900/95 px-3 py-3 text-slate-100 shadow-lg pointer-events-auto">
            <button
              type="button"
              onClick={() => seen(follow.number)}
              aria-label={t('Dismiss')}
              className="absolute -top-3.5 -right-3.5 w-7 h-7 rounded-full flex items-center justify-center bg-slate-800 border border-white/15 text-slate-300 shadow-md hover:text-white hover:bg-slate-700"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
            <p className="pr-2 text-sm text-slate-200">
              {t("There's new activity on your feedback #{number}.", { number: follow.number })}
            </p>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <a
                href={feedbackIssueUrl(follow.number)}
                target="_blank"
                rel="noopener noreferrer"
                className={`${canReply ? '' : 'col-span-2 '}rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-center text-xs font-medium text-slate-200 hover:bg-white/10`}
              >
                {t('View')}
              </a>
              {canReply && (
                <button
                  type="button"
                  onClick={() => setReplyingTo(follow.number)}
                  className="rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400"
                >
                  {t('Reply')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {replyFollow && (
        <FeedbackReplyDialog
          follow={replyFollow}
          onSent={() => seen(replyFollow.number)}
          onClose={() => setReplyingTo(null)}
        />
      )}
    </>
  );
}
