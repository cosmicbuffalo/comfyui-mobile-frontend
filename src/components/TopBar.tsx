import { useCallback, useEffect, useMemo, useRef } from 'react';
import { isWorkflowModified, useWorkflowStore } from '@/hooks/useWorkflow';
import { useAppMenuStore } from '@/hooks/useAppMenu';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { useOutputsStore } from '@/hooks/useOutputs';
import { AppMenu } from './AppMenu';
import { QueueTopBarControls } from './QueuePanel/QueueTopBarControls';
import { OutputsTopBarControls } from './OutputsPanel/OutputsTopBarControls';
import { WorkflowTopBarControls } from './WorkflowPanel/WorkflowTopBarControls';
import { getDisplayName } from './AppMenu/userWorkflowHelpers';
import { SubgraphBreadcrumb } from './WorkflowPanel/SubgraphBreadcrumb';
import { WorkflowTabline } from './WorkflowPanel/WorkflowTabline';
import { MenuButton } from '@/components/buttons/MenuButton';
import { TopBarTitle } from './TopBar/Title';
import { OutputsSourceToggle } from './TopBar/OutputsSourceToggle';
import { TopBarPanelNavigation } from './TopBar/PanelNavigation';
import type { PanelMode } from '@/hooks/useNavigation';
import { useWorkflowHiddenStore } from '@/hooks/useWorkflowHidden';
import { isWorkflowHidden } from '@/utils/workflowHidden';

interface TopBarProps {
  mode?: PanelMode;
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
  const workflowSource = useWorkflowStore((s) => s.workflowSource);
  const hiddenWorkflowPaths = useWorkflowHiddenStore((s) => s.hidden);
  const hiddenItems = useWorkflowStore((s) => s.hiddenItems);
  const closeForNewWorkflowRequest = useWorkflowStore((s) => s.closeForNewWorkflowRequest);
  const pending = useQueueStore((s) => s.pending);
  const history = useHistoryStore((s) => s.history);
  const historyTotal = useHistoryStore((s) => s.historyTotal);
  const outputsSource = useOutputsStore((s) => s.source);

  const isDirty = isWorkflowModified(workflow, originalWorkflow);
  const isHiddenWorkflow = isWorkflowHidden(workflowSource, currentFilename, hiddenWorkflowPaths);

  const nodeCountLabel = useMemo(() => {
    if (!workflow) return '';
    const totalNodes = workflow.nodes.length;
    const manualHiddenCount = Object.keys(hiddenItems).length;
    const hasHiddenSubgraphs = Object.values(hiddenItems).some(Boolean);
    if (manualHiddenCount === 0 && !hasHiddenSubgraphs) {
      return `${totalNodes} nodes ${isDirty ? '[Unsaved]' : ''}`.trim();
    }

    const hiddenSubgraphNodeCount = hasHiddenSubgraphs
      ? (workflow.definitions?.subgraphs ?? []).reduce((count, sg) => {
          if (sg.itemKey && hiddenItems[sg.itemKey]) {
            return count + (sg.nodes?.length ?? 0);
          }
          return count;
        }, 0)
      : 0;

    const hiddenCount = manualHiddenCount + hiddenSubgraphNodeCount;
    return `${totalNodes} nodes (${hiddenCount} hidden) ${isDirty ? '[Unsaved]' : ''}`.trim();
  }, [workflow, hiddenItems, isDirty]);

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
          return getDisplayName(currentFilename);
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

  const middleContent = mode === 'outputs' ? (
    <OutputsSourceToggle />
  ) : (
    <TopBarTitle
      title={title}
      mode={mode}
      isDirty={Boolean(isDirty)}
      hasWorkflow={Boolean(workflow)}
      nodeCountLabel={nodeCountLabel}
      historyLength={historyTotal ?? history.length}
      pendingLength={pending.length}
      onTap={handleTitleTap}
      isHidden={isHiddenWorkflow}
    />
  );

  return (
    <div
      id="top-bar-root"
      ref={barRef}
      className="fixed top-0 left-0 right-0 bg-slate-950/88 border-b border-white/10 text-slate-100 z-[2000] safe-area-top"
      data-top-bar="true"
    >
      <div id="top-bar-content" className="flex items-center justify-between px-4 py-3">
        <MenuButton onClick={() => setAppMenuOpen(true)} />
        <div className="grid min-w-0 flex-1 grid-cols-[0_minmax(0,1fr)_0] items-center lg:grid-cols-[1fr_minmax(12rem,24rem)_1fr]">
          <TopBarPanelNavigation mode={mode} side="left" />
          <div id="top-bar-center-slot" className="col-start-2 min-w-0 w-full">{middleContent}</div>
          <TopBarPanelNavigation mode={mode} side="right" />
        </div>
        <div id="top-bar-right-slot" className="w-10 h-10 flex items-center justify-center">
          {rightControls}
        </div>
      </div>
      <AppMenu open={appMenuOpen} onClose={() => setAppMenuOpen(false)} />
      {(mode === 'workflow' || closeForNewWorkflowRequest) && (
        <WorkflowTabline showTabs={mode === 'workflow'} />
      )}
      {mode === 'workflow' && <SubgraphBreadcrumb />}
    </div>
  );
}
