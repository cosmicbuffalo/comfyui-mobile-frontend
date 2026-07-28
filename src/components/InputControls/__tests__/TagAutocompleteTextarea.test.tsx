import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal autocomplete store: active + ready, always yielding one suggestion so
// the only thing gating the overlay is the open-delay timer under test.
const suggestion = { kind: 'tag', label: 'cat', category: 0, count: 100, aliases: [] };
const storeState = {
  active: true,
  dataStatus: 'ready',
  getSuggestions: vi.fn(() => ({ suggestions: [suggestion] })),
  ensureData: vi.fn(),
  ensureInitialized: vi.fn(() => Promise.resolve()),
};

vi.mock('@/hooks/useAutocompleteStore', () => ({
  useAutocompleteStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
  selectAutocompleteActive: (s: typeof storeState) => s.active,
}));
vi.mock('@/hooks/useVisualViewportFrame', () => ({
  getVisualViewportFrame: () => ({ offsetTop: 0, height: 800 }),
}));
vi.mock('@/utils/caretCoordinates', () => ({
  getCaretCoordinates: () => ({ top: 0, left: 0, height: 16 }),
}));
vi.mock('@/utils/dropdownPlacement', () => ({
  computeDropdownPlacement: () => ({ left: 0, width: 200, top: 20, maxHeight: 200 }),
}));

import { TagAutocompleteTextarea } from '../TagAutocompleteTextarea';

const dropdown = () => document.querySelector('.autocomplete-dropdown');

describe('TagAutocompleteTextarea open delay', () => {
  let container: HTMLDivElement;
  let root: Root;
  const ref = { current: null as HTMLTextAreaElement | null };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <TagAutocompleteTextarea textareaRef={ref} value="cat" onValueChange={() => {}} />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll('.autocomplete-dropdown').forEach((el) => el.remove());
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('holds the overlay closed for a beat after focus, then opens it', () => {
    act(() => {
      ref.current?.focus();
    });
    // Even though a suggestion is ready, the overlay stays hidden right after
    // focus so the caret stays visible.
    expect(dropdown()).toBeNull();

    // Not yet — just short of the grace period.
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(dropdown()).toBeNull();

    // Grace period elapsed → the overlay appears.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(dropdown()).not.toBeNull();
  });

  it('re-arms the delay on blur so the next focus gets a fresh beat', () => {
    // Focus is committed in its own act() so the effect that schedules the timer
    // runs before we advance it.
    act(() => {
      ref.current?.focus();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dropdown()).not.toBeNull();

    act(() => {
      ref.current?.blur();
    });
    expect(dropdown()).toBeNull();

    // Refocusing must not re-open instantly — the beat applies again.
    act(() => {
      ref.current?.focus();
    });
    expect(dropdown()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dropdown()).not.toBeNull();
  });

  it('keeps the floating dismiss button — the only way to close on mobile', () => {
    act(() => {
      ref.current?.focus();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dropdown()).not.toBeNull();

    const dismiss = document.querySelector<HTMLButtonElement>(
      '.autocomplete-dropdown button[aria-label="Dismiss autocomplete"]',
    );
    expect(dismiss).not.toBeNull();

    // Tapping it closes the overlay without blurring the textarea.
    act(() => {
      dismiss?.click();
    });
    expect(dropdown()).toBeNull();
    expect(document.activeElement).toBe(ref.current);
  });
});
