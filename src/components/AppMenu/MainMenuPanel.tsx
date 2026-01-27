import { BookIcon, CaretDownIcon, ClipboardDownloadIcon, ExternalLinkIcon, FolderIcon, GithubIcon, InfoCircleOutlineIcon, MoonIcon, SaveAsIcon, SaveDiskIcon, SunIcon, TemplateIcon, WorkflowLoadIcon } from '@/components/icons';
import type { Workflow } from '@/api/types';
import { MenuErrorNotice } from './MenuErrorNotice';

interface MenuSectionsOpen {
  load: boolean;
  save: boolean;
  appearance: boolean;
  info: boolean;
}

interface MainMenuPanelProps {
  error: string | null;
  workflow: Workflow | null;
  currentFilename: string | null;
  isDirty: boolean;
  loading: boolean;
  theme: 'dark' | 'light';
  menuSectionsOpen: MenuSectionsOpen;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  loadSectionRef: React.RefObject<HTMLElement | null>;
  saveSectionRef: React.RefObject<HTMLElement | null>;
  appearanceSectionRef: React.RefObject<HTMLElement | null>;
  infoSectionRef: React.RefObject<HTMLElement | null>;
  onDismissError: () => void;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onLoadFromFile: () => void;
  onToggleSection: (section: keyof MenuSectionsOpen) => void;
  onOpenUserWorkflows: () => void;
  onOpenTemplates: () => void;
  onOpenPasteJson: () => void;
  onSave: () => void;
  onOpenSaveAs: () => void;
  onToggleTheme: () => void;
  onOpenLegend: () => void;
}

export function MainMenuPanel({
  error,
  workflow,
  currentFilename,
  isDirty,
  loading,
  theme,
  menuSectionsOpen,
  fileInputRef,
  loadSectionRef,
  saveSectionRef,
  appearanceSectionRef,
  infoSectionRef,
  onDismissError,
  onFileChange,
  onLoadFromFile,
  onToggleSection,
  onOpenUserWorkflows,
  onOpenTemplates,
  onOpenPasteJson,
  onSave,
  onOpenSaveAs,
  onToggleTheme,
  onOpenLegend,
}: MainMenuPanelProps) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={onFileChange}
        className="hidden"
      />

      <MenuErrorNotice error={error} onDismiss={onDismissError} />

      <section ref={loadSectionRef} className="mb-6">
        <button
          type="button"
          onClick={() => onToggleSection('load')}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
          aria-expanded={menuSectionsOpen.load}
        >
          <span>Load Workflow</span>
          <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${menuSectionsOpen.load ? 'rotate-0' : '-rotate-90'}`} />
        </button>
        {menuSectionsOpen.load && (
          <div className="space-y-2">
            <button
              onClick={onOpenUserWorkflows}
              className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              <WorkflowLoadIcon className="w-6 h-6 text-gray-600" />
              <span className="font-medium text-gray-900">My Workflows</span>
              <span className="ml-auto text-gray-400">→</span>
            </button>

            <button
              onClick={onOpenTemplates}
              className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              <TemplateIcon className="w-6 h-6 text-gray-600" />
              <span className="font-medium text-gray-900">Templates</span>
              <span className="ml-auto text-gray-400">→</span>
            </button>

            <button
              onClick={onOpenPasteJson}
              className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              <ClipboardDownloadIcon className="w-6 h-6 text-gray-600" />
              <span className="font-medium text-gray-900">Paste JSON</span>
              <span className="ml-auto text-gray-400">→</span>
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

      <section ref={saveSectionRef} className="mb-6">
        <button
          type="button"
          onClick={() => onToggleSection('save')}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
          aria-expanded={menuSectionsOpen.save}
        >
          <span>Save Workflow</span>
          <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${menuSectionsOpen.save ? 'rotate-0' : '-rotate-90'}`} />
        </button>
        {menuSectionsOpen.save && (
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
                <span className="font-medium text-gray-900 truncate">Save {currentFilename.replace('.json', '')}</span>
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
              <span className="ml-auto text-gray-400">→</span>
            </button>
          </div>
        )}
      </section>

      <div className="border-t border-gray-200 mb-6" />

      <section ref={appearanceSectionRef} className="mb-6">
        <button
          type="button"
          onClick={() => onToggleSection('appearance')}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
          aria-expanded={menuSectionsOpen.appearance}
        >
          <span>Appearance</span>
          <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${menuSectionsOpen.appearance ? 'rotate-0' : '-rotate-90'}`} />
        </button>
        {menuSectionsOpen.appearance && (
          <div className="space-y-2">
            <button
              onClick={onToggleTheme}
              className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              {theme === 'dark' ? (
                <MoonIcon className="w-6 h-6 text-gray-600" />
              ) : (
                <SunIcon className="w-6 h-6 text-gray-600" />
              )}
              <span className="font-medium text-gray-900">
                {theme === 'dark' ? 'Dark mode' : 'Light mode'}
              </span>
            </button>
          </div>
        )}
      </section>

      <section ref={infoSectionRef} className="mt-auto pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={() => onToggleSection('info')}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
          aria-expanded={menuSectionsOpen.info}
        >
          <span>About</span>
          <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${menuSectionsOpen.info ? 'rotate-0' : '-rotate-90'}`} />
        </button>
        {menuSectionsOpen.info && (
          <div className="space-y-2 pb-4">
            <a
              href="https://github.com/cosmicbuffalo/comfyui-mobile-frontend"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              <GithubIcon className="w-6 h-6 text-gray-600" />
              <span className="font-medium text-gray-900">Open in GitHub</span>
              <ExternalLinkIcon className="w-4 h-4 ml-auto text-gray-400" />
            </a>

            <button
              onClick={onOpenLegend}
              className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              <InfoCircleOutlineIcon className="w-6 h-6 text-gray-600" />
              <span className="font-medium text-gray-900">Icon Legend</span>
              <span className="ml-auto text-gray-400">→</span>
            </button>

            <a
              href="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/USER_GUIDE.md"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              <BookIcon className="w-6 h-6 text-gray-600" />
              <span className="font-medium text-gray-900">User Manual</span>
              <ExternalLinkIcon className="w-4 h-4 ml-auto text-gray-400" />
            </a>
          </div>
        )}
      </section>
    </>
  );
}
