import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeError } from '@/hooks/useWorkflowErrors';
import { useNavigationStore } from '@/hooks/useNavigation';
import type { RefObject } from 'react';
import { CloseIcon } from '@/components/icons';

interface NodeCardErrorPopoverProps {
  nodeId: number;
  open: boolean;
  errors: NodeError[];
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function NodeCardErrorPopover({
  nodeId,
  open,
  errors,
  anchorRef,
  onClose
}: NodeCardErrorPopoverProps) {
  const handleCloseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose();
  };
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const currentPanel = useNavigationStore((s) => s.currentPanel);

  // Close the popover if we leave the workflow view
  useEffect(() => {
    if (open && currentPanel !== 'workflow') {
      onClose();
    }
  }, [open, currentPanel, onClose]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const icon = anchorRef.current;
      if (!icon) return;
      const rect = icon.getBoundingClientRect();
      // Position below the icon, centered
      setPosition({
        top: rect.bottom + 8,
        left: Math.max(16, Math.min(rect.left + rect.width / 2 - 140, window.innerWidth - 296))
      });
    };

    updatePosition();

    const handleClickOutside = (event: PointerEvent) => {
      if (!event.target) return;
      // If clicking the anchor (error icon), let the anchor's click handler handle it
      if (anchorRef.current?.contains(event.target as Node)) return;

      // If clicking inside the popover, ignore
      if (popoverRef.current?.contains(event.target as Node)) return;

      // Otherwise, close
      onClose();
    };
    const handleScroll = () => {
      onClose();
    };
    document.addEventListener('pointerdown', handleClickOutside);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('pointerdown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, nodeId, onClose, anchorRef]);

  if (!open || errors.length === 0 || !position) return null;

  return createPortal(
    <div
      ref={popoverRef}
      id={`error-popover-${nodeId}`}
      className="error-popover-root fixed z-[2000] bg-red-50 border border-red-700 rounded-lg shadow-lg w-72 max-h-64 overflow-hidden"
      style={{ top: position.top, left: position.left }}
    >
      <div id={`error-popover-header-${nodeId}`} className="popover-header flex items-center justify-between px-3 py-2 border-b border-red-200 bg-red-700">
        <span id={`error-popover-title-${nodeId}`} className="popover-title text-sm font-semibold text-white">
          {errors.length} {errors.length === 1 ? 'Error' : 'Errors'}
        </span>
        <button
          type="button"
          onClick={handleCloseClick}
          className="w-6 h-6 flex items-center justify-center text-red-200 hover:text-white rounded"
          aria-label="Close"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
      <div id={`error-popover-body-${nodeId}`} className="popover-body p-3 space-y-2 bg-red-100">
        {errors.map((err, idx) => {
          const detailsLower = err.details?.toLowerCase().replace(/[_\s]/g, '') || '';
          const inputNameLower = err.inputName?.toLowerCase().replace(/[_\s]/g, '') || '';
          const isDetailsRedundant = !err.details ||
            err.details === err.message ||
            (err.inputName && detailsLower === inputNameLower);

          return (
            <div key={idx} className="error-item flex items-start gap-2 text-sm">
              <span
                className="error-dot mt-1.5 h-1.5 w-1.5 rounded-full bg-red-700 shrink-0"
                aria-hidden="true"
              />
              <div className="error-content-wrapper min-w-0">
                {err.inputName && (
                  <div className="error-input-name font-medium text-red-800 mb-0.5">
                    {err.inputName}
                  </div>
                )}
                <div className="error-message-text text-red-800">{err.message}</div>
                {!isDetailsRedundant && (
                  <div className="error-details-text text-xs text-red-700 mt-0.5 break-words">{err.details}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
