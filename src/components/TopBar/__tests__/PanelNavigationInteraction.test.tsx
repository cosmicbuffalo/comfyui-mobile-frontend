import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TopBarPanelNavigation } from '../PanelNavigation';
import { useNavigationStore } from '@/hooks/useNavigation';

describe('TopBarPanelNavigation', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useNavigationStore.setState({ currentPanel: 'queue' });
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

  it('renders a double-chevron far jump and navigates to its panel', async () => {
    await act(async () => {
      root.render(<TopBarPanelNavigation mode="queue" side="left" />);
    });

    const outputsButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Go to Outputs"]',
    );
    const workflowButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Go to Workflow"]',
    );

    expect(outputsButton?.querySelectorAll('svg')).toHaveLength(2);
    expect(workflowButton?.querySelectorAll('svg')).toHaveLength(1);
    expect(outputsButton?.querySelector('span')?.classList.contains('w-8')).toBe(true);
    expect(workflowButton?.querySelector('span')?.classList.contains('w-8')).toBe(true);
    expect(container.querySelector('nav')?.classList.contains('col-start-1')).toBe(true);

    await act(async () => {
      outputsButton?.click();
    });
    expect(useNavigationStore.getState().currentPanel).toBe('outputs');
  });
});
