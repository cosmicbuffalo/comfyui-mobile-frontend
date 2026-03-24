import { useRef, useState, useEffect } from 'react';
import { SlidePanel } from './AppMenu/SlidePanel';
import { MenuLegend } from './AppMenu/MenuLegend';
import { MainMenuPanel } from './AppMenu/MainMenuPanel';
import { PasteJsonPanel } from './AppMenu/PasteJsonPanel';
import { SaveWorkflowPanel } from './AppMenu/SaveWorkflowPanel';
import { TemplatesPanel } from './AppMenu/TemplatesPanel';
import { UserWorkflowsPanel } from './AppMenu/UserWorkflowsPanel';
import { RecentWorkflowsPanel } from './AppMenu/RecentWorkflowsPanel';
import { GenerationSettingsPanel } from './AppMenu/GenerationSettingsPanel';
import { getDisplayName } from './AppMenu/userWorkflowHelpers';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import { getWorkflowForPersistence } from '@/utils/workflowPersistence';
import { useThemeStore } from '@/hooks/useTheme';
import type { Workflow } from '@/api/types';
import {
  listUserWorkflows,
  loadUserWorkflow,
  restartServer,
  fetchSystemStats,
  fetchCpuPercent,
  saveUserWorkflow,
  getWorkflowTemplates,
  loadTemplateWorkflow,
  type UserDataFile,
  type WorkflowTemplates,
  type SystemStats,
  getFileWorkflow,
  type AssetSource
} from '@/api/client';

interface AppMenuProps {
  open: boolean;
  onClose: () => void;
}

type TabType = 'menu' | 'userWorkflows' | 'recent' | 'templates' | 'save' | 'pasteJson' | 'aboutLegend' | 'generationSettings';

async function waitForServerToReturn(timeoutMs = 45000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch('/api/object_info', { cache: 'no-store' });
      if (response.ok) {
        return;
      }
    } catch {
      // Expected while the server is restarting.
    }

    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }

  throw new Error('ComfyUI did not come back online in time.');
}

export function AppMenu({
  open,
  onClose
}: AppMenuProps) {
  const loadWorkflow = useWorkflowStore((s) => s.loadWorkflow);
  const workflow = useWorkflowStore((s) => s.workflow);
  const currentFilename = useWorkflowStore((s) => s.currentFilename);
  const originalWorkflow = useWorkflowStore((s) => s.originalWorkflow);
  const setSavedWorkflow = useWorkflowStore((s) => s.setSavedWorkflow);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Check if dirty
  const isDirty = Boolean(
    workflow && originalWorkflow && JSON.stringify(workflow) !== JSON.stringify(originalWorkflow),
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('menu');
  const [userWorkflows, setUserWorkflows] = useState<UserDataFile[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplates>({});
  const [loading, setLoading] = useState(false);
  const [restartingServer, setRestartingServer] = useState(false);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [cpuPercent, setCpuPercent] = useState<number | null>(null);
  const [saveFilenameInput, setSaveFilenameInput] = useState(currentFilename || ''); // Use currentFilename as initial value
  const [pastedJson, setPastedJson] = useState('');
  const [menuSectionsOpen, setMenuSectionsOpen] = useState({
    load: true,
    save: true,
    appearance: true,
    server: false,
    info: true,
  });

  // Refs for scrolling to sections
  const loadSectionRef = useRef<HTMLElement>(null);
  const saveSectionRef = useRef<HTMLElement>(null);
  const appearanceSectionRef = useRef<HTMLElement>(null);
  const serverSectionRef = useRef<HTMLElement>(null);
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
    } else if (!prev.server && current.server) {
      setTimeout(() => serverSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
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
        server: false,
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

  // Fetch system stats when menu opens, refresh periodically while open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = () => {
      fetchSystemStats()
        .then((stats) => { if (!cancelled) setSystemStats(stats); })
        .catch(() => {});
      fetchCpuPercent()
        .then((pct) => { if (!cancelled) setCpuPercent(pct); })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [open]);

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

  const handleLoadFileWorkflow = async (filePath: string, assetSource: AssetSource) => {
    try {
      setLoading(true);
      const data = await getFileWorkflow(filePath, assetSource);
      loadWorkflow(data, filePath, { source: { type: 'file', filePath, assetSource } });
      setError(null);
      onClose();
      vibrate(10);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workflow from file');
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
      const workflowForPersistence = getWorkflowForPersistence(workflow);
      if (!workflowForPersistence) {
        throw new Error('Unable to save: embedded workflow is unavailable.');
      }
      await saveUserWorkflow(finalFilename, workflowForPersistence);
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

  const handleOpenSaveAs = () => {
    setSaveFilenameInput(currentFilename || '');
    setActiveTab('save');
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

    const workflowForPersistence = getWorkflowForPersistence(workflow);
    if (!workflowForPersistence) {
      setError('Unable to download: embedded workflow is unavailable.');
      return;
    }
    const json = JSON.stringify(workflowForPersistence, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentFilename ? getDisplayName(currentFilename) : `workflow-${Date.now()}`}.json`;
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

  const handleRestartServer = async () => {
    if (restartingServer) return;

    const confirmed = window.confirm(
      'Restart ComfyUI now? This will interrupt any running jobs and briefly disconnect the mobile UI.'
    );
    if (!confirmed) return;

    try {
      setRestartingServer(true);
      await restartServer();
      setError(null);
      vibrate([10, 40, 10]);
      await waitForServerToReturn();
      window.location.reload();
    } catch (err) {
      setRestartingServer(false);
      setError(err instanceof Error ? err.message : 'Failed to restart server');
    }
  };

  return (
    <SlidePanel open={open} onClose={onClose} side="left" title="ComfyUI Mobile">
      {activeTab === 'menu' && (
        <MainMenuPanel
          error={error}
          workflow={workflow}
          currentFilename={currentFilename}
          isDirty={isDirty}
          loading={loading}
          restartingServer={restartingServer}
          systemStats={systemStats}
          cpuPercent={cpuPercent}
          theme={theme}
          menuSectionsOpen={menuSectionsOpen}
          fileInputRef={fileInputRef}
          loadSectionRef={loadSectionRef}
          saveSectionRef={saveSectionRef}
          appearanceSectionRef={appearanceSectionRef}
          serverSectionRef={serverSectionRef}
          infoSectionRef={infoSectionRef}
          onDismissError={() => setError(null)}
          onFileChange={handleFileChange}
          onLoadFromFile={handleLoadFromFile}
          onToggleSection={(section) =>
            setMenuSectionsOpen((prev) => ({ ...prev, [section]: !prev[section] }))
          }
          onOpenRecent={() => setActiveTab('recent')}
          onOpenUserWorkflows={() => setActiveTab('userWorkflows')}
          onOpenTemplates={() => setActiveTab('templates')}
          onOpenPasteJson={() => setActiveTab('pasteJson')}
          onSave={handleSave}
          onOpenSaveAs={handleOpenSaveAs}
          onToggleTheme={toggleTheme}
          onOpenLegend={() => setActiveTab('aboutLegend')}
          onRestartServer={handleRestartServer}
          onOpenGenerationSettings={() => setActiveTab('generationSettings')}
        />
      )}
      {activeTab === 'userWorkflows' && (
        <UserWorkflowsPanel
          error={error}
          loading={loading}
          userWorkflows={userWorkflows}
          onBack={() => setActiveTab('menu')}
          onDismissError={() => setError(null)}
          onLoadWorkflow={handleLoadUserWorkflow}
        />
      )}
      {activeTab === 'recent' && (
        <RecentWorkflowsPanel
          onBack={() => setActiveTab('menu')}
          onLoadUserWorkflow={handleLoadUserWorkflow}
          onLoadTemplate={handleLoadTemplate}
          onLoadFileWorkflow={handleLoadFileWorkflow}
        />
      )}
      {activeTab === 'templates' && (
        <TemplatesPanel
          error={error}
          loading={loading}
          templates={templates}
          onBack={() => setActiveTab('menu')}
          onDismissError={() => setError(null)}
          onLoadTemplate={handleLoadTemplate}
        />
      )}
      {activeTab === 'save' && (
        <SaveWorkflowPanel
          error={error}
          loading={loading}
          workflow={workflow}
          saveFilenameInput={saveFilenameInput}
          onBack={() => setActiveTab('menu')}
          onDismissError={() => setError(null)}
          onSaveFilenameChange={setSaveFilenameInput}
          onSaveAs={handleSaveAs}
          onDownload={handleDownload}
        />
      )}
      {activeTab === 'pasteJson' && (
        <PasteJsonPanel
          error={error}
          pastedJson={pastedJson}
          pasteTextareaRef={pasteTextareaRef}
          onBack={() => setActiveTab('menu')}
          onDismissError={() => setError(null)}
          onChangeJson={setPastedJson}
          onLoad={handleLoadFromPaste}
        />
      )}
      {activeTab === 'aboutLegend' && (
        <MenuLegend onBack={() => setActiveTab('menu')} />
      )}
      {activeTab === 'generationSettings' && (
        <GenerationSettingsPanel onBack={() => setActiveTab('menu')} />
      )}

      {restartingServer && (
        <div className="fixed inset-0 z-[2400] bg-slate-950/88 backdrop-blur-md flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-[28px] border border-white/10 bg-slate-900/95 shadow-2xl px-6 py-7 text-white">
            <div className="flex items-center gap-4">
              <div className="relative h-12 w-12 shrink-0">
                <div className="absolute inset-0 rounded-full border-2 border-cyan-400/25" />
                <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-cyan-300 animate-spin" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-300/80">
                  Server Restart
                </p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  Restarting ComfyUI
                </h2>
              </div>
            </div>
            <p className="mt-5 text-sm leading-6 text-slate-300">
              Waiting for the backend to come back online. The app will refresh automatically as soon as it reconnects.
            </p>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-1/3 rounded-full bg-cyan-300/90 animate-pulse" />
            </div>
          </div>
        </div>
      )}
    </SlidePanel>
  );
}
