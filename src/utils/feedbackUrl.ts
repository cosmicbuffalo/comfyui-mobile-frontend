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
    lines.push(
      '---',
      '',
      '<details><summary>Environment</summary>',
      '',
      buildDiagnosticsBlock(context),
      '',
      '</details>',
    );
  }

  return lines.join('\n');
}

export interface FeedbackPrefill {
  title?: string;
  body?: string;
  contact?: string;
}

export function buildFeedbackIssueUrl(
  context: FeedbackContext,
  options: FeedbackOptions,
  prefill: FeedbackPrefill = {},
): string {
  const title = (prefill.title ?? '').trim();
  const body = (prefill.body ?? '').trim();
  const contact = (prefill.contact ?? '').trim();

  let issueBody: string;
  if (body) {
    const lines: string[] = [body];
    if (contact) {
      lines.push('', '---', '', `**Contact:** ${contact}`);
    }
    if (options.includeDiagnostics) {
      lines.push(
        '',
        '---',
        '',
        '<details><summary>Environment</summary>',
        '',
        buildDiagnosticsBlock(context),
        '',
        '</details>',
      );
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
