import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useThemeStore } from '@/hooks/useTheme';
import { FullscreenModalHeader } from './FullscreenModalHeader';
interface FullscreenWidgetModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
}

export function FullscreenWidgetModal({
  isOpen,
  title,
  onClose,
  children,
  headerActions
}: FullscreenWidgetModalProps) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === 'dark';

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      const originalStyle = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[2100] bg-gray-400/40 dark:bg-black/50 backdrop-blur-sm safe-area-top"
      onClick={onClose}
    >
      <div
        className="w-full h-full flex flex-col"
        style={{
          paddingTop: 'env(--top-bar-offset, 0px)',
          paddingBottom: 'var(--bottom-bar-offset, 0px)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <FullscreenModalHeader
          title={title}
          onClose={onClose}
          headerActions={headerActions}
          isDark={isDark}
        />
        <div className="mt-2 px-4 pb-4">{children}</div>
        <div className="flex-1" onClick={onClose} />
      </div>
    </div>,
    document.body
  );
}
