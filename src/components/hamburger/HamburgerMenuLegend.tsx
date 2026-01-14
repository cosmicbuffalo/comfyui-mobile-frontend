import { HamburgerMenuSubPageHeader } from './HamburgerMenuSubPageHeader';
import { BookmarkIconSvg, BookmarkOutlineIcon, CaretDownIcon, CloseIcon, EyeIcon, EyeOffIcon, NodeConnectionsLegendIcon, QueueStackIcon } from '@/components/icons';

interface HamburgerMenuLegendProps {
  onBack: () => void;
}

export function HamburgerMenuLegend({ onBack }: HamburgerMenuLegendProps) {
  return (
    <div className="flex flex-col h-full">
      <HamburgerMenuSubPageHeader title="Icon Legend" onBack={onBack} />

      <div className="space-y-3 overflow-y-auto flex-1 pb-4">
        {/* Run */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-8 h-8 flex items-center justify-center bg-blue-500 text-white rounded-lg font-bold text-xs shadow-sm">
            Run
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Run</p>
            <p className="text-xs text-gray-500">Execute current workflow</p>
          </div>
        </div>

        {/* Queue / Follow */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-10 h-10 flex items-center justify-center bg-white border border-gray-200 rounded-lg text-gray-700 shadow-sm overflow-hidden">
            <QueueStackIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Queue / Follow</p>
            <p className="text-xs text-gray-500">View queue & follow execution</p>
          </div>
        </div>

        {/* Pinned Widget */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-10 h-10 flex items-center justify-center bg-yellow-500 text-white rounded-lg shadow-sm">
            <BookmarkIconSvg className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Pinned Widget</p>
            <p className="text-xs text-gray-500">Quick access to bookmarked parameter</p>
          </div>
        </div>

        {/* Input Connection */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full border border-gray-200 text-gray-700 font-bold">
            ←
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Input</p>
            <p className="text-xs text-gray-500">Node input connection point</p>
          </div>
        </div>

        {/* Output Connection */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded-full border border-gray-200 text-gray-700 font-bold">
            →
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Output</p>
            <p className="text-xs text-gray-500">Node output connection point</p>
          </div>
        </div>

        {/* Highlight connections */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-8 h-8 flex items-center justify-center text-gray-700">
            <NodeConnectionsLegendIcon className="w-6 h-6 overflow-visible" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Trace Connections</p>
            <p className="text-xs text-gray-500">Highlight connected nodes</p>
          </div>
        </div>

        {/* Fold/Unfold */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-8 h-8 flex items-center justify-center text-gray-500">
            <CaretDownIcon className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Fold / Unfold</p>
            <p className="text-xs text-gray-500">Collapse or expand node card</p>
          </div>
        </div>

        {/* Bypass */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-8 h-8 flex items-center justify-center text-gray-700">
            <CloseIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Bypass</p>
            <p className="text-xs text-gray-500">Skip node execution</p>
          </div>
        </div>

        {/* Hide */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-8 h-8 flex items-center justify-center text-gray-700">
            <EyeOffIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Hide</p>
            <p className="text-xs text-gray-500">Hide node from view</p>
          </div>
        </div>

        {/* Show */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-8 h-8 flex items-center justify-center text-gray-700">
            <EyeIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Show</p>
            <p className="text-xs text-gray-500">Make node visible again</p>
          </div>
        </div>

        {/* Bookmark */}
        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-100 rounded-lg shadow-sm">
          <div className="w-8 h-8 flex items-center justify-center text-gray-700">
            <BookmarkOutlineIcon className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">Bookmark</p>
            <p className="text-xs text-gray-500">Pin widget to bottom bar</p>
          </div>
        </div>
      </div>
    </div>
  );
}
