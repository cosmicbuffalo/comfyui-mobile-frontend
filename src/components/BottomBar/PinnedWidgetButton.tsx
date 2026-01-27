import { PinIconSvg } from '@/components/icons';
import { usePinnedWidgetStore } from '@/hooks/usePinnedWidget';

export function PinnedWidgetButton() {
  const pinnedWidget = usePinnedWidgetStore((s) => s.pinnedWidget);
  const pinOverlayOpen = usePinnedWidgetStore((s) => s.pinOverlayOpen);
  const togglePinOverlay = usePinnedWidgetStore((s) => s.togglePinOverlay);

  if (!pinnedWidget) return null;

  return (
    <button
      onClick={togglePinOverlay}
      className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors ${
        pinOverlayOpen
          ? 'bg-fuchsia-500 text-white'
          : 'bg-gray-100 text-fuchsia-500 hover:bg-gray-200'
      }`}
      aria-label={pinOverlayOpen ? 'Close pin editor' : 'Open pin editor'}
    >
      <PinIconSvg className="w-6 h-6" />
    </button>
  );
}
