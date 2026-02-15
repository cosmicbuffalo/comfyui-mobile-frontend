import { useCallback, useState } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { makeLocationPointer, type MobileLayout } from '@/utils/mobileLayout';

export type RepositionTarget =
  | { type: 'node'; id: number }
  | { type: 'group'; id: number; subgraphId: string | null }
  | { type: 'subgraph'; id: string };

export interface RepositionViewportAnchor {
  viewportTop: number;
}

export interface UseRepositionModeReturn {
  overlayOpen: boolean;
  initialTarget: RepositionTarget | null;
  initialViewportAnchor: RepositionViewportAnchor | null;
  openOverlay: (target: RepositionTarget) => void;
  commitAndClose: (
    newLayout: MobileLayout,
    scrollTarget: RepositionTarget,
    viewportAnchor?: RepositionViewportAnchor | null
  ) => void;
  cancelOverlay: () => void;
}

export function useRepositionMode(): UseRepositionModeReturn {
  const setMobileLayout = useWorkflowStore((s) => s.setMobileLayout);
  const prepareRepositionScrollTarget = useWorkflowStore(
    (s) => s.prepareRepositionScrollTarget,
  );

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [initialTarget, setInitialTarget] = useState<RepositionTarget | null>(null);
  const [initialViewportAnchor, setInitialViewportAnchor] =
    useState<RepositionViewportAnchor | null>(null);

  const openOverlay = useCallback((target: RepositionTarget) => {
    let selector: string;
    if (target.type === 'node') {
      selector = `[data-reposition-item="node-${target.id}"]`;
    } else if (target.type === 'group') {
      const groupKey = makeLocationPointer({
        type: 'group',
        groupId: target.id,
        subgraphId: target.subgraphId ?? null
      });
      selector = `[data-reposition-item="group-${groupKey}"]`;
    } else {
      selector = `[data-reposition-item="subgraph-${target.id}"]`;
    }
    const targetEl = document.querySelector<HTMLElement>(selector);
    setInitialViewportAnchor(
      targetEl ? { viewportTop: targetEl.getBoundingClientRect().top } : null
    );
    setInitialTarget(target);
    setOverlayOpen(true);
  }, []);

  const commitAndClose = useCallback((
    newLayout: MobileLayout,
    scrollTarget: RepositionTarget,
    viewportAnchor?: RepositionViewportAnchor | null
  ) => {
    setMobileLayout(newLayout);
    setOverlayOpen(false);
    setInitialTarget(null);
    setInitialViewportAnchor(null);

    // Reveal collapsed ancestors before scrolling.
    prepareRepositionScrollTarget(scrollTarget);

    // After render settles, scroll to the moved item on the main panel.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        let selector: string;
        if (scrollTarget.type === 'node') {
          selector = `[data-reposition-item="node-${scrollTarget.id}"]`;
        } else if (scrollTarget.type === 'group') {
          const groupKey = makeLocationPointer({
            type: 'group',
            groupId: scrollTarget.id,
            subgraphId: scrollTarget.subgraphId ?? null
          });
          selector = `[data-reposition-item="group-${groupKey}"]`;
        } else {
          selector = `[data-reposition-item="subgraph-${scrollTarget.id}"]`;
        }
        if (selector) {
          const el = document.querySelector<HTMLElement>(selector);
          if (!el) return;

          if (viewportAnchor) {
            const scrollContainer = document.querySelector<HTMLElement>('[data-node-list="true"]');
            if (scrollContainer) {
              const currentTop = el.getBoundingClientRect().top;
              const delta = currentTop - viewportAnchor.viewportTop;
              if (Math.abs(delta) > 0.5) {
                scrollContainer.scrollTop += delta;
              }
              return;
            }
          }

          el.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
      });
    });
  }, [prepareRepositionScrollTarget, setMobileLayout]);

  const cancelOverlay = useCallback(() => {
    setOverlayOpen(false);
    setInitialTarget(null);
    setInitialViewportAnchor(null);
  }, []);

  return {
    overlayOpen,
    initialTarget,
    initialViewportAnchor,
    openOverlay,
    commitAndClose,
    cancelOverlay,
  };
}
