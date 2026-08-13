import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import type { NodeError } from '@/hooks/useWorkflowErrors';
import { useNavigationStore } from '@/hooks/useNavigation';
import type { RefObject } from 'react';
import { CheckIcon, ClipboardIcon, CloseIcon } from '@/components/icons';
import { copyTextToClipboard } from '@/utils/clipboard';

// Cap how much of a single error renders inline; the rest is available via Copy.
const ERROR_TEXT_CLAMP_LINES = 6;
const clampLinesStyle = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical' as const,
  WebkitLineClamp: ERROR_TEXT_CLAMP_LINES,
  overflow: 'hidden',
};

function buildErrorClipboardText(errors: NodeError[]): string {
  return errors
    .map((err) => {
      const lines: string[] = [];
      if (err.inputName) lines.push(err.inputName);
      if (err.message) lines.push(err.message);
      if (err.details && err.details !== err.message) lines.push(err.details);
      return lines.join('\n');
    })
    .join('\n\n');
}

interface NodeCardErrorPopoverProps {
  nodeId: number;
  open: boolean;
  errors: NodeError[];
  // Missing-node variant: instead of an error list, explain the node isn't
  // installed and offer to install it. `errors` is typically empty here.
  isMissing?: boolean;
  nodeType?: string;
  onInstall?: () => void;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

export function NodeCardErrorPopover({
  nodeId,
  open,
  errors,
  isMissing = false,
  nodeType,
  onInstall,
  anchorRef,
  onClose
}: NodeCardErrorPopoverProps) {
  const t = useT();
  const handleCloseClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onClose();
  };
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const currentPanel = useNavigationStore((s) => s.currentPanel);

  const handleCopyClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const ok = await copyTextToClipboard(buildErrorClipboardText(errors));
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

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

  if (!open || !position || (errors.length === 0 && !isMissing)) return null;

  return createPortal(
    <div
      ref={popoverRef}
      id={`error-popover-${nodeId}`}
      className="error-popover-root fixed z-[2000] flex flex-col bg-slate-900 border border-red-500/30 rounded-lg shadow-lg w-72 max-h-64 overflow-hidden"
      style={{ top: position.top, left: position.left }}
    >
      <div id={`error-popover-header-${nodeId}`} className="popover-header shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-red-500/40 bg-red-600">
        <span id={`error-popover-title-${nodeId}`} className="popover-title text-sm font-semibold text-white">
          {isMissing ? 'Missing Node' : t(errors.length === 1 ? '{count} Error' : '{count} Errors', { count: errors.length })}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {!isMissing && (
          <button
            type="button"
            onClick={handleCopyClick}
            className="flex items-center gap-1 h-6 px-1.5 text-xs font-medium text-red-100 hover:text-white rounded"
            aria-label={t('Copy error to clipboard')}
          >
            {copied ? <CheckIcon className="w-3.5 h-3.5" /> : <ClipboardIcon className="w-3.5 h-3.5" />}
            <span>{copied ? t('Copied') : t('Copy')}</span>
          </button>
          )}
          <button
            type="button"
            onClick={handleCloseClick}
            className="w-6 h-6 flex items-center justify-center text-red-100 hover:text-white rounded"
            aria-label={t('Close')}
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div id={`error-popover-body-${nodeId}`} className="popover-body flex-1 min-h-0 overflow-y-auto p-3 space-y-2 bg-slate-900">
        {isMissing ? (
          <div className="space-y-2 text-sm">
            <div className="text-slate-100">This custom node isn&apos;t installed on the server:</div>
            {nodeType && (
              <div className="font-mono text-xs text-red-300 break-words [overflow-wrap:anywhere]">{nodeType}</div>
            )}
            {onInstall && (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); onInstall(); }}
                className="mt-1 w-full rounded bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
              >
                Install missing node
              </button>
            )}
          </div>
        ) : (
          errors.map((err, idx) => {
          const detailsLower = err.details?.toLowerCase().replace(/[_\s]/g, '') || '';
          const inputNameLower = err.inputName?.toLowerCase().replace(/[_\s]/g, '') || '';
          const isDetailsRedundant = !err.details ||
            err.details === err.message ||
            (err.inputName && detailsLower === inputNameLower);

          return (
            <div key={idx} className="error-item flex items-start gap-2 text-sm">
              <span
                className="error-dot mt-1.5 h-1.5 w-1.5 rounded-full bg-red-400 shrink-0"
                aria-hidden="true"
              />
              <div className="error-content-wrapper min-w-0">
                {err.inputName && (
                  <div className="error-input-name font-medium text-red-300 mb-0.5">
                    {err.inputName}
                  </div>
                )}
                <div className="error-message-text text-slate-100 break-words" style={clampLinesStyle}>{err.message}</div>
                {!isDetailsRedundant && (
                  <div className="error-details-text text-xs text-slate-400 mt-0.5 break-words" style={clampLinesStyle}>{err.details}</div>
                )}
              </div>
            </div>
          );
          })
        )}
      </div>
    </div>,
    document.body
  );
}
