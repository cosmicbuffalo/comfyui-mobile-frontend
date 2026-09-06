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

  it('marks a boundary-crossing row after its slot name, on both sides', async () => {
    // The label reads "clip ⇠ style", so the marker follows the slot name — the
    // same placement a promoted widget uses.
    for (const direction of ['input', 'output'] as const) {
      await act(async () => {
        root.render(
          <ConnectionRow
            direction={direction}
            hasConnection
            isBoundaryConnection
            isPromoted
            hideLabel={false}
            resolvedLabel="clip ⇠ style"
            shouldWrapResolvedLabel={false}
            sizeClass="w-10 h-10"
            arrowClass="text-base"
            typeClass="bg-cyan-500"
            buttonRef={createRef<HTMLButtonElement>()}
            ariaLabel="Connect input clip"
            connectionCount={1}
            onClick={() => {}}
            labelAdornment={<button type="button" className="row-actions-button">menu</button>}
          />,
        );
      });

      // The exact-text span is the label itself; its wrapper also matches a
      // substring search, which is why this is `===`.
      const labelArea = Array.from(container.querySelectorAll('span')).find(
        (element) => element.textContent === 'clip ⇠ style',
      )?.parentElement;
      const children = Array.from(labelArea?.children ?? []);
      const labelIndex = children.findIndex((child) => child.textContent === 'clip ⇠ style');
      expect(children[labelIndex + 1]?.tagName.toLowerCase()).toBe('svg');
    }
  });

  it('leaves an ordinary row unmarked', async () => {
    await act(async () => {
      root.render(
        <ConnectionRow
          direction="input"
          hasConnection
          hideLabel={false}
          resolvedLabel="clip"
          shouldWrapResolvedLabel={false}
          sizeClass="w-10 h-10"
          arrowClass="text-base"
          typeClass="bg-cyan-500"
          buttonRef={createRef<HTMLButtonElement>()}
          ariaLabel="Connect input clip"
          connectionCount={1}
          onClick={() => {}}
        />,
      );
    });

    expect(container.querySelectorAll('svg')).toHaveLength(0);
  });
});
