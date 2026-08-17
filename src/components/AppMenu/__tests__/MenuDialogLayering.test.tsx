import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppMenu } from '@/components/AppMenu';
import { CustomNodesManagerModal } from '@/components/CustomNodesManagerModal';
import { SlidePanel } from '@/components/AppMenu/SlidePanel';
import { UserWorkflowsPanel } from '@/components/AppMenu/UserWorkflowsPanel';
import { FeedbackDialog } from '@/components/AppMenu/FeedbackDialog';
import { Z_LAYERS } from '@/components/zLayers';
import type { UserDataFile } from '@/api/client';

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  return {
    ...actual,
    fetchSystemStats: vi.fn().mockResolvedValue(null),
    fetchCpuPercent: vi.fn().mockResolvedValue(null),
    listUserWorkflows: vi.fn().mockResolvedValue([]),
    getWorkflowTemplates: vi.fn().mockResolvedValue({}),
    restartServer: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@/api/customNodesManagerClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/customNodesManagerClient')>();
  return {
    ...actual,
    fetchCustomNodeList: vi.fn().mockResolvedValue({
      channel: 'default',
      node_packs: {
        'example-pack': { id: 'example-pack', title: 'Example Pack', state: 'enabled', version: '1.0.0' },
      },
    }),
    fetchCustomNodeMappings: vi.fn().mockResolvedValue({}),
    fetchCustomNodeAlternatives: vi.fn().mockResolvedValue({}),
    fetchManagerQueueStatus: vi.fn().mockResolvedValue({ is_processing: false, done_count: 0, in_progress_count: 0, total_count: 0 }),
  };
});

vi.mock('@/utils/feedbackApi', () => ({
  FEEDBACK_ENDPOINT: '',
  isFeedbackEndpointConfigured: () => false,
  submitFeedback: vi.fn(),
}));

/**
 * Every confirmation opened out of the app menu has to paint above the menu
 * panel and its blurred backdrop. Two things have to hold for that, and a
 * z-index alone is not enough: the dialog must escape the stacking context of
 * whatever renders it (the app menu lives inside `#top-bar-root`, a
 * `z-[2000]` element, so an in-place dialog is pinned below the menu's own
 * body-level portal no matter how high its z-index climbs), and it must then
 * outrank the panel.
 */
function expectDialogAboveMenu(dialog: HTMLElement, host: HTMLElement) {
  // Escaped every stacking context between it and the document.
  expect(dialog.parentElement).toBe(document.body);
  expect(host.contains(dialog)).toBe(false);
  // ...and ranks above the host panel, which is what paints the backdrop blur.
  expect(Number(dialog.style.zIndex)).toBeGreaterThan(Number(host.style.zIndex));
}

function openDialog(): HTMLElement {
  const roots = document.querySelectorAll<HTMLElement>('[data-dialog-root="true"]');
  expect(roots).toHaveLength(1);
  return roots[0];
}

function menuPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('[data-slide-panel-root="true"]');
  expect(panel).not.toBeNull();
  return panel!;
}

function findButton(label: string): HTMLButtonElement {
  const match = Array.from(document.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === label,
  );
  expect(match, `no button labelled "${label}"`).toBeDefined();
  return match as HTMLButtonElement;
}

function findButtonByLabel(ariaLabel: string): HTMLButtonElement {
  const match = document.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
  expect(match, `no button with aria-label "${ariaLabel}"`).not.toBeNull();
  return match!;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const WORKFLOW_FIXTURE: UserDataFile[] = [
  { path: 'workflows/example.json', type: 'file', name: 'example.json', modified: 0, size: 10 },
  { path: 'workflows/Portraits', type: 'directory', name: 'Portraits', modified: 0, size: 0 },
];

describe('app menu confirmation layering', () => {
  let container: HTMLDivElement;
  let stackingAncestor: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // Mirrors #top-bar-root, which renders the app menu and carries z-[2000].
    // Its stacking context is what used to trap the restart confirmation
    // underneath the menu panel.
    stackingAncestor = document.createElement('div');
    stackingAncestor.style.position = 'fixed';
    stackingAncestor.style.zIndex = '2000';
    container = document.createElement('div');
    stackingAncestor.appendChild(container);
    document.body.appendChild(stackingAncestor);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    stackingAncestor.remove();
    vi.clearAllMocks();
  });

  it('shows the restart confirmation above the menu, not behind it', async () => {
    await act(async () => {
      root.render(<AppMenu open onClose={vi.fn()} />);
    });

    // The Server section is collapsed by default.
    await click(findButton('Server'));
    await click(findButton('Restart ComfyUI'));

    const dialog = openDialog();
    expect(dialog.textContent).toContain('Restart ComfyUI?');
    expectDialogAboveMenu(dialog, menuPanel());
    // It is also not stuck inside the top bar's stacking context.
    expect(stackingAncestor.contains(dialog)).toBe(false);
  });

  describe('My Workflows', () => {
    const renderPanel = async () => {
      await act(async () => {
        root.render(
          <SlidePanel open onClose={vi.fn()} side="left" title="ComfyUI Mobile">
            <UserWorkflowsPanel
              error={null}
              loading={false}
              userWorkflows={WORKFLOW_FIXTURE}
              onBack={vi.fn()}
              onDismissError={vi.fn()}
              onLoadWorkflow={vi.fn()}
              onRefresh={vi.fn()}
            />
          </SlidePanel>,
        );
      });
    };

    const openRowAction = async (rowLabel: string, action: string) => {
      const rowButton = Array.from(document.querySelectorAll('button')).find(
        (button) => !button.getAttribute('aria-label') && button.textContent?.includes(rowLabel),
      );
      expect(rowButton, `no row for "${rowLabel}"`).toBeDefined();
      const trigger = rowButton!.parentElement?.querySelector<HTMLButtonElement>(
        'button[aria-label="Workflow actions"]',
      );
      expect(trigger, `no actions menu for row "${rowLabel}"`).toBeTruthy();
      await click(trigger!);
      await click(findButton(action));
    };

    it('shows the delete confirmation above the menu', async () => {
      await renderPanel();
      await openRowAction('example', 'Delete');

      const dialog = openDialog();
      expect(dialog.textContent).toContain('Delete workflow?');
      expectDialogAboveMenu(dialog, menuPanel());
    });

    it('shows the rename dialog above the menu', async () => {
      await renderPanel();
      await openRowAction('example', 'Rename');

      const dialog = openDialog();
      expect(dialog.textContent).toContain('Rename workflow');
      expectDialogAboveMenu(dialog, menuPanel());
    });

    it('shows the move dialog above the menu', async () => {
      await renderPanel();
      await openRowAction('example', 'Move');

      const dialog = openDialog();
      expect(dialog.textContent).toContain('Move workflow');
      expectDialogAboveMenu(dialog, menuPanel());
    });

    it('shows the new-folder dialog above the menu', async () => {
      await renderPanel();
      const trigger = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Folder options"]',
      );
      expect(trigger).not.toBeNull();
      await click(trigger!);
      await click(findButton('New folder'));

      const dialog = openDialog();
      expect(dialog.textContent).toContain('New folder');
      expectDialogAboveMenu(dialog, menuPanel());
    });
  });

  it('shows the feedback dialog above the menu', async () => {
    await act(async () => {
      root.render(
        <SlidePanel open onClose={vi.fn()} side="left" title="ComfyUI Mobile">
          <FeedbackDialog systemStats={null} workflow={null} onClose={vi.fn()} />
        </SlidePanel>,
      );
    });

    const dialog = openDialog();
    expect(dialog.textContent).toContain('Send Feedback');
    expectDialogAboveMenu(dialog, menuPanel());
  });

  it('shows the custom-node uninstall confirmation above the manager', async () => {
    await act(async () => {
      root.render(
        <CustomNodesManagerModal
          isOpen
          initialFilter=""
          initialSearch=""
          onClose={vi.fn()}
          onRestartServer={vi.fn()}
        />,
      );
    });
    await act(async () => { await Promise.resolve(); });

    await click(findButtonByLabel('Actions for Example Pack'));
    await click(findButton('Uninstall'));

    const dialog = openDialog();
    expect(dialog.textContent).toContain('Uninstall Example Pack?');
    // The manager is a fullscreen panel opened out of the menu; the
    // confirmation has to clear it the same way.
    const manager = document.querySelector<HTMLElement>('[data-custom-nodes-modal="true"]');
    expect(manager).not.toBeNull();
    expectDialogAboveMenu(dialog, manager!);
  });

  it('keeps every menu dialog on the shared above-the-panel layer', () => {
    expect(Z_LAYERS.panelDialog).toBeGreaterThan(Z_LAYERS.slidePanel);
    expect(Z_LAYERS.panelDialog).toBeGreaterThan(Z_LAYERS.fullscreenPanel);
  });
});
