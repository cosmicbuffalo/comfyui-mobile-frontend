import { useState } from 'react';
import type { FeedbackFollow } from '@/api/client';
import { Dialog } from '@/components/modals/Dialog';
import { Z_LAYERS } from '@/components/zLayers';
import { feedbackInputClassName } from '@/components/AppMenu/menuStyles';
import { FEEDBACK_ENDPOINT, submitFeedbackReply } from '@/utils/feedbackApi';
import { feedbackIssueUrl } from '@/utils/feedbackUrl';
import { t as globalT, useI18n } from '@/i18n';

type ReplyState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; url: string }
  | { kind: 'error'; message: string };

/** Posts a comment on a followed feedback issue as its original submitter. */
export function FeedbackReplyDialog({
  follow,
  onSent,
  onClose,
}: {
  follow: FeedbackFollow;
  onSent: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [reply, setReply] = useState<ReplyState>({ kind: 'idle' });
  const issueUrl = feedbackIssueUrl(follow.number);

  if (reply.kind === 'sent') {
    return (
      <Dialog
        onClose={onClose}
        zIndex={Z_LAYERS.panelDialog}
        fullscreen
        title={t('Reply posted')}
        description={
          <a
            href={reply.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-cyan-300 hover:text-cyan-200 hover:underline break-all"
          >
            {reply.url}
          </a>
        }
        actions={[{ label: t('Close'), onClick: onClose, variant: 'primary' }]}
      />
    );
  }

  const sending = reply.kind === 'sending';
  const canSend = body.trim().length >= 10 && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setReply({ kind: 'sending' });
    const result = await submitFeedbackReply(FEEDBACK_ENDPOINT, {
      number: follow.number,
      secret: follow.secret,
      body: body.trim(),
      website: website || undefined,
    });
    if (result.ok) {
      setReply({ kind: 'sent', url: result.url });
      onSent();
    } else {
      setReply({ kind: 'error', message: replyErrorMessage(result.error, result.status) });
    }
  };

  return (
    <Dialog
      onClose={onClose}
      disableClose={sending}
      zIndex={Z_LAYERS.panelDialog}
      // Covers the top bar too: from Feedback History, that's where the
      // history page's Close button is, and it must not unmount a sending reply.
      fullscreen
      size="lg"
      title={t('Reply to feedback #{number}', { number: follow.number })}
      description={
        <div className="space-y-3">
          <p>
            {follow.title}{' '}
            <a
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-300 hover:text-cyan-200 hover:underline"
            >
              {t('View on GitHub')}
            </a>
          </p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={8000}
            rows={5}
            placeholder={t('Reply anonymously to the public GitHub issue')}
            className={`${feedbackInputClassName} resize-y`}
          />
          {/* Honeypot — see FeedbackDialog. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
            <label>
              {t('Website (leave blank)')}
              <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>
          {reply.kind === 'error' && (
            <div role="alert" className="text-sm text-red-200 bg-red-950/80 border border-red-400/20 rounded-lg p-2">
              {reply.message}
            </div>
          )}
        </div>
      }
      actions={[
        { label: t('Cancel'), onClick: onClose, disabled: sending },
        { label: sending ? t('Sending...') : t('Send'), onClick: handleSend, variant: 'primary', disabled: !canSend },
      ]}
    />
  );
}

function replyErrorMessage(error: string, status?: number): string {
  switch (error) {
    case 'rate_limited':
      return globalT('Too many submissions in a short window. Please try again in a minute.');
    case 'issue_locked':
      return globalT('This issue is locked, so it no longer takes replies.');
    case 'reply_on_github':
      return globalT("You're mentioned on this issue, so reply there on GitHub.");
    case 'not_following':
      return globalT('The feedback service no longer recognizes this follow, so replies from here are off for this issue.');
    case 'timeout':
    case 'network_error':
      return globalT("Couldn't reach the feedback service. Check your connection and try again.");
    default:
      return status
        ? globalT('Reply failed (HTTP {status}). Please try again.', { status })
        : globalT('Reply failed. Please try again.');
  }
}
