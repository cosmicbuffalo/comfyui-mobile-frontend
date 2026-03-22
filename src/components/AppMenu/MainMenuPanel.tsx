import type { Workflow } from '@/api/types';
import type { SystemStats } from '@/api/client';
import { MenuErrorNotice } from './MenuErrorNotice';
import { MenuServerSection } from './MenuServerSection';
import { MenuLoadSection } from './MenuLoadSection';
import { MenuSaveSection } from './MenuSaveSection';
import { MenuAboutSection } from './MenuAboutSection';

interface MenuSectionsOpen {
  load: boolean;
  save: boolean;
  appearance: boolean;
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
  theme: 'dark' | 'light';
  menuSectionsOpen: MenuSectionsOpen;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  loadSectionRef: React.RefObject<HTMLElement | null>;
  saveSectionRef: React.RefObject<HTMLElement | null>;
  appearanceSectionRef: React.RefObject<HTMLElement | null>;
  serverSectionRef: React.RefObject<HTMLElement | null>;
  infoSectionRef: React.RefObject<HTMLElement | null>;
  onDismissError: () => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadFromFile: () => void;
  onToggleSection: (section: keyof MenuSectionsOpen) => void;
  onOpenRecent: () => void;
  onOpenUserWorkflows: () => void;
  onOpenTemplates: () => void;
  onOpenPasteJson: () => void;
  onSave: () => void;
  onOpenSaveAs: () => void;
  onToggleTheme: () => void;
  onOpenLegend: () => void;
  onRestartServer: () => void;
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
  fileInputRef,
  loadSectionRef,
  saveSectionRef,
  serverSectionRef,
  infoSectionRef,
  onDismissError,
  onFileChange,
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
}: MainMenuPanelProps) {
  return (
    <>
      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      <MenuServerSection
        open={menuSectionsOpen.server}
        systemStats={systemStats}
        cpuPercent={cpuPercent}
        restartingServer={restartingServer}
        sectionRef={serverSectionRef}
        onToggle={() => onToggleSection('server')}
        onRestartServer={onRestartServer}
      />

      <MenuLoadSection
        open={menuSectionsOpen.load}
        sectionRef={loadSectionRef}
        fileInputRef={fileInputRef}
        onToggle={() => onToggleSection('load')}
        onFileChange={onFileChange}
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

      {/*
        TODO (temporary): appearance theme toggle is intentionally disabled while we stabilize dark-mode visual styling.
        Re-enable this section once light mode gets a dedicated visual pass.
      */}

      <MenuAboutSection
        open={menuSectionsOpen.info}
        sectionRef={infoSectionRef}
        onToggle={() => onToggleSection('info')}
        onOpenLegend={onOpenLegend}
      />
    </>
  );
}
