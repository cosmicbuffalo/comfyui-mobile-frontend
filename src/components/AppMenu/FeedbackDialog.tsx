import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { SystemStats } from '@/api/client';
import type { Workflow } from '@/api/types';
import { Dialog } from '@/components/modals/Dialog';
import { FullscreenModalHeader } from '@/components/modals/FullscreenModalHeader';
import { buildDiagnosticsBlock, buildFeedbackIssueUrl } from '@/utils/feedbackUrl';
import {
  FEEDBACK_ENDPOINT,
  isFeedbackEndpointConfigured,
  submitFeedback,
} from '@/utils/feedbackApi';
import { menuMutedTextClassName } from './menuStyles';

interface FeedbackDialogProps {
  systemStats: SystemStats | null;
  workflow: Workflow | null;
  onClose: () => void;
}

type SubmitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; url: string }
  | { kind: 'error'; message: string };

const FIELD_LABEL_CLASS = 'block text-xs font-medium text-slate-300 mb-1';
const FEEDBACK_FIELD_SURFACE_CLASS =
  'rounded-lg border border-slate-600/80 bg-slate-950 text-slate-300';
const INPUT_CLASS =
  `w-full px-3 py-2 text-sm placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 ${FEEDBACK_FIELD_SURFACE_CLASS}`;

export function FeedbackDialog({ systemStats, workflow, onClose }: FeedbackDialogProps) {
  const endpointConfigured = isFeedbackEndpointConfigured();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [contact, setContact] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>({ kind: 'idle' });

  const isSubmitting = submit.kind === 'submitting';
  const diagnosticsPreview = buildDiagnosticsBlock({ systemStats, workflow });
  const githubFallbackUrl = buildFeedbackIssueUrl(
    { systemStats, workflow },
    { includeDiagnostics },
    { title, body, contact },
  );

  const canSubmit =
    endpointConfigured &&
    title.trim().length > 0 &&
    body.trim().length >= 10 &&
    !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmit({ kind: 'submitting' });
    const result = await submitFeedback(FEEDBACK_ENDPOINT, {
      title: title.trim(),
      body: body.trim(),
      contact: contact.trim() || undefined,
      diagnostics: includeDiagnostics ? diagnosticsPreview : undefined,
      website: website || undefined,
    });
    if (result.ok) {
      setSubmit({ kind: 'success', url: result.url });
    } else {
      setSubmit({
        kind: 'error',
        message: errorMessageFor(result.error, result.status),
      });
    }
  };

  if (submit.kind === 'success') {
    return (
      <Dialog
        onClose={onClose}
        title="Thanks for the feedback!"
        description={
          <div className="space-y-3">
            <p>Your feedback was submitted as a GitHub issue.</p>
            <a
              href={submit.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-cyan-300 hover:text-cyan-200 hover:underline break-all"
            >
              {submit.url}
            </a>
          </div>
        }
        actions={[{ label: 'Close', onClick: onClose, variant: 'primary' }]}
      />
    );
  }

  const fallbackLink = (
    <a
      href={githubFallbackUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClose}
      className="text-cyan-300 hover:text-cyan-200 hover:underline"
    >
      open a GitHub issue directly
    </a>
  );

  if (!endpointConfigured) {
    return (
      <Dialog
        onClose={onClose}
        title="Send Feedback"
        description={
          <div className="space-y-3">
            <p>
              The in-app feedback service isn't configured for this build. You can still file an
              issue directly on GitHub.
            </p>
            <p>{fallbackLink}</p>
          </div>
        }
        actions={[{ label: 'Close', onClick: onClose, variant: 'secondary' }]}
      />
    );
  }

  return createPortal(
    <div className="fixed inset-x-0 top-0 z-[2600] h-[100dvh] bg-slate-950 text-slate-100 flex flex-col safe-area-top">
      <FullscreenModalHeader
        title="Send Feedback"
        onClose={onClose}
        closeDisabled={isSubmitting}
      />

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto w-full max-w-2xl space-y-3 pb-28">
          <p className="text-sm">
            Report a bug or request a feature. Your feedback becomes a public GitHub issue.
          </p>

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Short summary"
              className={INPUT_CLASS}
            />
          </label>

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>Description</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={8000}
              rows={5}
              placeholder="What happened? What were you trying to do? Steps to reproduce if it's a bug."
              className={`${INPUT_CLASS} resize-y`}
            />
          </label>

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>
              Contact <span className="text-slate-500 font-normal">(optional)</span>
            </span>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={200}
              placeholder="GitHub @username or email if you'd like a reply"
              className={INPUT_CLASS}
            />
            <span className={`block mt-1 text-xs ${menuMutedTextClassName}`}>
              GitHub handles get @-mentioned in the public issue. Anything else
              (emails, phone numbers, etc.) is forwarded privately to the maintainer
              and never appears in the issue body.
            </span>
          </label>

          {/* Honeypot — visually and a11y-hidden, but not display:none (some bots skip those). */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: 1, height: 1, overflow: 'hidden' }}>
            <label>
              Website (leave blank)
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
          </div>

          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400 focus:ring-cyan-400 focus:ring-offset-slate-900"
              checked={includeDiagnostics}
              onChange={(e) => setIncludeDiagnostics(e.target.checked)}
            />
            <span className="text-sm text-slate-300">
              Include system info to help with debugging (see preview when checked)
            </span>
          </label>
          {includeDiagnostics && (
            <pre className={`p-2 text-xs whitespace-pre-wrap break-words ${FEEDBACK_FIELD_SURFACE_CLASS}`}>
              {diagnosticsPreview}
            </pre>
          )}

          {submit.kind === 'error' && (
            <div role="alert" className="text-sm text-red-200 bg-red-950/80 border border-red-400/20 rounded-lg p-2">
              {submit.message} {fallbackLink}.
            </div>
          )}
        </div>
      </div>

      <div
        className="shrink-0 border-t border-white/10 bg-slate-900 px-4 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)' }}
      >
        <div className="mx-auto flex w-full max-w-2xl justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-3 py-2 rounded-lg text-sm font-medium text-slate-200 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-3 py-2 rounded-lg text-sm font-semibold text-slate-950 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-cyan-500"
          >
            {isSubmitting ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function errorMessageFor(error: string, status?: number): string {
  switch (error) {
    case 'rate_limited':
      return 'Too many submissions in a short window. Please try again in a minute.';
    case 'invalid_fields':
      return 'The submission was rejected as invalid. Please review your inputs, or';
    case 'github_create_failed':
      return "We couldn't create the issue right now (the feedback service is having trouble). Please";
    case 'timeout':
      return 'The request timed out. The feedback service may be slow — please try again, or';
    case 'network_error':
      return "Couldn't reach the feedback service. Check your connection, or";
    default:
      return `Submission failed${status ? ` (HTTP ${status})` : ''}. Please`;
  }
}
