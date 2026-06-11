import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OutputsSourceToggle } from '../OutputsSourceToggle';
import { TopBarTitle } from '../Title';
import { useOutputsStore } from '@/hooks/useOutputs';

describe('top bar center vertical metrics', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useOutputsStore.setState({ source: 'output', files: [], isLoading: false });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('uses matching fixed row heights for outputs and workflow/queue centers', async () => {
    await act(async () => {
      root.render(
        <>
          <TopBarTitle
            title="Workflow"
            mode="workflow"
            isDirty={false}
            hasWorkflow={true}
            nodeCountLabel="1 node"
            historyLength={0}
            pendingLength={0}
            onTap={() => {}}
          />
          <OutputsSourceToggle />
        </>,
      );
    });

    const title = container.querySelector<HTMLElement>('#top-bar-title-container');
    const titlePrimary = container.querySelector<HTMLElement>('#top-bar-title');
    const outputs = container.querySelector<HTMLElement>('#top-bar-outputs-toggle');
    const outputsPrimary = outputs?.querySelector<HTMLElement>('button');
    const subtitles = container.querySelectorAll<HTMLElement>('.top-bar-subtitle');

    expect(title?.classList.contains('h-11')).toBe(true);
    expect(title?.classList.contains('w-full')).toBe(true);
    expect(outputs?.classList.contains('h-11')).toBe(true);
    expect(outputs?.classList.contains('w-full')).toBe(true);
    expect(titlePrimary?.classList.contains('h-7')).toBe(true);
    expect(titlePrimary?.classList.contains('w-full')).toBe(true);
    expect(titlePrimary?.classList.contains('justify-center')).toBe(true);
    expect(titlePrimary?.classList.contains('text-base')).toBe(true);
    expect(titlePrimary?.classList.contains('text-lg')).toBe(false);
    expect(outputsPrimary?.classList.contains('h-7')).toBe(true);
    expect([...subtitles].every((subtitle) => subtitle.classList.contains('h-4'))).toBe(true);
    expect(subtitles[0]?.classList.contains('w-full')).toBe(true);
    expect(subtitles[0]?.classList.contains('text-center')).toBe(true);
    expect(titlePrimary?.textContent).toContain('Workflow');
    expect(subtitles[0]?.textContent).toContain('1 node');
    expect(outputsPrimary?.classList.contains('pb-0.5')).toBe(false);
    expect(subtitles[1]?.classList.contains('mt-1.5')).toBe(false);
  });

  it('uses the same smaller top-bar name size for queue', async () => {
    await act(async () => {
      root.render(
        <TopBarTitle
          title="Queue"
          mode="queue"
          isDirty={false}
          hasWorkflow={false}
          nodeCountLabel=""
          historyLength={0}
          pendingLength={0}
          onTap={() => {}}
        />,
      );
    });

    const title = container.querySelector<HTMLElement>('#top-bar-title');
    expect(title?.classList.contains('text-base')).toBe(true);
    expect(title?.classList.contains('text-lg')).toBe(false);
  });

  it('shows hidden workflows with an icon and italic title', async () => {
    await act(async () => {
      root.render(
        <TopBarTitle
          title="Private workflow"
          mode="workflow"
          isDirty={false}
          isHidden
          hasWorkflow
          nodeCountLabel="1 node"
          historyLength={0}
          pendingLength={0}
          onTap={() => {}}
        />,
      );
    });

    expect(container.querySelector('#top-bar-title svg')).not.toBeNull();
    expect(container.querySelector('#top-bar-title span')?.getAttribute('data-workflow-hidden')).toBe('true');
  });
});
