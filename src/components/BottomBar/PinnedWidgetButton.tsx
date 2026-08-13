import { PinIconSvg } from '@/components/icons';
import { usePinnedWidgetStore } from '@/hooks/usePinnedWidget';
import { appChromeIconButtonClassName, chromeBarButtonClassName } from '@/components/chromeStyles';
import { useT } from '@/i18n';

export function PinnedWidgetButton() {
  const t = useT();
  const pinnedWidget = usePinnedWidgetStore((s) => s.pinnedWidget);
  const pinOverlayOpen = usePinnedWidgetStore((s) => s.pinOverlayOpen);
  const togglePinOverlay = usePinnedWidgetStore((s) => s.togglePinOverlay);

  if (!pinnedWidget) return null;

  return (
    <button
      onClick={togglePinOverlay}
      className={`${chromeBarButtonClassName} ${
        pinOverlayOpen
          ? 'bg-fuchsia-500 border border-fuchsia-500 text-white'
          : appChromeIconButtonClassName
      }`}
      aria-label={pinOverlayOpen ? t('Close pin editor') : t('Open pin editor')}
    >
      <PinIconSvg className="w-6 h-6" />
    </button>
  );
}
