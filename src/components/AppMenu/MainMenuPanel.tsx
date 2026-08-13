import type { Workflow } from '@/api/types';
import type { SystemStats } from '@/api/client';
import { MenuErrorNotice } from './MenuErrorNotice';
import { MenuServerSection } from './MenuServerSection';
import { MenuLoadSection } from './MenuLoadSection';
import { MenuSaveSection } from './MenuSaveSection';
import { MenuAboutSection } from './MenuAboutSection';
import { LOCALE_LABELS, useI18n } from '@/i18n';
import {
  menuArrowClassName,
  menuSurfaceButtonClassName,
  menuTextClassName,
} from './menuStyles';

interface MenuSectionsOpen {
  load: boolean;
  save: boolean;
  server: boolean;
  info: boolean;
}

interface MainMenuPanelProps {
  error: string | null;
  workflow: Workflow | null;
  currentFilename: string | null;
  isDirty: boolean;
  loading: boolean;
  restartingServer: boolean;
  systemStats: SystemStats | null;
  cpuPercent: number | null;
  menuSectionsOpen: MenuSectionsOpen;
  loadSectionRef: React.RefObject<HTMLElement | null>;
  saveSectionRef: React.RefObject<HTMLElement | null>;
  serverSectionRef: React.RefObject<HTMLElement | null>;
  infoSectionRef: React.RefObject<HTMLElement | null>;
  onDismissError: () => void;
  onLoadFromFile: () => void;
  onToggleSection: (section: keyof MenuSectionsOpen) => void;
  onOpenRecent: () => void;
  onOpenUserWorkflows: () => void;
  onOpenTemplates: () => void;
  onOpenPasteJson: () => void;
  onSave: () => void;
  onOpenSaveAs: () => void;
  onOpenLegend: () => void;
  onRestartServer: () => void;
  onOpenGenerationSettings: () => void;
  onOpenCustomNodes: () => void;
  onOpenLanguage: () => void;
}

export function MainMenuPanel({
  error,
  workflow,
  currentFilename,
  isDirty,
  loading,
  restartingServer,
  systemStats,
  cpuPercent,
  menuSectionsOpen,
  loadSectionRef,
  saveSectionRef,
  serverSectionRef,
  infoSectionRef,
  onDismissError,
  onLoadFromFile,
  onToggleSection,
  onOpenRecent,
  onOpenUserWorkflows,
  onOpenTemplates,
  onOpenPasteJson,
  onSave,
  onOpenSaveAs,
  onOpenLegend,
  onRestartServer,
  onOpenGenerationSettings,
  onOpenCustomNodes,
  onOpenLanguage,
}: MainMenuPanelProps) {
  const { t, locale } = useI18n();
  return (
    <div className="pb-8">
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      <MenuServerSection
        open={menuSectionsOpen.server}
        systemStats={systemStats}
        cpuPercent={cpuPercent}
        restartingServer={restartingServer}
        sectionRef={serverSectionRef}
        onToggle={() => onToggleSection('server')}
        onRestartServer={onRestartServer}
        onOpenGenerationSettings={onOpenGenerationSettings}
        onOpenCustomNodes={onOpenCustomNodes}
      />

      <MenuLoadSection
        open={menuSectionsOpen.load}
        sectionRef={loadSectionRef}
        onToggle={() => onToggleSection('load')}
        onLoadFromFile={onLoadFromFile}
        onOpenRecent={onOpenRecent}
        onOpenUserWorkflows={onOpenUserWorkflows}
        onOpenTemplates={onOpenTemplates}
        onOpenPasteJson={onOpenPasteJson}
      />

      <MenuSaveSection
        open={menuSectionsOpen.save}
        workflow={workflow}
        currentFilename={currentFilename}
        isDirty={isDirty}
        loading={loading}
        sectionRef={saveSectionRef}
        onToggle={() => onToggleSection('save')}
        onSave={onSave}
        onOpenSaveAs={onOpenSaveAs}
      />

      <button
        type="button"
        onClick={onOpenLanguage}
        className={menuSurfaceButtonClassName}
      >
        <span aria-hidden="true" className="text-base leading-none">🌐</span>
        <span className={menuTextClassName}>{t('Language')}</span>
        <span className="ml-auto text-xs text-slate-500">{LOCALE_LABELS[locale]}</span>
        <span className={menuArrowClassName}>&rarr;</span>
      </button>

      <MenuAboutSection
        open={menuSectionsOpen.info}
        sectionRef={infoSectionRef}
        systemStats={systemStats}
        workflow={workflow}
        onToggle={() => onToggleSection('info')}
        onOpenLegend={onOpenLegend}
      />
    </div>
  );
}
