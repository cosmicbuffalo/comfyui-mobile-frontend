import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow } from '@/api/types';
import { WorkflowTopBarControls } from '../WorkflowTopBarControls';

const mocks = vi.hoisted(() => ({
  dirty: true,
  isDesktop: true,
  saveUserWorkflow: vi.fn(async () => undefined),
  setSavedWorkflow: vi.fn(),
  setSavingSessionId: vi.fn(),
  state: {} as Record<string, unknown>,
}));

vi.mock('@/api/client', () => ({
  saveUserWorkflow: mocks.saveUserWorkflow,
  loadTemplateWorkflow: vi.fn(),
  loadUserWorkflow: vi.fn(),
  getFileWorkflowMetadata: vi.fn(),
}));

vi.mock('@/hooks/useWorkflow', () => {
  const useWorkflowStore = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state),
    { getState: () => mocks.state },
  );
  return {
    isWorkflowModified: () => mocks.dirty,
    useWorkflowStore,
  };
});

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mocks.isDesktop,
}));

vi.mock('@/hooks/useGenerationSettings', () => ({
  useGenerationSettingsStore: {
    getState: () => ({ obfuscateSharedInputPaths: false }),
  },
}));

vi.mock('@/hooks/useNavigation', () => ({
  useNavigationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setCurrentPanel: vi.fn() }),
}));

vi.mock('@/hooks/useHistory', () => ({
  useHistoryStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ history: [] }),
}));

vi.mock('@/hooks/useDismissOnOutsideClick', () => ({
  useDismissOnOutsideClick: () => undefined,
}));

vi.mock('@/utils/workflowPersistence', () => ({
  getWorkflowForPersistence: (workflow: Workflow) => workflow,
}));

vi.mock('@/utils/inputPathAliases', () => ({
  obfuscateWorkflowInputPaths: vi.fn(),
}));

vi.mock('../WorkflowTopBarControls/WorkflowTopBarMenu', () => ({
  WorkflowTopBarMenu: () => null,
}));

const workflow: Workflow = {
  last_node_id: 0,
  last_link_id: 0,
  nodes: [],
  links: [],
  groups: [],
  config: {},
  version: 1,
};

function saveShortcut(shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 's',
    metaKey: true,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

describe('WorkflowTopBarControls desktop save shortcuts', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.dirty = true;
    mocks.isDesktop = true;
    mocks.saveUserWorkflow.mockClear();
    mocks.setSavedWorkflow.mockClear();
    mocks.setSavingSessionId.mockClear();
    mocks.state = {
      workflow,
      originalWorkflow: { ...workflow, version: 0 },
      currentFilename: 'saved-workflow.json',
      filenameIsPlaceholder: false,
      workflowSource: null,
      loadWorkflow: vi.fn(),
      setSavedWorkflow: mocks.setSavedWorkflow,
      clearWorkflowCache: vi.fn(),
      unloadWorkflow: vi.fn(),
      requestAddNodeModal: vi.fn(),
      addGroupNearNode: vi.fn(),
      workflowLoadedAt: 1,
      activeSessionId: 'session-1',
      savingSessionId: null,
      setSavingSessionId: mocks.setSavingSessionId,
      nodeTypes: null,
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<WorkflowTopBarControls />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('saves the current workflow with Command+S', async () => {
    let event!: KeyboardEvent;
    await act(async () => {
      event = saveShortcut();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(mocks.saveUserWorkflow).toHaveBeenCalledWith('saved-workflow.json', workflow);
  });

  it('opens Save As with Shift+Command+S', async () => {
    await act(async () => {
      saveShortcut(true);
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="workflow.json"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('saved-workflow.json');
    expect(mocks.saveUserWorkflow).not.toHaveBeenCalled();
  });

  it('submits a renamed workflow from the Save As text field', async () => {
    await act(async () => {
      saveShortcut(true);
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="workflow.json"]');
    const form = input?.closest('form');
    expect(input).not.toBeNull();
    expect(form).not.toBeNull();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set;
      setValue?.call(input, 'renamed-workflow');
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      form?.requestSubmit();
    });

    expect(mocks.saveUserWorkflow).toHaveBeenCalledWith('renamed-workflow.json', workflow);
  });

  it('uses Save As for Command+S when the workflow has no filename', async () => {
    mocks.state.currentFilename = null;
    await act(async () => {
      root.render(<WorkflowTopBarControls />);
    });

    await act(async () => {
      saveShortcut();
    });

    expect(container.querySelector('input[placeholder="workflow.json"]')).not.toBeNull();
    expect(mocks.saveUserWorkflow).not.toHaveBeenCalled();
  });

  it('uses Save As with an empty name when the filename is a placeholder', async () => {
    // e.g. a pasted workflow, named "Pasted workflow (12:00:00)" by the app.
    mocks.state.currentFilename = 'Pasted workflow (12:00:00)';
    mocks.state.filenameIsPlaceholder = true;
    await act(async () => {
      root.render(<WorkflowTopBarControls />);
    });

    await act(async () => {
      saveShortcut();
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="workflow.json"]');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('');
    expect(mocks.saveUserWorkflow).not.toHaveBeenCalled();
  });

  it('opens Save As empty for a placeholder filename on Shift+Command+S too', async () => {
    mocks.state.currentFilename = 'Pasted workflow (12:00:00)';
    mocks.state.filenameIsPlaceholder = true;
    await act(async () => {
      root.render(<WorkflowTopBarControls />);
    });

    await act(async () => {
      saveShortcut(true);
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="workflow.json"]');
    expect(input?.value).toBe('');
    expect(mocks.saveUserWorkflow).not.toHaveBeenCalled();
  });

  it('leaves the browser shortcut alone below the desktop breakpoint', async () => {
    mocks.isDesktop = false;
    await act(async () => {
      root.render(<WorkflowTopBarControls />);
    });

    let event!: KeyboardEvent;
    await act(async () => {
      event = saveShortcut();
    });

    expect(event.defaultPrevented).toBe(false);
    expect(mocks.saveUserWorkflow).not.toHaveBeenCalled();
  });
});
