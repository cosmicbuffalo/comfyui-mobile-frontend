import { useState } from 'react';
import type { SystemStats } from '@/api/client';
import type { Workflow } from '@/api/types';
import { Dialog } from '@/components/modals/Dialog';
import { buildDiagnosticsBlock, buildFeedbackIssueUrl } from '@/utils/feedbackUrl';
import {
  FEEDBACK_ENDPOINT,
  isFeedbackEndpointConfigured,
  submitFeedback,
} from '@/utils/feedbackApi';

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

const FIELD_LABEL_CLASS = 'block text-xs font-medium text-gray-700 mb-1';
const INPUT_CLASS =
  'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500';

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
              className="block text-blue-600 hover:underline break-all"
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
      className="text-blue-600 hover:underline"
    >
      Open a GitHub issue directly
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

  return (
    <Dialog
      onClose={onClose}
      title="Send Feedback"
      size="2xl"
      align="top"
      disableClose={isSubmitting}
      description={
        <div className="space-y-3">
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
              Contact <span className="text-gray-400 font-normal">(optional)</span>
            </span>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={200}
              placeholder="GitHub @username or email if you'd like a reply"
              className={INPUT_CLASS}
            />
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
              className="mt-1 w-4 h-4"
              checked={includeDiagnostics}
              onChange={(e) => setIncludeDiagnostics(e.target.checked)}
            />
            <span className="text-sm text-gray-700">
              Include diagnostic info (ComfyUI version, OS, node counts) to help with debugging
            </span>
          </label>
          {includeDiagnostics && (
            <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-2 whitespace-pre-wrap break-words text-gray-700">
              {diagnosticsPreview}
            </pre>
          )}

          {submit.kind === 'error' && (
            <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {submit.message} {fallbackLink}.
            </div>
          )}
        </div>
      }
      actions={[
        {
          label: 'Cancel',
          onClick: onClose,
          variant: 'secondary',
          disabled: isSubmitting,
        },
        {
          label: isSubmitting ? 'Sending...' : 'Send',
          onClick: handleSubmit,
          variant: 'primary',
          disabled: !canSubmit,
        },
      ]}
    />
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
