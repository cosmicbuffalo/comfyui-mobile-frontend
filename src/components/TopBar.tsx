import { useCallback, useEffect, useRef } from 'react';
import { useWorkflowStore, getInputWidgetDefinitions, getWidgetDefinitions } from '@/hooks/useWorkflow';
import { useQueueStore } from '@/hooks/useQueue';
import { useHistoryStore } from '@/hooks/useHistory';
import { MenuIcon } from '@/components/icons';

interface TopBarProps {
  onMenuClick: () => void;
  mode?: 'workflow' | 'queue';
  rightSlot?: React.ReactNode;
}

export function TopBar({ onMenuClick, mode = 'workflow', rightSlot }: TopBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef<number>(0);

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
      // Try to scroll the appropriate container based on mode
      // Also try the other container as fallback in case mode hasn't updated yet
      const selectors = mode === 'queue'
        ? ['[data-queue-list="true"]', '[data-node-list="true"]']
        : ['[data-node-list="true"]', '[data-queue-list="true"]'];

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
  const hideStaticNodes = useWorkflowStore((s) => s.hideStaticNodes);
  const hideBypassedNodes = useWorkflowStore((s) => s.hideBypassedNodes);
  const manuallyHiddenNodes = useWorkflowStore((s) => s.manuallyHiddenNodes);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);
  const pending = useQueueStore((s) => s.pending);
  const history = useHistoryStore((s) => s.history);

  // Check if dirty
  // We exclude non-persistent fields if any, but currently workflow object is pure JSON data
  const isDirty = workflow && originalWorkflow && JSON.stringify(workflow) !== JSON.stringify(originalWorkflow);

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

  return (
    <div
      ref={barRef}
      className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 z-40 safe-area-top"
      data-top-bar="true"
    >
      <div className="flex items-center justify-between px-4 py-3">
        {/* Menu button */}
        <button
          onClick={onMenuClick}
          className="w-10 h-10 flex items-center justify-center rounded-lg
                     text-gray-700 hover:bg-gray-100"
        >
          <MenuIcon className="w-6 h-6" />
        </button>

        {/* Title - double tap to scroll to top */}
        <div className="flex-1 text-center min-w-0 px-2 cursor-pointer" onClick={handleTitleTap}>
          <h1 className="font-semibold text-gray-900 text-lg truncate flex items-center justify-center">
            <span className="truncate">
              {mode === 'queue'
                ? 'Queue'
                : currentFilename
                  ? currentFilename.replace('.json', '')
                  : (workflow ? 'Untitled' : 'ComfyUI Mobile')}
            </span>
            {mode === 'workflow' && isDirty && <span className="text-blue-500 ml-1 font-bold">*</span>}
          </h1>
          {mode === 'workflow' && workflow && (
            <p className="text-xs text-gray-500">
              {(() => {
                const total = workflow.nodes.length;
                if (!hideStaticNodes && !hideBypassedNodes && Object.keys(manuallyHiddenNodes).length === 0) {
                  return `${total} nodes ${isDirty ? '[Unsaved]' : ''}`.trim();
                }
                const visibleCount = workflow.nodes.filter((node) => {
                  if (manuallyHiddenNodes[node.id]) return false;
                  if (hideBypassedNodes && node.mode === 4) return false;
                  if (!hideStaticNodes) return true;
                  const widgetDefs = getWidgetDefinitions(nodeTypes, node);
                  const inputWidgetDefs = getInputWidgetDefinitions(nodeTypes, node);
                  return widgetDefs.length > 0 || inputWidgetDefs.length > 0;
                }).length;
                const hiddenCount = total - visibleCount;
                return `${total} nodes (${hiddenCount} hidden) ${isDirty ? '[Unsaved]' : ''}`.trim();
              })()}
            </p>
          )}
          {mode === 'queue' && (
            <p className="text-xs text-gray-500">
              {history.length} {history.length === 1 ? 'run' : 'runs'}
              {pending.length > 0 && ` (${pending.length} pending)`}
            </p>
          )}
        </div>

        {/* Status indicators / menu slot */}
        <div className="w-10 h-10 flex items-center justify-center">
          {rightSlot ?? null}
        </div>
      </div>
    </div>
  );
}
