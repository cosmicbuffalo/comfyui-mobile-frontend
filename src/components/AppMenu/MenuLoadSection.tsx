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
import { useT } from '@/i18n';

interface MenuLoadSectionProps {
  open: boolean;
  sectionRef: React.RefObject<HTMLElement | null>;
  onToggle: () => void;
  onLoadFromFile: () => void;
  onOpenRecent: () => void;
  onOpenUserWorkflows: () => void;
  onOpenTemplates: () => void;
  onOpenPasteJson: () => void;
}

export function MenuLoadSection({
  open,
  sectionRef,
  onToggle,
  onLoadFromFile,
  onOpenRecent,
  onOpenUserWorkflows,
  onOpenTemplates,
  onOpenPasteJson,
}: MenuLoadSectionProps) {
  const t = useT();
  return (
    <section ref={sectionRef} className="mb-6">
      <button
        type="button"
        onClick={onToggle}
        className={menuSectionHeaderClassName}
        aria-expanded={open}
      >
        <span>{t('Load Workflow')}</span>
        <CaretDownIcon className={`${menuChevronClassName} ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      <CollapsibleMenuSection open={open}>
        <div className="space-y-2 pb-1">
          <button
            onClick={onOpenRecent}
            className={menuSurfaceButtonClassName}
          >
            <ClockIcon className={menuIconClassName} />
            <span className={menuTextClassName}>{t('Recent')}</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <button
            onClick={onOpenUserWorkflows}
            className={menuSurfaceButtonClassName}
          >
            <WorkflowIcon className={menuIconClassName} />
            <span className={menuTextClassName}>{t('My Workflows')}</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <button
            onClick={onOpenTemplates}
            className={menuSurfaceButtonClassName}
          >
            <TemplateIcon className={menuIconClassName} />
            <span className={menuTextClassName}>{t('Templates')}</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <button
            onClick={onOpenPasteJson}
            className={menuSurfaceButtonClassName}
          >
            <ClipboardDownloadIcon className={menuIconClassName} />
            <span className={menuTextClassName}>{t('Paste JSON')}</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <button
            onClick={onLoadFromFile}
            className={menuSurfaceButtonClassName}
          >
            <FolderIcon className={menuIconClassName} />
            <span className={menuTextClassName}>{t('From Device')}</span>
          </button>
        </div>
      </CollapsibleMenuSection>
    </section>
  );
}
