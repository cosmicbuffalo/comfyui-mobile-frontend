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
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(
      'Fold Example Node',
    );
  });

  it('puts the instance badge after the node id, not before it', async () => {
    await act(async () => {
      root.render(
        <NodeCardHeader
          nodeId={7}
          displayName="Styler"
          instanceBadge={<button type="button" className="badge">2/3</button>}
          isEditingLabel={false}
          labelValue="Styler"
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

    // The id keeps the position it holds on every other card; the badge follows.
    const idBadge = container.querySelector('#node-id-badge-7')!;
    const badge = container.querySelector('.badge')!;
    expect(idBadge.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy();
  });
});
