import { ChevronLeftBoldIcon } from '@/components/icons';
import { useNavigationStore, type PanelMode } from '@/hooks/useNavigation';
import {
  getTopBarPanelNavigation,
  type TopBarPanelNavigationItem,
} from './panelNavigationConfig';

function DirectionChevron({
  direction,
  jumps,
}: Pick<TopBarPanelNavigationItem, 'direction' | 'jumps'>) {
  const rotation = direction === 'right' ? 'rotate-180' : '';
  return (
    <span className="flex w-8 shrink-0 items-center justify-center" aria-hidden="true">
      <ChevronLeftBoldIcon className={`h-6 w-6 ${rotation}`} />
      {jumps === 2 && (
        <ChevronLeftBoldIcon className={`-ml-3.5 h-6 w-6 ${rotation}`} />
      )}
    </span>
  );
}

function NavigationButton({ item }: { item: TopBarPanelNavigationItem }) {
  const setCurrentPanel = useNavigationStore((s) => s.setCurrentPanel);
  const chevron = <DirectionChevron direction={item.direction} jumps={item.jumps} />;

  return (
    <button
      type="button"
      onClick={() => setCurrentPanel(item.panel)}
      aria-label={`Go to ${item.label}`}
      className="flex h-10 items-center gap-1.5 px-1 text-sm font-medium text-slate-400 transition-colors hover:text-slate-100 focus-visible:outline-none focus-visible:text-slate-100"
    >
      {item.direction === 'left' && chevron}
      <span>{item.label}</span>
      {item.direction === 'right' && chevron}
    </button>
  );
}

export function TopBarPanelNavigation({
  mode,
  side,
}: {
  mode: PanelMode;
  side: 'left' | 'right';
}) {
  const items = getTopBarPanelNavigation(mode)[side];

  return (
    <nav
      aria-label={`${side === 'left' ? 'Previous' : 'Next'} panels`}
      className={`hidden items-center gap-2 lg:flex ${
        side === 'left'
          ? 'col-start-1 justify-start pl-3'
          : 'col-start-3 justify-end pr-3'
      }`}
    >
      {items.map((item) => (
        <NavigationButton key={item.panel} item={item} />
      ))}
    </nav>
  );
}
