import { CaretDownIcon, SaveAsIcon, SaveDiskIcon } from '@/components/icons';
import type { Workflow } from '@/api/types';
import { getDisplayName } from './userWorkflowHelpers';
import {
  menuArrowClassName,
  menuChevronClassName,
  menuIconClassName,
  menuSectionHeaderClassName,
  menuSurfaceButtonClassName,
  menuSurfaceButtonDisabledClassName,
  menuTextClassName,
} from './menuStyles';
import { CollapsibleMenuSection } from './CollapsibleMenuSection';

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
        className={menuSectionHeaderClassName}
        aria-expanded={open}
      >
        <span>Save Workflow</span>
        <CaretDownIcon className={`${menuChevronClassName} ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      <CollapsibleMenuSection open={open}>
        <div className="space-y-2 pb-1">
          {currentFilename && (
            <button
              onClick={onSave}
              disabled={!workflow || !isDirty || loading}
              className={menuSurfaceButtonDisabledClassName}
            >
              <SaveDiskIcon className={`${menuIconClassName} shrink-0`} />
              <span className={`${menuTextClassName} truncate`}>Save {getDisplayName(currentFilename)}</span>
            </button>
          )}

          <button
            onClick={onOpenSaveAs}
            disabled={!workflow}
            className={menuSurfaceButtonClassName}
          >
            <SaveAsIcon className={menuIconClassName} />
            <span className={menuTextClassName}>Save As...</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>
        </div>
      </CollapsibleMenuSection>
    </section>
  );
}
