import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

function Lock() {
  useBodyScrollLock(true);
  return null;
}

describe('useBodyScrollLock', () => {
  afterEach(() => {
    document.body.style.overflow = '';
  });

  it('keeps the body locked until the last overlapping lock releases', () => {
    document.body.style.overflow = 'auto';
    const c1 = document.createElement('div');
    const c2 = document.createElement('div');
    document.body.append(c1, c2);
    const r1: Root = createRoot(c1);
    const r2: Root = createRoot(c2);

    act(() => { r1.render(<Lock />); });
    act(() => { r2.render(<Lock />); });
    expect(document.body.style.overflow).toBe('hidden');

    // First lock unmounts while the second is still held — must stay locked.
    act(() => { r1.unmount(); });
    expect(document.body.style.overflow).toBe('hidden');

    // Last lock releases — original value is restored.
    act(() => { r2.unmount(); });
    expect(document.body.style.overflow).toBe('auto');
  });
});
