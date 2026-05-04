import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/api/types';
import type { SystemStats } from '@/api/client';
import {
  buildDiagnosticsBlock,
  buildFeedbackIssueBody,
  buildFeedbackIssueUrl,
} from '../feedbackUrl';

function makeStats(): SystemStats {
  return {
    system: {
      os: 'Linux',
      ram_total: 0,
      ram_free: 0,
      comfyui_version: '0.3.45',
      python_version: '3.12.1',
      pytorch_version: '2.4.0',
      embedded_python: false,
      argv: [],
    },
    devices: [],
  };
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    version: 1,
    ...overrides,
  };
}

describe('buildDiagnosticsBlock', () => {
  it('summarizes environment and node counts', () => {
    const block = buildDiagnosticsBlock({
      systemStats: makeStats(),
      workflow: makeWorkflow({
        nodes: [{ id: 1 }, { id: 2 }, { id: 3 }] as Workflow['nodes'],
        definitions: {
          subgraphs: [
            { nodes: [{ id: 10 }, { id: 11 }] } as never,
            { nodes: [{ id: 20 }] } as never,
          ],
        },
      }),
    });

    expect(block).toContain('ComfyUI: 0.3.45');
    expect(block).toContain('OS: Linux');
    expect(block).toContain('Workflow nodes: 3 root, 3 in subgraphs');
  });

  it('falls back to "unknown" when stats are null and reports zero nodes when no workflow', () => {
    const block = buildDiagnosticsBlock({ systemStats: null, workflow: null });
    expect(block).toContain('ComfyUI: unknown');
    expect(block).toContain('Workflow nodes: 0 root, 0 in subgraphs');
  });
});

describe('buildFeedbackIssueBody', () => {
  it('omits diagnostics when includeDiagnostics is false', () => {
    const body = buildFeedbackIssueBody(
      { systemStats: makeStats(), workflow: makeWorkflow() },
      { includeDiagnostics: false },
    );
    expect(body).not.toContain('ComfyUI:');
    expect(body).not.toContain('Environment');
    expect(body).toContain('Description');
  });

  it('includes diagnostics when includeDiagnostics is true', () => {
    const body = buildFeedbackIssueBody(
      { systemStats: makeStats(), workflow: makeWorkflow() },
      { includeDiagnostics: true },
    );
    expect(body).toContain('Environment');
    expect(body).toContain('ComfyUI: 0.3.45');
  });
});

describe('buildFeedbackIssueUrl', () => {
  it('produces a github issues/new URL with body and labels params', () => {
    const url = buildFeedbackIssueUrl(
      { systemStats: makeStats(), workflow: makeWorkflow() },
      { includeDiagnostics: true },
    );
    expect(url.startsWith('https://github.com/cosmicbuffalo/comfyui-mobile-frontend/issues/new?')).toBe(true);

    const params = new URL(url).searchParams;
    expect(params.get('labels')).toBe('feedback');
    expect(params.get('body')).toContain('ComfyUI: 0.3.45');
    expect(params.get('title')).toBe('');
  });

  it('omits diagnostics from URL body when includeDiagnostics is false', () => {
    const url = buildFeedbackIssueUrl(
      { systemStats: makeStats(), workflow: makeWorkflow() },
      { includeDiagnostics: false },
    );
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).not.toContain('ComfyUI:');
  });

  it('uses prefill content with cc @handle for valid GitHub handles', () => {
    const url = buildFeedbackIssueUrl(
      { systemStats: makeStats(), workflow: makeWorkflow() },
      { includeDiagnostics: true },
      { title: 'thing is broken', body: 'when I do X, Y happens', contact: '@alice' },
    );
    const params = new URL(url).searchParams;
    expect(params.get('title')).toBe('thing is broken');
    const body = params.get('body') ?? '';
    expect(body).toContain('when I do X, Y happens');
    expect(body).toContain('cc @alice');
    expect(body).not.toContain('**Contact:**');
    expect(body).toContain('ComfyUI: 0.3.45');
    // template-only artifacts must be absent
    expect(body).not.toContain('Steps to reproduce');
  });

  it('drops non-handle contact values (e.g. emails) from the fallback URL', () => {
    const url = buildFeedbackIssueUrl(
      { systemStats: makeStats(), workflow: makeWorkflow() },
      { includeDiagnostics: false },
      { title: 't', body: 'a body of text', contact: 'private@example.com' },
    );
    const body = new URL(url).searchParams.get('body') ?? '';
    expect(body).not.toContain('private@example.com');
    expect(body).not.toContain('cc @');
    expect(body).not.toContain('**Contact:**');
  });

  it('falls back to the template when prefill body is empty', () => {
    const url = buildFeedbackIssueUrl(
      { systemStats: makeStats(), workflow: makeWorkflow() },
      { includeDiagnostics: false },
      { title: 'just a title', body: '   ' },
    );
    const params = new URL(url).searchParams;
    expect(params.get('title')).toBe('just a title');
    expect(params.get('body')).toContain('Steps to reproduce');
  });
});
