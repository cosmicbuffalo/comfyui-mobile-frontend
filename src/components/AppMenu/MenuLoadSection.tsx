import { CaretDownIcon, ClipboardDownloadIcon, ClockIcon, FolderIcon, TemplateIcon, WorkflowIcon } from '@/components/icons';
import {
  menuArrowClassName,
  menuChevronClassName,
  menuIconClassName,
  menuSectionHeaderClassName,
  menuSurfaceButtonClassName,
  menuTextClassName,
} from './menuStyles';
import { CollapsibleMenuSection } from './CollapsibleMenuSection';

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
        accept=".json,.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        onChange={onFileChange}
        className="hidden"
      />

      <button
        type="button"
        onClick={onToggle}
        className={menuSectionHeaderClassName}
        aria-expanded={open}
      >
        <span>Load Workflow</span>
        <CaretDownIcon className={`${menuChevronClassName} ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      <CollapsibleMenuSection open={open}>
        <div className="space-y-2 pb-1">
          <button
            onClick={onOpenRecent}
            className={menuSurfaceButtonClassName}
          >
            <ClockIcon className={menuIconClassName} />
            <span className={menuTextClassName}>Recent</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <button
            onClick={onOpenUserWorkflows}
            className={menuSurfaceButtonClassName}
          >
            <WorkflowIcon className={menuIconClassName} />
            <span className={menuTextClassName}>My Workflows</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <button
            onClick={onOpenTemplates}
            className={menuSurfaceButtonClassName}
          >
            <TemplateIcon className={menuIconClassName} />
            <span className={menuTextClassName}>Templates</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <button
            onClick={onOpenPasteJson}
            className={menuSurfaceButtonClassName}
          >
            <ClipboardDownloadIcon className={menuIconClassName} />
            <span className={menuTextClassName}>Paste JSON</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <button
            onClick={onLoadFromFile}
            className={menuSurfaceButtonClassName}
          >
            <FolderIcon className={menuIconClassName} />
            <span className={menuTextClassName}>From Device</span>
          </button>
        </div>
      </CollapsibleMenuSection>
    </section>
  );
}
