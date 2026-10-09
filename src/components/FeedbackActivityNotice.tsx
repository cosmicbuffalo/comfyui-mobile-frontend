import { useState } from 'react';
import { appChromePrimaryButtonClassName } from '@/components/chromeStyles';
import { FeedbackReplyDialog } from '@/components/FeedbackReplyDialog';
import { REPO_URL } from '@/constants';
import { hasUnseenActivity, useFeedbackFollowsStore } from '@/hooks/useFeedbackFollows';
import { useI18n } from '@/i18n';

/**
 * Banner for new activity on feedback this server follows (see
 * useFeedbackActivityCheck). Viewing, replying, or dismissing marks it seen.
 */
export function FeedbackActivityNotice({ hidden }: { hidden: boolean }) {
  const { t } = useI18n();
  const follows = useFeedbackFollowsStore((s) => s.follows);
  const statuses = useFeedbackFollowsStore((s) => s.statuses);
  const markSeen = useFeedbackFollowsStore((s) => s.markSeen);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);

  const replyFollow = follows.find((f) => f.number === replyingTo);
  const follow = follows.find((f) => hasUnseenActivity(f, statuses[f.number]));
  const seen = (number: number) => {
    markSeen(number).catch(() => {});
  };

  return (
    <>
      {follow && !hidden && replyingTo == null && (
        <div
          className="fixed inset-x-0 z-[2000] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-slate-700 bg-slate-900/95 px-4 py-2"
          style={{ top: 'var(--top-bar-offset, 69px)' }}
        >
          <span className="text-xs text-slate-200">
            {t("There's new activity on your feedback #{number}.", { number: follow.number })}
          </span>
          <a
            href={`${REPO_URL}/issues/${follow.number}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => seen(follow.number)}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${appChromePrimaryButtonClassName}`}
          >
            {t('View')}
          </a>
          {!statuses[follow.number]?.locked && (
            <button
              type="button"
              onClick={() => setReplyingTo(follow.number)}
              className="rounded-md px-3 py-1 text-xs font-medium text-slate-200 hover:bg-white/10"
            >
              {t('Reply')}
            </button>
          )}
          <button
            type="button"
            onClick={() => seen(follow.number)}
            aria-label={t('Dismiss')}
            className="px-1 text-sm text-slate-400"
          >
            ✕
          </button>
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
