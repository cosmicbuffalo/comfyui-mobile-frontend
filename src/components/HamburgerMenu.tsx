import { useRef, useState, useEffect } from 'react';
import { SlidePanel } from './SlidePanel';
import { TextareaActions } from './TextareaActions';
import { HamburgerMenuLegend } from './hamburger/HamburgerMenuLegend';
import { HamburgerMenuSubPageHeader } from './hamburger/HamburgerMenuSubPageHeader';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { BookIcon, CaretDownIcon, ClipboardDownloadIcon, DownloadDeviceIcon, ExternalLinkIcon, FolderIcon, GithubIcon, InfoCircleOutlineIcon, MoonIcon, SaveAsIcon, SaveDiskIcon, SunIcon, TemplateIcon, WorkflowLoadIcon } from '@/components/icons';
import type { Workflow } from '@/api/types';
import {
  listUserWorkflows,
  loadUserWorkflow,
  saveUserWorkflow,
  getWorkflowTemplates,
  loadTemplateWorkflow,
  type UserDataFile,
  type WorkflowTemplates
} from '@/api/client';

interface HamburgerMenuProps {
  open: boolean;
  onClose: () => void;
}

type TabType = 'menu' | 'userWorkflows' | 'templates' | 'save' | 'pasteJson' | 'aboutLegend';

export function HamburgerMenu({
  open,
  onClose
}: HamburgerMenuProps) {
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const workflow = useWorkflowStore((s) => s.workflow);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  const setSavedWorkflow = useWorkflowStore((s) => s.setSavedWorkflow);
  const theme = useWorkflowStore((s) => s.theme);
  const toggleTheme = useWorkflowStore((s) => s.toggleTheme);
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Check if dirty
  const isDirty = workflow && originalWorkflow && JSON.stringify(workflow) !== JSON.stringify(originalWorkflow);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('menu');
  const [userWorkflows, setUserWorkflows] = useState<UserDataFile[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplates>({});
  const [loading, setLoading] = useState(false);
  const [saveFilenameInput, setSaveFilenameInput] = useState(currentFilename || ''); // Use currentFilename as initial value
  const [pastedJson, setPastedJson] = useState('');
  const [menuSectionsOpen, setMenuSectionsOpen] = useState({
    load: true,
    save: true,
    appearance: true,
    info: true,
  });

  // Refs for scrolling to sections
  const loadSectionRef = useRef<HTMLElement>(null);
  const saveSectionRef = useRef<HTMLElement>(null);
  const appearanceSectionRef = useRef<HTMLElement>(null);
  const infoSectionRef = useRef<HTMLElement>(null);
  const prevMenuSectionsOpen = useRef(menuSectionsOpen);

  // Scroll to section when opened
  useEffect(() => {
    const prev = prevMenuSectionsOpen.current;
    const current = menuSectionsOpen;

    if (!prev.load && current.load) {
      setTimeout(() => loadSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } else if (!prev.save && current.save) {
      setTimeout(() => saveSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } else if (!prev.appearance && current.appearance) {
      setTimeout(() => appearanceSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    } else if (!prev.info && current.info) {
      setTimeout(() => infoSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }

    prevMenuSectionsOpen.current = current;
  }, [menuSectionsOpen]);

  // Reset to menu when panel closes
  useEffect(() => {
    if (!open) {
      setActiveTab('menu');
      setError(null);
      setSaveFilenameInput(currentFilename || ''); // Reset save filename input
      setPastedJson('');
      setMenuSectionsOpen({
        load: true,
        save: true,
        appearance: true,
        info: true,
      });
    }
  }, [open, currentFilename]);

  // Fetch user workflows when tab opens
  useEffect(() => {
    if (activeTab === 'userWorkflows') {
      setLoading(true);
      listUserWorkflows()
        .then(setUserWorkflows)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [activeTab]);

  // Fetch templates when tab opens
  useEffect(() => {
    if (activeTab === 'templates') {
      setLoading(true);
      getWorkflowTemplates()
        .then(setTemplates)
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [activeTab]);

  // Helper for haptic feedback
  const vibrate = (pattern: number | number[]) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  };

  const handleLoadFromFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text) as Workflow;

      // Validate basic structure
      if (!data.nodes || !Array.isArray(data.nodes)) {
        throw new Error('Invalid workflow: missing nodes array');
      }

      loadWorkflow(data, file.name); // Pass filename when loading from device
      setError(null);
      onClose();

      vibrate(10);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow');
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleLoadUserWorkflow = async (filename: string) => {
    try {
      setLoading(true);
      const data = await loadUserWorkflow(filename);
      loadWorkflow(data, filename, { fresh: true, source: { type: 'user', filename } });
      setError(null);
      onClose();
      vibrate(10);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadTemplate = async (moduleName: string, templateName: string) => {
    try {
      setLoading(true);
      const data = await loadTemplateWorkflow(moduleName, templateName);
      loadWorkflow(data, `${moduleName}/${templateName}`, { fresh: true, source: { type: 'template', moduleName, templateName } });
      setError(null);
      onClose();
      vibrate(10);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load template');
    } finally {
      setLoading(false);
    }
  };

  const performSave = async (filename: string) => {
    if (!workflow) return;

    const finalFilename = filename.endsWith('.json')
      ? filename
      : `${filename}.json`;

    try {
      setLoading(true);
      await saveUserWorkflow(finalFilename, workflow);
      setSavedWorkflow(workflow, finalFilename); // Update saved state
      setError(null);
      onClose();
      vibrate(10);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workflow');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    if (currentFilename) {
      performSave(currentFilename);
    } else {
      setActiveTab('save'); // Go to "Save As" if no current filename
    }
  };

  const handleSaveAs = () => {
    if (saveFilenameInput.trim()) {
      performSave(saveFilenameInput);
    } else {
      setError('Please enter a filename.');
    }
  };

  const handleDownload = () => {
    if (!workflow) return;

    const json = JSON.stringify(workflow, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentFilename || `workflow-${Date.now()}`}.json`;
    a.click();

    URL.revokeObjectURL(url);

    vibrate(10);
    onClose();
  };

  const handleLoadFromPaste = () => {
    try {
      const data = JSON.parse(pastedJson) as Workflow;

      // Validate basic structure
      if (!data.nodes || !Array.isArray(data.nodes)) {
        throw new Error('Invalid workflow: missing nodes array');
      }

      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      loadWorkflow(data, `Pasted workflow (${timestamp})`);
      setError(null);
      onClose();
      vibrate(10);
      setPastedJson('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse JSON');
    }
  };

  // Render error message
  const renderError = () =>
    error && (
      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
        {error}
        <button
          onClick={() => setError(null)}
          className="ml-2 text-red-500 font-medium"
        >
          Dismiss
        </button>
      </div>
    );

  // Render user workflows list
  const renderUserWorkflows = () => (
    <div className="flex flex-col h-full">
      <HamburgerMenuSubPageHeader title="My Workflows" onBack={() => setActiveTab('menu')} />
      {renderError()}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : userWorkflows.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No saved workflows yet</p>
      ) : (
        <div className="space-y-2 overflow-y-auto flex-1">
          {userWorkflows.map((file) => (
            <button
              key={file.path}
              onClick={() => handleLoadUserWorkflow(file.name)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              <WorkflowLoadIcon className="w-5 h-5 text-gray-600" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">
                  {file.name.replace(/\.json$/, '')}
                </p>
                {file.modified && (
                  <p className="text-xs text-gray-500">
                    {new Date(file.modified * 1000).toLocaleDateString()}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Render templates list
  const renderTemplates = () => (
    <div className="flex flex-col h-full">
      <HamburgerMenuSubPageHeader title="Templates" onBack={() => setActiveTab('menu')} />
      {renderError()}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : Object.keys(templates).length === 0 ? (
        <p className="text-gray-500 text-center py-8">No templates available</p>
      ) : (
        <div className="space-y-4 overflow-y-auto flex-1">
          {Object.entries(templates).map(([moduleName, templateList]) => (
            <div key={moduleName}>
              <h4 className="text-sm font-semibold text-gray-600 mb-2">
                {moduleName}
              </h4>
              <div className="space-y-2">
                {templateList.map((templateName) => (
                  <button
                    key={templateName}
                    onClick={() => handleLoadTemplate(moduleName, templateName)}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200
                               rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
                  >
                    <TemplateIcon className="w-5 h-5 text-gray-600" />
                    <span className="font-medium text-gray-900 truncate">
                      {templateName.replace(/\.json$/, '')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Render save workflow panel
  const renderSavePanel = () => (
    <div className="flex flex-col h-full">
      <HamburgerMenuSubPageHeader title="Save Workflow" onBack={() => setActiveTab('menu')} />
      {renderError()}

      <div className="space-y-4">
        {/* Save to server section */}
        <div className="p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-sm text-gray-600 mb-3">Save to ComfyUI server:</p>
          <input
            type="text"
            value={saveFilenameInput}
            onChange={(e) => setSaveFilenameInput(e.target.value)}
            placeholder="Enter filename (e.g., my_workflow.json)"
            className="w-full p-3 border border-gray-300 rounded-lg mb-3"
          />
          <button
            onClick={handleSaveAs}
            disabled={!workflow || !saveFilenameInput.trim() || loading}
            className="w-full py-3 bg-blue-500 text-white rounded-lg font-medium
                       disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            {loading ? 'Saving...' : 'Save As'}
          </button>
        </div>

        {/* Download to device */}
        <button
          onClick={handleDownload}
          disabled={!workflow}
          className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-gray-200
                     rounded-xl text-left hover:bg-gray-50 min-h-[56px]
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <DownloadDeviceIcon className="w-6 h-6 text-gray-600" />
          <span className="font-medium text-gray-900">Download to Device</span>
        </button>
      </div>
    </div>
  );

  // Render paste JSON panel
  const renderPasteJsonPanel = () => (
    <div className="flex flex-col h-full">
      <HamburgerMenuSubPageHeader title="Paste JSON" onBack={() => setActiveTab('menu')} />
      {renderError()}

      <div className="flex-1 flex flex-col space-y-4 overflow-hidden">
        <p className="text-sm text-gray-600">
          Paste your workflow JSON below.
        </p>
        <div className="group" data-textarea-root="true">
          <div className="flex items-center justify-between mb-1" data-textarea-header="true">
            <div className="text-xs text-gray-500 uppercase tracking-wide">
              Workflow JSON
            </div>
            <TextareaActions
              value={pastedJson}
              onChange={setPastedJson}
              textareaRef={pasteTextareaRef}
              className="opacity-70 transition-opacity group-focus-within:opacity-100"
            />
          </div>
          <textarea
            ref={pasteTextareaRef}
            value={pastedJson}
            onChange={(e) => setPastedJson(e.target.value)}
            placeholder='{"last_node_id": ...}'
            className="w-full flex-1 p-3 border border-gray-300 rounded-lg font-mono text-xs resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <button
            onClick={() => setActiveTab('menu')}
            className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 min-h-[48px]"
          >
            Cancel
          </button>
          <button
            onClick={handleLoadFromPaste}
            disabled={!pastedJson.trim()}
            className="flex-1 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600
                       disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px]"
          >
            Load
          </button>
        </div>
      </div>
    </div>
  );

  // Render main menu
  const renderMainMenu = () => (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Error message */}
      {renderError()}

      {/* Load Workflow Section */}
      <section ref={loadSectionRef} className="mb-6">
        <button
          type="button"
          onClick={() => setMenuSectionsOpen((prev) => ({ ...prev, load: !prev.load }))}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
          aria-expanded={menuSectionsOpen.load}
        >
          <span>Load Workflow</span>
          <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${menuSectionsOpen.load ? 'rotate-0' : '-rotate-90'}`} />
        </button>
        {menuSectionsOpen.load && (
          <div className="space-y-2">
          <button
            onClick={() => setActiveTab('userWorkflows')}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <WorkflowLoadIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">My Workflows</span>
            <span className="ml-auto text-gray-400">→</span>
          </button>

          <button
            onClick={() => setActiveTab('templates')}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <TemplateIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">Templates</span>
            <span className="ml-auto text-gray-400">→</span>
          </button>

          <button
            onClick={() => setActiveTab('pasteJson')}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <ClipboardDownloadIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">Paste JSON</span>
            <span className="ml-auto text-gray-400">→</span>
          </button>

          <button
            onClick={handleLoadFromFile}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <FolderIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">From Device</span>
          </button>
        </div>
        )}
      </section>

      {/* Save Workflow Section */}
      <section ref={saveSectionRef} className="mb-6">
        <button
          type="button"
          onClick={() => setMenuSectionsOpen((prev) => ({ ...prev, save: !prev.save }))}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
          aria-expanded={menuSectionsOpen.save}
        >
          <span>Save Workflow</span>
          <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${menuSectionsOpen.save ? 'rotate-0' : '-rotate-90'}`} />
        </button>
        {menuSectionsOpen.save && (
          <div className="space-y-2">
            {currentFilename && ( // Show "Save" only if there's a current filename
              <button
                onClick={handleSave}
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
              onClick={() => {
                setSaveFilenameInput(currentFilename || ''); // Pre-fill with current name if exists
                setActiveTab('save');
              }}
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

      {/* Appearance */}
      <section ref={appearanceSectionRef} className="mb-6">
        <button
          type="button"
          onClick={() => setMenuSectionsOpen((prev) => ({ ...prev, appearance: !prev.appearance }))}
          className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
          aria-expanded={menuSectionsOpen.appearance}
        >
          <span>Appearance</span>
          <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${menuSectionsOpen.appearance ? 'rotate-0' : '-rotate-90'}`} />
        </button>
        {menuSectionsOpen.appearance && (
          <div className="space-y-2">
          <button
            onClick={() => toggleTheme()}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            {theme === 'dark' ? (
              <SunIcon className="w-6 h-6 text-gray-600" />
            ) : (
              <MoonIcon className="w-6 h-6 text-gray-600" />
            )}
            <span className="font-medium text-gray-900">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          </button>
        </div>
        )}
      </section>

      {/* About */}
      <section ref={infoSectionRef} className="mt-auto pt-6 border-t border-gray-200">
        <button
          type="button"
          onClick={() => setMenuSectionsOpen((prev) => ({ ...prev, info: !prev.info }))}
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
              onClick={() => setActiveTab('aboutLegend')}
              className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                         rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
            >
              <InfoCircleOutlineIcon className="w-6 h-6 text-gray-600" />
              <span className="font-medium text-gray-900">Icon Legend</span>
              <span className="ml-auto text-gray-400">→</span>
            </button>

            <a
              href="#"
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

  return (
    <SlidePanel open={open} onClose={onClose} side="left" title="ComfyUI Mobile">
      {activeTab === 'menu' && renderMainMenu()}
      {activeTab === 'userWorkflows' && renderUserWorkflows()}
      {activeTab === 'templates' && renderTemplates()}
      {activeTab === 'save' && renderSavePanel()}
      {activeTab === 'pasteJson' && renderPasteJsonPanel()}
      {activeTab === 'aboutLegend' && (
        <HamburgerMenuLegend onBack={() => setActiveTab('menu')} />
      )}
    </SlidePanel>
  );
}
