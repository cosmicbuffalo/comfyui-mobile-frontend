import { useState } from 'react';
import { BookIcon, CaretDownIcon, ExternalLinkIcon, GithubIcon, InfoCircleOutlineIcon, MegaphoneIcon } from '@/components/icons';
import { useI18n } from '@/i18n';
import type { SystemStats } from '@/api/client';
import type { Workflow } from '@/api/types';
import { REPO_URL } from '@/constants';
import { useFeedbackFollowsStore } from '@/hooks/useFeedbackFollows';
import { FeedbackDialog } from './FeedbackDialog';
import {
  menuMutedTextClassName,
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
  const { t } = useI18n();
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const follows = useFeedbackFollowsStore((s) => s.follows);
  const unfollow = useFeedbackFollowsStore((s) => s.unfollow);

  return (
    <section ref={sectionRef} className="mt-auto pt-6 border-t border-white/10">
      <button
        type="button"
        onClick={onToggle}
        className={menuSectionHeaderClassName}
        aria-expanded={open}
      >
        <span>{t('About')}</span>
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
            <span className={menuTextClassName}>{t('Send Feedback')}</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          {follows.length > 0 && (
            <div className="space-y-1 px-1">
              <p className={`text-xs ${menuMutedTextClassName}`}>{t('Feedback you follow')}</p>
              {follows.map((follow) => (
                <div key={follow.number} className="flex items-center gap-2 text-xs">
                  <a
                    href={`${REPO_URL}/issues/${follow.number}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-slate-300 hover:underline"
                  >
                    #{follow.number} {follow.title}
                  </a>
                  <button
                    type="button"
                    onClick={() => unfollow(follow.number).catch(() => {})}
                    className="shrink-0 rounded px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-slate-200"
                  >
                    {t('Stop following')}
                  </button>
                </div>
              ))}
            </div>
          )}

          <a
            href="https://github.com/cosmicbuffalo/comfyui-mobile-frontend"
            target="_blank"
            rel="noopener noreferrer"
            className={menuSurfaceButtonClassName}
          >
            <GithubIcon className={menuIconClassName} />
            <span className={menuTextClassName}>{t('Open in GitHub')}</span>
            <ExternalLinkIcon className={menuExternalIconClassName} />
          </a>

          <button
            onClick={onOpenLegend}
            className={menuSurfaceButtonClassName}
          >
            <InfoCircleOutlineIcon className={menuIconClassName} />
            <span className={menuTextClassName}>{t('Icon Legend')}</span>
            <span className={menuArrowClassName}>&rarr;</span>
          </button>

          <a
            href="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/USER_GUIDE.md"
            target="_blank"
            rel="noopener noreferrer"
            className={menuSurfaceButtonClassName}
          >
            <BookIcon className={menuIconClassName} />
            <span className={menuTextClassName}>{t('User Manual')}</span>
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
