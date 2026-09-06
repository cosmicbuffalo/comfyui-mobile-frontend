import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaViewerActions } from '../MediaViewer/Actions';

/**
 * Select mode inside the viewer.
 *
 * The pointer-events assertion is the important one: the viewer's chrome layer
 * is `pointer-events-none` and every control re-enables it for itself. A button
 * added here without that is rendered, styled and correct in every other way —
 * and completely unclickable, which is exactly what shipped first.
 */
describe('MediaViewerActions in select mode', () => {
  let container: HTMLDivElement;
  let root: Root;

  const baseProps = {
    isVideo: false,
    canLoadWorkflow: true,
    showMetadataToggle: true,
    canToggleMetadata: true,
    canFavorite: true,
    isFavorited: false,
    canReject: true,
    isRejected: false,
    canDownload: true,
    deleteDisabled: false,
    loadWorkflowProgress: null,
    onDelete: vi.fn(),
    onLoadWorkflow: vi.fn(),
    onUseInWorkflow: vi.fn(),
    onToggleMetadata: vi.fn(),
    onToggleFavorite: vi.fn(),
    onReject: vi.fn(),
    onDownload: vi.fn(),
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (props: Record<string, unknown>) =>
    act(() => root.render(<MediaViewerActions {...baseProps} {...props} />));

  const labels = () =>
    [...container.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));

  const checkbox = () =>
    container.querySelector('[aria-label="Select image"], [aria-label="Deselect image"]');

  it('keeps only the controls selection work needs', () => {
    render({ selectionMode: true, isSelected: false, onToggleSelection: vi.fn() });

    expect(labels()).toContain('Select image');
    expect(labels()).toContain('Toggle metadata');
    // Everything that acts on this one file belongs to the bottom bar's bulk
    // actions while selecting.
    expect(labels()).not.toContain('Delete output');
    expect(labels()).not.toContain('Download');
    expect(labels()).not.toContain('Use in workflow');
  });

  it('shows the full set outside select mode', () => {
    render({ selectionMode: false });

    expect(labels()).toContain('Delete output');
    expect(labels()).toContain('Use in workflow');
    expect(checkbox()).toBeNull();
  });

  it('makes the checkbox clickable through the pointer-events-none chrome', () => {
    render({ selectionMode: true, isSelected: false, onToggleSelection: vi.fn() });

    // Without this class the button renders and looks right but no tap reaches
    // it, because the layer it sits in disables pointer events.
    expect(checkbox()?.className).toContain('pointer-events-auto');
  });

  it('reports its state and fires on click', () => {
    const onToggleSelection = vi.fn();
    render({ selectionMode: true, isSelected: true, onToggleSelection });

    const button = checkbox();
    expect(button?.getAttribute('aria-label')).toBe('Deselect image');
    expect(button?.getAttribute('aria-pressed')).toBe('true');

    act(() => (button as HTMLButtonElement).click());
    expect(onToggleSelection).toHaveBeenCalledTimes(1);
  });

  it('matches the other overlay buttons’ footprint', () => {
    // The checkbox sits in the same row as the favorite and metadata buttons;
    // a different disc size reads as a mistake.
    render({ selectionMode: true, isSelected: false, onToggleSelection: vi.fn() });

    const favorite = container.querySelector('[aria-label*="favorit" i]');
    expect(checkbox()?.className).toContain('w-9');
    expect(favorite?.className).toContain('w-9');
  });
});
