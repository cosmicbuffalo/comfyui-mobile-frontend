import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectionRow } from '../Connections/ConnectionRow';

describe('ConnectionRow accessibility', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('gives the connection button its contextual spoken action', async () => {
    await act(async () => {
      root.render(
        <ConnectionRow
          direction="output"
          hasConnection
          hideLabel={false}
          resolvedLabel="MODEL"
          shouldWrapResolvedLabel={false}
          sizeClass="w-10 h-10"
          arrowClass="text-base"
          typeClass="bg-cyan-500"
          buttonRef={createRef<HTMLButtonElement>()}
          ariaLabel="Go to KSampler from MODEL"
          connectionCount={1}
          onClick={() => {}}
        />,
      );
    });

    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Go to KSampler from MODEL',
    );
  });
});
