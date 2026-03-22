import { CaretDownIcon, ClipboardDownloadIcon, ClockIcon, FolderIcon, TemplateIcon, WorkflowIcon } from '@/components/icons';

interface MenuLoadSectionProps {
  open: boolean;
  sectionRef: React.RefObject<HTMLElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadFromFile: () => void;
  onOpenRecent: () => void;
  onOpenUserWorkflows: () => void;
  onOpenTemplates: () => void;
  onOpenPasteJson: () => void;
}

export function MenuLoadSection({
  open,
  sectionRef,
  fileInputRef,
  onToggle,
  onFileChange,
  onLoadFromFile,
  onOpenRecent,
  onOpenUserWorkflows,
  onOpenTemplates,
  onOpenPasteJson,
}: MenuLoadSectionProps) {
  return (
    <section ref={sectionRef} className="mb-6">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={onFileChange}
        className="hidden"
      />

      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
        aria-expanded={open}
      >
        <span>Load Workflow</span>
        <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="space-y-2">
          <button
            onClick={onOpenRecent}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <ClockIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">Recent</span>
            <span className="ml-auto text-gray-400">&rarr;</span>
          </button>

          <button
            onClick={onOpenUserWorkflows}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <WorkflowIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">My Workflows</span>
            <span className="ml-auto text-gray-400">&rarr;</span>
          </button>

          <button
            onClick={onOpenTemplates}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <TemplateIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">Templates</span>
            <span className="ml-auto text-gray-400">&rarr;</span>
          </button>

          <button
            onClick={onOpenPasteJson}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <ClipboardDownloadIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">Paste JSON</span>
            <span className="ml-auto text-gray-400">&rarr;</span>
          </button>

          <button
            onClick={onLoadFromFile}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <FolderIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">From Device</span>
          </button>
        </div>
      )}
    </section>
  );
}
