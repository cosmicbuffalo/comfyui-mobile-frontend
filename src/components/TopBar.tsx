import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { useAppMenuStore } from '@/hooks/useAppMenu';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { useOutputsStore } from '@/hooks/useOutputs';
import { MenuIcon } from '@/components/icons';
import { AppMenu } from './AppMenu';
import { QueueTopBarControls } from './QueuePanel/QueueTopBarControls';
import { OutputsTopBarControls } from './OutputsPanel/OutputsTopBarControls';
import { WorkflowTopBarControls } from './WorkflowPanel/WorkflowTopBarControls';

interface TopBarProps {
  mode?: 'workflow' | 'queue' | 'outputs';
}

function getScrollSelectors(mode: TopBarProps['mode']): string[] {
  switch (mode) {
    case 'queue':
      return ['[data-queue-list="true"]', '[data-node-list="true"]'];
    case 'workflow':
    case 'outputs':
    default:
      return ['[data-node-list="true"]', '[data-queue-list="true"]'];
  }
}

export function TopBar({ mode = 'workflow' }: TopBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef<number>(0);
  const appMenuOpen = useAppMenuStore((s) => s.appMenuOpen);
  const setAppMenuOpen = useAppMenuStore((s) => s.setAppMenuOpen);

  const handleTitleTap = useCallback(() => {
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    lastTapRef.current = now;

    // Double tap detected (within 300ms)
    if (timeSinceLastTap < 300) {
      if (mode === 'workflow') {
        window.dispatchEvent(new Event('workflow-scroll-to-top'));
        if ('vibrate' in navigator) {
          navigator.vibrate(10);
        }
        return;
      }
      if (mode === 'outputs') {
        const outputsContainer = document.querySelector<HTMLElement>('#outputs-content-container');
        if (outputsContainer) {
          outputsContainer.scrollTo({ top: 0, behavior: 'auto' });
          if ('vibrate' in navigator) {
            navigator.vibrate(10);
          }
        }
        return;
      }

      // Try to scroll the appropriate container based on mode
      // Also try the other container as fallback in case mode hasn't updated yet
      const selectors = getScrollSelectors(mode);

      for (const selector of selectors) {
        const scrollContainer = document.querySelector<HTMLElement>(selector);
        // Check if container exists and is scrolled (has content visible)
        if (scrollContainer && scrollContainer.scrollHeight > 0) {
          // Check if parent container is visible (not hidden with pointer-events-none)
          const parent = scrollContainer.closest('.pointer-events-none');
          if (!parent) {
            scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
            // Haptic feedback
            if ('vibrate' in navigator) {
              navigator.vibrate(10);
            }
            break;
          }
        }
      }
    }
  }, [mode]);
  const workflow = useWorkflowStore((s) => s.workflow);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const manuallyHiddenNodes = useWorkflowStore((s) => s.manuallyHiddenNodes);
  const hiddenSubgraphs = useWorkflowStore((s) => s.hiddenSubgraphs);
  const pending = useQueueStore((s) => s.pending);
  const history = useHistoryStore((s) => s.history);
  const outputsSource = useOutputsStore((s) => s.source);

  // Check if dirty
  // We exclude non-persistent fields if any, but currently workflow object is pure JSON data
  const isDirty = workflow && originalWorkflow && JSON.stringify(workflow) !== JSON.stringify(originalWorkflow);

  const nodeCountLabel = useMemo(() => {
    if (!workflow) return '';
    const totalNodes = workflow.nodes.length;
    const manualHiddenCount = Object.keys(manuallyHiddenNodes).length;
    const hasHiddenSubgraphs = Object.values(hiddenSubgraphs).some(Boolean);
    if (manualHiddenCount === 0 && !hasHiddenSubgraphs) {
      return `${totalNodes} nodes ${isDirty ? '[Unsaved]' : ''}`.trim();
    }

    const hiddenSubgraphNodeCount = hasHiddenSubgraphs
      ? workflow.nodes.reduce((count, node) => {
          const props = node.properties as Record<string, unknown> | undefined;
          const origin = props?.['__mobile_origin'];
          if (!origin || typeof origin !== 'object') return count;
          const scope = (origin as { scope?: string }).scope;
          if (scope !== 'subgraph') return count;
          const subgraphId = (origin as { subgraphId?: string }).subgraphId;
          if (subgraphId && hiddenSubgraphs[subgraphId]) {
            return count + 1;
          }
          return count;
        }, 0)
      : 0;

    const hiddenCount = manualHiddenCount + hiddenSubgraphNodeCount;
    return `${totalNodes} nodes (${hiddenCount} hidden) ${isDirty ? '[Unsaved]' : ''}`.trim();
  }, [workflow, manuallyHiddenNodes, hiddenSubgraphs, isDirty]);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      document.documentElement.style.setProperty('--top-bar-offset', `${rect.height}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const title = useMemo(() => {
    switch (mode) {
      case 'queue':
        return 'Queue';
      case 'outputs':
        return outputsSource === 'output' ? 'Outputs' : 'Inputs';
      case 'workflow':
      default:
        if (currentFilename) {
          return currentFilename.replace('.json', '');
        }
        return workflow ? 'Untitled' : 'ComfyUI Mobile';
    }
  }, [mode, outputsSource, currentFilename, workflow]);

  const rightControls = useMemo(() => {
    switch (mode) {
      case 'queue':
        return <QueueTopBarControls />;
      case 'outputs':
        return <OutputsTopBarControls />;
      case 'workflow':
      default:
        return <WorkflowTopBarControls />;
    }
  }, [mode]);

  return (
    <div
      id="top-bar-root"
      ref={barRef}
      className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-[2000] safe-area-top"
      data-top-bar="true"
    >
      <div id="top-bar-content" className="flex items-center justify-between px-4 py-3">
        {/* Menu button */}
        <button
          onClick={() => setAppMenuOpen(true)}
          className="w-10 h-10 flex items-center justify-center rounded-lg
                     text-gray-700 hover:bg-gray-100"
        >
          <MenuIcon className="w-6 h-6" />
        </button>

        {/* Title - double tap to scroll to top */}
        <div id="top-bar-title-container" className="flex-1 text-center min-w-0 px-2 cursor-pointer" onClick={handleTitleTap}>
          <h1 id="top-bar-title" className="font-semibold text-gray-900 text-lg truncate flex items-center justify-center">
            <span className="truncate">{title}</span>
            {mode === 'workflow' && isDirty && <span id="dirty-indicator" className="text-blue-500 ml-1 font-bold">*</span>}
          </h1>
          {mode === 'workflow' && workflow && (
            <p className="node-count-display text-xs text-gray-500">
              {nodeCountLabel}
            </p>
          )}
          {mode === 'queue' && (
            <p className="run-count-display text-xs text-gray-500">
              {history.length} {history.length === 1 ? 'run' : 'runs'}
              {pending.length > 0 && ` (${pending.length} pending)`}
            </p>
          )}
        </div>

        {/* Status indicators / menu slot */}
        <div id="top-bar-right-slot" className="w-10 h-10 flex items-center justify-center">
          {rightControls}
        </div>
      </div>
      <AppMenu open={appMenuOpen} onClose={() => setAppMenuOpen(false)} />
    </div>
  );
}
