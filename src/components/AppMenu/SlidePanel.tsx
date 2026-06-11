import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  title?: string;
  children: React.ReactNode;
}

export function SlidePanel({ open, onClose, side, title, children }: SlidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEscapeKey(open, onClose);
  useBodyScrollLock(open);

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
          absolute top-0 bottom-0 w-[90%] max-w-[400px] bg-slate-950/88 shadow-2xl
          flex flex-col overflow-hidden
          ${side === 'left' ? 'left-0 animate-slide-in-left' : 'right-0 animate-slide-in-right'}
        `}
        style={{
          animation: `${side === 'left' ? 'slideInLeft' : 'slideInRight'} 0.2s ease-out`
        }}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between p-4 border-b border-white/10 bg-slate-950/88">
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full
                         text-slate-300 hover:bg-white/10 text-2xl"
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
