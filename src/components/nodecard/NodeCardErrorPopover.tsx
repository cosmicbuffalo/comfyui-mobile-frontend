import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NodeError } from '@/hooks/useWorkflow';
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
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

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

    const handleClickOutside = (event: MouseEvent) => {
      if (!event.target) return;
      if (anchorRef.current?.contains(event.target as Node)) return;
      const popover = document.getElementById(`error-popover-${nodeId}`);
      if (popover?.contains(event.target as Node)) return;
      onClose();
    };
    const handleScroll = () => {
      onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, nodeId, onClose, anchorRef]);

  if (!open || errors.length === 0 || !position) return null;

  return createPortal(
    <div
      id={`error-popover-${nodeId}`}
      className="fixed z-[2000] bg-red-50 border border-red-700 rounded-lg shadow-lg w-72 max-h-64 overflow-auto"
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-red-200 bg-red-700">
        <span className="text-sm font-semibold text-white">
          {errors.length} {errors.length === 1 ? 'Error' : 'Errors'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center text-red-200 hover:text-white rounded"
          aria-label="Close"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="p-3 space-y-2 bg-red-100">
        {errors.map((err, idx) => {
          const detailsLower = err.details?.toLowerCase().replace(/[_\s]/g, '') || '';
          const inputNameLower = err.inputName?.toLowerCase().replace(/[_\s]/g, '') || '';
          const isDetailsRedundant = !err.details ||
            err.details === err.message ||
            (err.inputName && detailsLower === inputNameLower);

          return (
            <div key={idx} className="flex items-start gap-2 text-sm">
              <span
                className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-700 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                {err.inputName && (
                  <div className="font-medium text-red-900 mb-0.5">
                    {err.inputName}
                  </div>
                )}
                <div className="text-red-800">{err.message}</div>
                {!isDetailsRedundant && (
                  <div className="text-xs text-red-700 mt-0.5 break-words">{err.details}</div>
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
