import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OutputsPanel } from '@/components/OutputsPanel';
import { useOutputsStore } from '@/hooks/useOutputs';

describe('OutputsPanel shortcuts', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalScrollTo: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    useOutputsStore.setState({
      isLoading: true,
      searchOpen: false,
      searchDraft: '',
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (originalScrollTo) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
    } else {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    }
    vi.unstubAllGlobals();
  });

  it('opens outputs search and focuses it with Command+F', async () => {
    await act(async () => {
      root.render(<OutputsPanel visible={true} />);
    });

    const shortcut = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.dispatchEvent(shortcut);
    });

    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search outputs..."]');
    expect(shortcut.defaultPrevented).toBe(true);
    expect(useOutputsStore.getState().searchOpen).toBe(true);
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('leaves Command+F to the visible panel when outputs are hidden', async () => {
    await act(async () => {
      root.render(<OutputsPanel visible={false} />);
    });

    const shortcut = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      document.dispatchEvent(shortcut);
    });

    expect(shortcut.defaultPrevented).toBe(false);
    expect(useOutputsStore.getState().searchOpen).toBe(false);
  });
});
