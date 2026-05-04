import { APP_VERSION, REPO_URL } from '@/constants';
import type { SystemStats } from '@/api/client';
import type { Workflow } from '@/api/types';

export interface FeedbackContext {
  systemStats: SystemStats | null;
  workflow: Workflow | null;
}

export interface FeedbackOptions {
  includeDiagnostics: boolean;
}

// Mirrors the worker's GitHub username regex. We don't (and can't) verify the
// user actually exists from the client, but this lets us avoid leaking arbitrary
// contact strings (e.g. emails) into a public GitHub issue via the fallback URL.
const GITHUB_HANDLE_REGEX = /^@?[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

function nodeCounts(workflow: Workflow | null): { root: number; subgraphs: number } {
  if (!workflow) return { root: 0, subgraphs: 0 };
  const root = Array.isArray(workflow.nodes) ? workflow.nodes.length : 0;
  const subgraphDefs = workflow.definitions?.subgraphs ?? [];
  const subgraphs = subgraphDefs.reduce(
    (sum, sg) => sum + (Array.isArray(sg.nodes) ? sg.nodes.length : 0),
    0,
  );
  return { root, subgraphs };
}

export function buildDiagnosticsBlock({ systemStats, workflow }: FeedbackContext): string {
  const counts = nodeCounts(workflow);
  const comfyVersion = systemStats?.system?.comfyui_version ?? 'unknown';
  const os = systemStats?.system?.os ?? 'unknown';
  const pythonVersion = systemStats?.system?.python_version ?? 'unknown';

  return [
    `- Mobile Frontend: ${APP_VERSION}`,
    `- ComfyUI: ${comfyVersion}`,
    `- OS: ${os}`,
    `- Python: ${pythonVersion}`,
    `- Workflow nodes: ${counts.root} root, ${counts.subgraphs} in subgraphs`,
    `- User agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
  ].join('\n');
}

function diagnosticsSection(context: FeedbackContext): string[] {
  return [
    '---',
    '',
    '<details><summary>Environment</summary>',
    '',
    buildDiagnosticsBlock(context),
    '',
    '</details>',
  ];
}

export function buildFeedbackIssueBody(
  context: FeedbackContext,
  options: FeedbackOptions,
): string {
  const lines = [
    '<!-- Thanks for the feedback! Please describe the bug or feature request below. -->',
    '',
    '**Type:** [ ] Bug  [ ] Feature request  [ ] Other',
    '',
    '**Description:**',
    '',
    '',
    '**Steps to reproduce (for bugs):**',
    '1.',
    '2.',
    '',
  ];

  if (options.includeDiagnostics) {
    lines.push(...diagnosticsSection(context));
  }

  return lines.join('\n');
}

export interface FeedbackPrefill {
  title?: string;
  body?: string;
  contact?: string;
}

// Render a contact value safely for the public fallback URL. We only emit
// something if it looks like a GitHub handle — anything else (notably email
// addresses) is dropped so that hitting the GitHub fallback doesn't publish
// the user's contact info into a public issue body.
function renderFallbackContact(contact: string): string | null {
  const trimmed = contact.trim();
  if (!trimmed || !GITHUB_HANDLE_REGEX.test(trimmed)) return null;
  const handle = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed;
  return `cc @${handle}`;
}

export function buildFeedbackIssueUrl(
  context: FeedbackContext,
  options: FeedbackOptions,
  prefill: FeedbackPrefill = {},
): string {
  const title = (prefill.title ?? '').trim();
  const body = (prefill.body ?? '').trim();
  const contactLine = renderFallbackContact(prefill.contact ?? '');

  let issueBody: string;
  if (body) {
    const lines: string[] = [body];
    if (contactLine) {
      lines.push('', '---', '', contactLine);
    }
    if (options.includeDiagnostics) {
      lines.push('', ...diagnosticsSection(context));
    }
    issueBody = lines.join('\n');
  } else {
    issueBody = buildFeedbackIssueBody(context, options);
  }

  const params = new URLSearchParams({
    title,
    body: issueBody,
    labels: 'feedback',
  });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}
