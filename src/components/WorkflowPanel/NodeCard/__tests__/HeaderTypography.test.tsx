import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeCardHeader } from '../Header';

describe('NodeCardHeader typography', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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

  it('renders the node display name at the smaller header size', async () => {
    await act(async () => {
      root.render(
        <NodeCardHeader
          nodeId={1}
          displayName="Example Node"
          isEditingLabel={false}
          labelValue="Example Node"
          labelInputRef={createRef<HTMLInputElement>()}
          onLabelChange={() => {}}
          onLabelBlur={() => {}}
          isCollapsed={false}
          isBypassed={false}
          overallProgress={null}
          hasErrors={false}
          errorIconRef={createRef<HTMLButtonElement>()}
          errorPopoverOpen={false}
          setErrorPopoverOpen={() => {}}
          toggleNodeFold={() => {}}
        />,
      );
    });

    expect(
      container.querySelector('#node-display-name-1')?.classList.contains('text-sm'),
    ).toBe(true);
  });
});
