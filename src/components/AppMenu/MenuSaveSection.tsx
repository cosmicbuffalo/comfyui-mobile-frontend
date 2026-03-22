import { CaretDownIcon, SaveAsIcon, SaveDiskIcon } from '@/components/icons';
import type { Workflow } from '@/api/types';
import { getDisplayName } from './userWorkflowHelpers';

interface MenuSaveSectionProps {
  open: boolean;
  workflow: Workflow | null;
  currentFilename: string | null;
  isDirty: boolean;
  loading: boolean;
  sectionRef: React.RefObject<HTMLElement | null>;
  onToggle: () => void;
  onSave: () => void;
  onOpenSaveAs: () => void;
}

export function MenuSaveSection({
  open,
  workflow,
  currentFilename,
  isDirty,
  loading,
  sectionRef,
  onToggle,
  onSave,
  onOpenSaveAs,
}: MenuSaveSectionProps) {
  return (
    <section ref={sectionRef} className="mb-6">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
        aria-expanded={open}
      >
        <span>Save Workflow</span>
        <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="space-y-2">
          {currentFilename && (
            <button
              onClick={onSave}
              disabled={!workflow || !isDirty || loading}
              className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <SaveDiskIcon className="w-6 h-6 text-gray-600 shrink-0" />
              <span className="font-medium text-gray-900 truncate">Save {getDisplayName(currentFilename)}</span>
            </button>
          )}

          <button
            onClick={onOpenSaveAs}
            disabled={!workflow}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <SaveAsIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">Save As...</span>
            <span className="ml-auto text-gray-400">&rarr;</span>
          </button>
        </div>
      )}
    </section>
  );
}
