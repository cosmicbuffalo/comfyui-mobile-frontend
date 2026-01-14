import { createPortal } from 'react-dom';

interface QueueToastProps {
  message: string | null;
}

export function QueueToast({ message }: QueueToastProps) {
  if (!message) return null;
  return createPortal(
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[1300] bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-200">
      {message}
    </div>,
    document.body
  );
}
