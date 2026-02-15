import { MenuSubPageHeader } from './MenuSubPageHeader';
import { LegendItem, type LegendItemProps } from './LegendItem';
import {
  CaretDownIcon,
  CloseIcon,
  EyeIcon,
  EyeOffIcon,
  NodeConnectionsLegendIcon,
  PinIconSvg,
  PinOutlineIcon,
  QueueStackIcon
} from '@/components/icons';

interface MenuLegendProps {
  onBack: () => void;
}

function getLegendItems(): LegendItemProps[] {
  return [
    {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center bg-blue-500 text-white rounded-lg font-bold text-xs shadow-sm">
          Run
        </div>
      ),
      title: 'Run',
      description: 'Execute current workflow'
    },
    {
      icon: (
        <div className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-lg text-gray-700 shadow-sm overflow-hidden">
          <QueueStackIcon className="w-5 h-5" />
        </div>
      ),
      title: 'Queue / Follow',
      description: 'View queue & follow execution'
    },
    {
      icon: (
        <div className="w-10 h-10 flex items-center justify-center bg-yellow-500 text-white rounded-lg shadow-sm">
          <PinIconSvg className="w-5 h-5" />
        </div>
      ),
      title: 'Pinned Widget',
      description: 'Quick access to pinned parameter'
    },
    {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full border border-gray-200 text-gray-700 font-bold">
          ←
        </div>
      ),
      title: 'Input',
      description: 'Node input connection point'
    },
    {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full border border-gray-200 text-gray-700 font-bold">
          →
        </div>
      ),
      title: 'Output',
      description: 'Node output connection point'
    },
    {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center text-gray-700">
          <NodeConnectionsLegendIcon className="w-6 h-6 overflow-visible" />
        </div>
      ),
      title: 'Trace Connections',
      description: 'Highlight connected nodes'
    },
    {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center text-gray-500">
          <CaretDownIcon className="w-6 h-6" />
        </div>
      ),
      title: 'Fold / Unfold',
      description: 'Collapse or expand node card'
    },
    {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center text-gray-700">
          <CloseIcon className="w-5 h-5" />
        </div>
      ),
      title: 'Bypass',
      description: 'Skip node execution'
    },
    {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center text-gray-700">
          <EyeOffIcon className="w-5 h-5" />
        </div>
      ),
      title: 'Hide',
      description: 'Hide node from view'
    },
    {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center text-gray-700">
          <EyeIcon className="w-5 h-5" />
        </div>
      ),
      title: 'Show',
      description: 'Make node visible again'
    },
    {
      icon: (
        <div className="w-8 h-8 flex items-center justify-center text-gray-700">
          <PinOutlineIcon className="w-5 h-5" />
        </div>
      ),
      title: 'Pin widget',
      description: 'Pin widget to bottom bar'
    }
  ];
}

export function MenuLegend({ onBack }: MenuLegendProps) {
  const items = getLegendItems();

  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title="Icon Legend" onBack={onBack} />

      <div className="space-y-3 overflow-y-auto flex-1 pb-4">
        {items.map((item) => (
          <LegendItem
            key={item.title}
            icon={item.icon}
            title={item.title}
            description={item.description}
          />
        ))}
      </div>
    </div>
  );
}
