import { useState, useEffect } from 'react';
import { WorkflowIcon, TemplateIcon, ClockIcon, DocumentIcon } from '@/components/icons';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import { useRecentWorkflowsStore, type RecentWorkflowEntry } from '@/hooks/useRecentWorkflows';
import { getDisplayName } from './userWorkflowHelpers';
import { formatRelativeDate } from './formatRelativeDate';
import { getFileWorkflowAvailability } from '@/api/client';

interface RecentWorkflowsPanelProps {
  onBack: () => void;
  onLoadUserWorkflow: (filename: string) => void;
  onLoadTemplate: (moduleName: string, templateName: string) => void;
  onLoadFileWorkflow: (filePath: string, assetSource: 'output' | 'input' | 'temp') => void;
}

function getSourceLabel(entry: RecentWorkflowEntry): string | null {
  if (!entry.source) return null;
  switch (entry.source.type) {
    case 'user': return null;
    case 'template': return 'Template';
    case 'history': return 'History';
    case 'file':
      switch (entry.source.assetSource) {
        case 'input': return 'Input';
        case 'temp': return 'Temp';
        default: return 'Output';
      }
    case 'other': return null;
  }
}

function isReloadable(entry: RecentWorkflowEntry): boolean {
  if (!entry.source) return false;
  return entry.source.type === 'user' || entry.source.type === 'template' || entry.source.type === 'file';
}

function getEntryDisplayName(entry: RecentWorkflowEntry): string {
  // For file sources, show the original file path basename instead of the synthetic workflow filename
  if (entry.source?.type === 'file') {
    const filePath = entry.source.filePath;
    return filePath.includes('/') ? filePath.substring(filePath.lastIndexOf('/') + 1) : filePath;
  }
  return getDisplayName(entry.filename);
}

function getEntryIcon(entry: RecentWorkflowEntry) {
  if (entry.source?.type === 'template') return TemplateIcon;
  if (entry.source?.type === 'file') return DocumentIcon;
  return WorkflowIcon;
}

export function RecentWorkflowsPanel({
  onBack,
  onLoadUserWorkflow,
  onLoadTemplate,
  onLoadFileWorkflow,
}: RecentWorkflowsPanelProps) {
  const entries = useRecentWorkflowsStore((s) => s.entries);
  const clearEntries = useRecentWorkflowsStore((s) => s.clearEntries);

  // Track which file-source entries are unavailable (file deleted/missing)
  const [unavailable, setUnavailable] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const fileEntries = entries
      .map((e, i) => ({ entry: e, index: i }))
      .filter((x) => x.entry.source?.type === 'file');

    if (fileEntries.length === 0) return;

    Promise.all(
      fileEntries.map(async ({ entry, index }) => {
        if (entry.source?.type !== 'file') return null;
        try {
          const available = await getFileWorkflowAvailability(entry.source.filePath, entry.source.assetSource);
          return available ? null : index;
        } catch {
          return index;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const missing = new Set(results.filter((i): i is number => i !== null));
      setUnavailable(missing);
    });

    return () => { cancelled = true; };
  }, [entries]);

  const handleLoad = (entry: RecentWorkflowEntry) => {
    if (!entry.source) return;
    switch (entry.source.type) {
      case 'user':
        onLoadUserWorkflow(entry.source.filename);
        break;
      case 'template':
        onLoadTemplate(entry.source.moduleName, entry.source.templateName);
        break;
      case 'file':
        onLoadFileWorkflow(entry.source.filePath, entry.source.assetSource);
        break;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader
        title="Recent"
        onBack={onBack}
        rightElement={entries.length > 0 ? (
          <button
            onClick={clearEntries}
            className="text-xs font-semibold text-red-500"
          >
            Clear
          </button>
        ) : undefined}
      />

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <ClockIcon className="w-10 h-10 mb-3 text-gray-300" />
          <p className="text-sm">No recent workflows</p>
        </div>
      ) : (
        <div className="space-y-2 overflow-y-auto flex-1">
          {entries.map((entry, i) => {
            const reloadable = isReloadable(entry) && !unavailable.has(i);
            const sourceLabel = getSourceLabel(entry);
            const Icon = getEntryIcon(entry);

            return (
              <button
                key={`${entry.filename}-${entry.timestamp}-${i}`}
                onClick={() => handleLoad(entry)}
                disabled={!reloadable}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200
                           rounded-xl text-left hover:bg-gray-50 min-h-[56px]
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Icon className="w-5 h-5 text-gray-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">
                    {getEntryDisplayName(entry)}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <span>{formatRelativeDate(entry.timestamp / 1000)}</span>
                    {sourceLabel && (
                      <>
                        <span className="text-gray-300">&middot;</span>
                        <span>{sourceLabel}</span>
                      </>
                    )}
                    {unavailable.has(i) && (
                      <>
                        <span className="text-gray-300">&middot;</span>
                        <span className="text-red-400">File missing</span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
