import { useState } from 'react';
import { BookIcon, CaretDownIcon, ExternalLinkIcon, GithubIcon, InfoCircleOutlineIcon, MegaphoneIcon } from '@/components/icons';
import type { SystemStats } from '@/api/client';
import type { Workflow } from '@/api/types';
import { FeedbackDialog } from './FeedbackDialog';
import {
  menuArrowClassName,
  menuChevronClassName,
  menuExternalIconClassName,
  menuIconClassName,
  menuSectionHeaderClassName,
  menuSurfaceButtonClassName,
  menuTextClassName,
} from './menuStyles';
import { CollapsibleMenuSection } from './CollapsibleMenuSection';

interface MenuAboutSectionProps {
  open: boolean;
  sectionRef: React.RefObject<HTMLElement | null>;
  systemStats: SystemStats | null;
  workflow: Workflow | null;
  onToggle: () => void;
  onOpenLegend: () => void;
}

export function MenuAboutSection({
  open,
  sectionRef,
  systemStats,
  workflow,
  onToggle,
  onOpenLegend,
}: MenuAboutSectionProps) {
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);

  return (
    <section ref={sectionRef} className="mt-auto pt-6 border-t border-white/10">
      <button
        type="button"
        onClick={onToggle}
        className={menuSectionHeaderClassName}
        aria-expanded={open}
      >
        <span>About</span>
        <CaretDownIcon className={`${menuChevronClassName} ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      <CollapsibleMenuSection open={open}>
        <div className="space-y-2 pb-4">
          <button
            type="button"
            onClick={() => setFeedbackDialogOpen(true)}
            className={menuSurfaceButtonClassName}
          >
            <MegaphoneIcon className={menuIconClassName} />
            <span className={menuTextClassName}>Send Feedback</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <a
            href="https://github.com/cosmicbuffalo/comfyui-mobile-frontend"
            target="_blank"
            rel="noopener noreferrer"
            className={menuSurfaceButtonClassName}
          >
            <GithubIcon className={menuIconClassName} />
            <span className={menuTextClassName}>Open in GitHub</span>
            <ExternalLinkIcon className={menuExternalIconClassName} />
          </a>

          <button
            onClick={onOpenLegend}
            className={menuSurfaceButtonClassName}
          >
            <InfoCircleOutlineIcon className={menuIconClassName} />
            <span className={menuTextClassName}>Icon Legend</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <a
            href="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/USER_GUIDE.md"
            target="_blank"
            rel="noopener noreferrer"
            className={menuSurfaceButtonClassName}
          >
            <BookIcon className={menuIconClassName} />
            <span className={menuTextClassName}>User Manual</span>
            <ExternalLinkIcon className={menuExternalIconClassName} />
          </a>
        </div>
      </CollapsibleMenuSection>
      {feedbackDialogOpen && (
        <FeedbackDialog
          systemStats={systemStats}
          workflow={workflow}
          onClose={() => setFeedbackDialogOpen(false)}
        />
      )}
    </section>
  );
}
