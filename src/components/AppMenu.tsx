import { useRef, useState, useEffect, useCallback } from 'react';
import { BackendStatusOverlay } from './BackendStatusOverlay';
import { useConnectionStatusStore } from '@/hooks/useConnectionStatus';
import { SlidePanel } from './AppMenu/SlidePanel';
import { MenuLegend } from './AppMenu/MenuLegend';
import { MainMenuPanel } from './AppMenu/MainMenuPanel';
import { PasteJsonPanel } from './AppMenu/PasteJsonPanel';
import { SaveWorkflowPanel } from './AppMenu/SaveWorkflowPanel';
import { TemplatesPanel } from './AppMenu/TemplatesPanel';
import { UserWorkflowsPanel } from './AppMenu/UserWorkflowsPanel';
import { RecentWorkflowsPanel } from './AppMenu/RecentWorkflowsPanel';
import { GenerationSettingsPanel } from './AppMenu/GenerationSettingsPanel';
import { CustomNodesManagerModal } from './CustomNodesManagerModal';
import { getDisplayName } from './AppMenu/userWorkflowHelpers';
import { isWorkflowModified, useWorkflowStore } from '@/hooks/useWorkflow';
import { getWorkflowForPersistence } from '@/utils/workflowPersistence';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';
import { obfuscateWorkflowInputPaths } from '@/utils/inputPathAliases';
import { readWorkflowFromFile } from '@/utils/workflowFromFile';
import { useNoWorkflowImageModal } from '@/hooks/useNoWorkflowImageModal';
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForServerToReturn(timeoutMs = 45000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveOk = 0;

  while (Date.now() < deadline) {
    try {
      // Liveness probe only — use the tiny /system_stats payload, not the
      // multi-MB /api/object_info. Polling object_info here downloaded megabytes
      // every second just to read its status code. The app reloads on reconnect
      // and re-fetches node types (cache-first) anyway.
      const response = await fetch('/system_stats', { cache: 'no-store' });
      if (response.ok) {
        consecutiveOk += 1;
        if (consecutiveOk >= 2) return;
      } else {
        consecutiveOk = 0;
      }
    } catch {
      consecutiveOk = 0;
      // Expected while the server is restarting.
    }

    await sleep(1000);
  }

  throw new Error('ComfyUI did not come back online in time.');
}

function ServerRestartOverlay() {
  return (
    <BackendStatusOverlay
      eyebrow="Server Restart"
      title="Restarting ComfyUI"
      message="Waiting for the backend to come back online. The app will refresh automatically as soon as it reconnects."
    />
  );
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
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = isWorkflowModified(workflow, originalWorkflow);

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
  const [customNodesOpen, setCustomNodesOpen] = useState(false);
  const [menuSectionsOpen, setMenuSectionsOpen] = useState({
    load: true,
    save: true,
    server: false,
    info: true,
  });

  // Refs for scrolling to sections
  const loadSectionRef = useRef<HTMLElement>(null);
  const saveSectionRef = useRef<HTMLElement>(null);
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
      setCustomNodesOpen(false);
      setMenuSectionsOpen({
        load: true,
        save: true,
        server: false,
        info: true,
      });
    }
  }, [open, currentFilename]);

  // Fetch user workflows. `silent` re-lists without flipping the loading
  // spinner — used to refresh after a folder/workflow mutation.
  const refreshUserWorkflows = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    listUserWorkflows()
      .then(setUserWorkflows)
      .catch((err) => setError(err.message))
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, []);

  // Fetch user workflows when tab opens
  useEffect(() => {
    if (activeTab === 'userWorkflows') {
      refreshUserWorkflows();
    }
  }, [activeTab, refreshUserWorkflows]);

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

  // Fetch system stats when the menu's main panel is showing, refreshing
  // periodically. Pause while the custom-nodes modal covers the menu — the stats
  // aren't visible there, so polling system_stats/cpu-stats every 5s is wasted.
  useEffect(() => {
    if (!open || customNodesOpen) return;
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
  }, [open, customNodesOpen]);

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
    // Reset the input up front so re-picking the same file still fires onChange.
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (!file) return;

    const result = await readWorkflowFromFile(file);
    if (result.kind === 'workflow') {
      loadWorkflow(result.workflow, result.filename); // filename when loading from device
      setError(null);
      onClose();
      vibrate(10);
    } else if (result.kind === 'no-workflow') {
      useNoWorkflowImageModal.getState().show(result.filename);
    } else {
      setError(result.message);
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

  const handleLoadFileWorkflow = async (
    filePath: string,
    assetSource: AssetSource,
    hidden?: boolean,
  ) => {
    try {
      setLoading(true);
      const data = await getFileWorkflow(filePath, assetSource);
      loadWorkflow(data, filePath, {
        source: {
          type: 'file',
          filePath,
          assetSource,
          ...(hidden ? { hidden: true } : {}),
        },
      });
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

    const store = useWorkflowStore.getState();
    const savingId = store.activeSessionId;
    try {
      setLoading(true);
      store.setSavingSessionId(savingId);
      let workflowForPersistence = getWorkflowForPersistence(workflow);
      if (!workflowForPersistence) {
        throw new Error('Unable to save: embedded workflow is unavailable.');
      }
      if (useGenerationSettingsStore.getState().obfuscateSharedInputPaths) {
        const nodeTypes = useWorkflowStore.getState().nodeTypes;
        if (!nodeTypes) throw new Error('Unable to hide input paths: node definitions are unavailable.');
        workflowForPersistence = await obfuscateWorkflowInputPaths(workflowForPersistence, nodeTypes);
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
      // Only clear if this save still owns the spinner — a newer save started
      // while this one was in flight must keep showing its own.
      if (useWorkflowStore.getState().savingSessionId === savingId) {
        useWorkflowStore.getState().setSavingSessionId(null);
      }
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

  const handleDownload = async () => {
    if (!workflow) return;

    let workflowForPersistence = getWorkflowForPersistence(workflow);
    if (!workflowForPersistence) {
      setError('Unable to download: embedded workflow is unavailable.');
      return;
    }
    if (useGenerationSettingsStore.getState().obfuscateSharedInputPaths) {
      const nodeTypes = useWorkflowStore.getState().nodeTypes;
      if (!nodeTypes) {
        setError('Unable to hide input paths: node definitions are unavailable.');
        return;
      }
      try {
        workflowForPersistence = await obfuscateWorkflowInputPaths(workflowForPersistence, nodeTypes);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to hide input paths.');
        return;
      }
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
      // Suppress the generic connection-lost overlay: the restart deliberately
      // drops the socket, and we show our own restart overlay for it instead.
      useConnectionStatusStore.getState().setServerRestarting(true);
      await restartServer();
      setError(null);
      vibrate([10, 40, 10]);
      await sleep(1500);
      await waitForServerToReturn();
      window.location.reload();
    } catch (err) {
      setRestartingServer(false);
      useConnectionStatusStore.getState().setServerRestarting(false);
      setError(err instanceof Error ? err.message : 'Failed to restart server');
    }
  };

  return (
    <>
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
          menuSectionsOpen={menuSectionsOpen}
          fileInputRef={fileInputRef}
          loadSectionRef={loadSectionRef}
          saveSectionRef={saveSectionRef}
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
          onOpenLegend={() => setActiveTab('aboutLegend')}
          onRestartServer={handleRestartServer}
          onOpenGenerationSettings={() => setActiveTab('generationSettings')}
          onOpenCustomNodes={() => setCustomNodesOpen(true)}
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
          onRefresh={() => refreshUserWorkflows(true)}
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
      <CustomNodesManagerModal
        isOpen={customNodesOpen}
        onClose={() => setCustomNodesOpen(false)}
        onRestartServer={handleRestartServer}
      />
    </SlidePanel>
    {restartingServer && <ServerRestartOverlay />}
    </>
  );
}
