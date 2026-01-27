import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  title?: string;
  children: React.ReactNode;
}

export function SlidePanel({ open, onClose, side, title, children }: SlidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    if (!open) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[2300]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={`
          absolute top-0 bottom-0 w-[85%] max-w-sm bg-white shadow-xl
          flex flex-col overflow-hidden
          ${side === 'left' ? 'left-0 animate-slide-in-left' : 'right-0 animate-slide-in-right'}
        `}
        style={{
          animation: `${side === 'left' ? 'slideInLeft' : 'slideInRight'} 0.2s ease-out`
        }}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">{title}</h2>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full
                         text-gray-500 hover:bg-gray-100 text-2xl"
            >
              ×
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 overscroll-contain scroll-container">
          {children}
        </div>
      </div>

      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>,
    document.body
  );
}
