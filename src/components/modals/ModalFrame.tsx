import type { ReactNode } from 'react';

interface ModalFrameProps {
  onClose: () => void;
  zIndex?: number;
  children: ReactNode;
}

export function ModalFrame({
  onClose,
  zIndex = 2200,
  children
}: ModalFrameProps) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-xl shadow-lg overflow-hidden bg-slate-900 border border-white/10 text-slate-100"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
