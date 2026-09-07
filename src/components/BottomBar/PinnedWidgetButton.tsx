import { PinIconSvg } from '@/components/icons';
import { usePinnedWidgetStore } from '@/hooks/usePinnedWidget';
import {
  appChromeIconButtonClassName,
  chromeBarButtonClassName,
  pinAccentActiveClassName,
} from '@/components/chromeStyles';
import { useI18n } from '@/i18n';

export function PinnedWidgetButton() {
  const { t } = useI18n();
  const pinnedWidget = usePinnedWidgetStore((s) => s.pinnedWidget);
  const pinOverlayOpen = usePinnedWidgetStore((s) => s.pinOverlayOpen);
  const togglePinOverlay = usePinnedWidgetStore((s) => s.togglePinOverlay);

  if (!pinnedWidget) return null;

  return (
    <button
      onClick={togglePinOverlay}
      className={`${chromeBarButtonClassName} ${
        pinOverlayOpen
          ? pinAccentActiveClassName
          : appChromeIconButtonClassName
      }`}
      aria-label={pinOverlayOpen ? t('Close pin editor') : t('Open pin editor')}
    >
      <PinIconSvg className="w-6 h-6" />
    </button>
  );
}
