import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchCustomNodeAlternatives,
  fetchCustomNodeList,
  fetchCustomNodeMappings,
  fetchCustomNodeVersions,
  fetchManagerQueueStatus,
  installCustomNodeViaGitUrl,
  queueCustomNodeAction,
  resetManagerQueue,
  startManagerQueue,
  type CustomNodeActionMode,
  type CustomNodePackageMetadata,
  type CustomNodesDataMode,
  type CustomNodeMappingsResponse,
  type ManagerQueueStatus,
  type ManagerQueueStatusEvent,
} from '@/api/customNodesManagerClient';
import { useWorkflowStore } from '@/hooks/useWorkflow';
import {
  buildAlternativesHashMap,
  buildCustomNodeRows,
  buildFavoritesHashMap,
  buildWorkflowHashMaps,
  CUSTOM_NODE_FILTERS,
  filterCustomNodeRows,
  getCustomNodeActionOptions,
  isUnknownVersion,
  type CustomNodeFilterValue,
  type CustomNodeRow,
} from '@/utils/customNodesManager';
import {
  getCustomNodesManagerCache,
  setCustomNodesManagerCache,
  getCustomNodesManagerPrefetch,
  MANAGER_CACHE_STALE_MS,
} from '@/utils/customNodesManagerCache';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useModalKeyboard } from '@/hooks/useModalKeyboard';
import { t as globalT, useI18n } from '@/i18n';
import { FullscreenModalHeader } from './modals/FullscreenModalHeader';
import { Dialog } from './modals/Dialog';
import {
  CheckIcon,
  ChevronDownIcon,
  DownloadIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  FunnelIcon,
  MoveUpDownIcon,
  ReloadIcon,
  SearchIcon,
  StarIcon,
  TrashIcon,
  XMarkIcon,
} from './icons';
import { ContextMenuButton } from './buttons/ContextMenuButton';
import { getCustomNodeNote } from '@/data/customNodeNotes';

interface CustomNodesManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestartServer: () => void;
  // Filter to apply once the list has loaded (e.g. 'Missing' when opened from the
  // missing-nodes dialog). '' / undefined opens the default "All" view.
  initialFilter?: CustomNodeFilterValue;
  // Search keyword to pre-fill (e.g. a specific missing node type from its
  // on-canvas popover), applied alongside initialFilter.
  initialSearch?: string;
}

const DATA_MODE: CustomNodesDataMode = 'cache';
const CUSTOM_NODE_PAGE_SIZE = 40;

const SPECIAL_FILTERS = new Set<CustomNodeFilterValue>([
  'Update',
  'In Workflow',
  'Missing',
  'Favorites',
  'Alternatives',
]);

function plainTextFromHtml(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatLastUpdate(value: string | number | undefined): string | null {
  if (!value || value === -1) return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
}

function getStatusLabel(row: CustomNodeRow): string {
  if (row.action === 'updatable') return globalT('Update Available');
  if (row.action === 'import-fail') return globalT('Import failed');
  if (row.action === 'invalid-installation') return globalT('Invalid');
  if (row.state === 'enabled') return globalT('Enabled');
  if (row.state === 'disabled') return globalT('Disabled');
  if (row.state === 'not-installed') return globalT('Not Installed');
  return row.state || globalT('Unknown');
}

function statusClassName(row: CustomNodeRow): string {
  if (row.action === 'updatable') return 'bg-amber-500/15 text-amber-200 border border-amber-400/25';
  if (row.action === 'import-fail' || row.action === 'invalid-installation') return 'bg-red-500/15 text-red-200 border border-red-400/25';
  if (row.state === 'enabled') return 'bg-emerald-500/15 text-emerald-200 border border-emerald-400/25';
  if (row.state === 'disabled') return 'bg-slate-800 text-slate-300 border border-white/10';
  return 'bg-cyan-500/15 text-cyan-200 border border-cyan-400/25';
}

function rowTitle(row: CustomNodeRow): string {
  return String(row.title || row.name || row.id || row.key);
}

function rowRepository(row: CustomNodeRow): string | undefined {
  const repository = row.repository || row.reference || row.files?.[0];
  if (typeof repository !== 'string') return undefined;
  // Only surface http(s) links — guard against unsafe schemes (e.g.
  // javascript:/data:) in server-provided metadata being used as an href.
  return /^https?:\/\//i.test(repository.trim()) ? repository : undefined;
}

function prepareQueuePayload(
  row: CustomNodeRow,
  mode: CustomNodeActionMode,
  selectedVersion: string | undefined,
  channel: string | null
): CustomNodePackageMetadata {
  const data: CustomNodePackageMetadata = {
    ...row.originalData,
    id: row.originalData.id ?? row.key,
    channel: channel || 'default',
    mode: row.mode || DATA_MODE,
    ui_id: row.hash,
  };
  if (selectedVersion) data.selected_version = selectedVersion;
  if (mode === 'switch') data.selected_version = selectedVersion || 'latest';
  return data;
}

export function CustomNodesManagerModal({
  isOpen,
  onClose,
  onRestartServer,
  initialFilter = '',
  initialSearch = '',
}: CustomNodesManagerModalProps) {
  const { t } = useI18n();
  const workflow = useWorkflowStore((s) => s.workflow);
  const nodeTypes = useWorkflowStore((s) => s.nodeTypes);

  const [nodePacks, setNodePacks] = useState<Record<string, CustomNodePackageMetadata>>({});
  const [mappings, setMappings] = useState<CustomNodeMappingsResponse | undefined>();
  const [rows, setRows] = useState<CustomNodeRow[]>([]);
  const [filter, setFilter] = useState<CustomNodeFilterValue>('');
  const [keywords, setKeywords] = useState('');
  // The "All" view has thousands of packs; render a window and grow it on scroll
  // instead of mounting every row at once (which made the modal take seconds to open).
  const [visibleCount, setVisibleCount] = useState(CUSTOM_NODE_PAGE_SIZE);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const [channel, setChannel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [queueStatus, setQueueStatus] = useState<ManagerQueueStatus | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [openMenuHash, setOpenMenuHash] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<CustomNodeRow | null>(null);
  const loadedSpecialFiltersRef = useRef(new Set<CustomNodeFilterValue>());
  // Accumulate each special filter's derived hashmaps so switching between them
  // (e.g. In Workflow → Alternatives → In Workflow) keeps every loaded filter's
  // tags instead of dropping them and leaving the re-selected view empty.
  const accumulatedSpecialMapsRef = useRef<Parameters<typeof buildCustomNodeRows>[1]>({});
  const wasQueueProcessingRef = useRef(false);
  // Set when THIS client queues a manager task. The manager queue is global to
  // the ComfyUI server, so without this a task another client/desktop runs would
  // trigger a spurious "restart" prompt + forced reload here. Consumed (reset to
  // false) when we surface the completion.
  const weStartedQueueRef = useRef(false);

  const rebuildRows = useCallback((
    packs: Record<string, CustomNodePackageMetadata>,
    options: Parameters<typeof buildCustomNodeRows>[1] = {}
  ) => {
    const nextRows = buildCustomNodeRows(packs, {
      mappings,
      ...options,
    });
    setRows(nextRows);
    return nextRows;
  }, [mappings]);

  const loadBaseData = useCallback(async (options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    // If a background prefetch (e.g. triggered by the missing-nodes dialog) is
    // warming the cache, wait for it rather than starting a duplicate fetch.
    const inFlightPrefetch = getCustomNodesManagerPrefetch();
    if (!force && !getCustomNodesManagerCache() && inFlightPrefetch) {
      setLoading(true);
      await inFlightPrefetch;
    }
    const cache = getCustomNodesManagerCache();
    const hadCache = !force && cache !== null;

    if (!force && cache) {
      // Paint instantly from the cached list + prebuilt rows.
      setNodePacks(cache.nodePacks);
      setMappings(cache.mappings);
      setChannel(cache.channel);
      setRows(cache.rows);
      loadedSpecialFiltersRef.current = new Set();
      accumulatedSpecialMapsRef.current = {};
      setLoading(false);
      // Only hit the (multi-MB) endpoint again if the cache has gone stale.
      if (Date.now() - cache.fetchedAt < MANAGER_CACHE_STALE_MS) return;
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [listResponse, mappingResponse] = await Promise.all([
        fetchCustomNodeList(DATA_MODE, { skipUpdate: true }),
        fetchCustomNodeMappings(DATA_MODE),
      ]);
      const nextRows = buildCustomNodeRows(listResponse.node_packs, { mappings: mappingResponse });
      setNodePacks(listResponse.node_packs);
      setMappings(mappingResponse);
      setChannel(listResponse.channel);
      setRows(nextRows);
      setCustomNodesManagerCache({
        nodePacks: listResponse.node_packs,
        mappings: mappingResponse,
        channel: listResponse.channel,
        rows: nextRows,
        fetchedAt: Date.now(),
      });
      loadedSpecialFiltersRef.current = new Set();
      accumulatedSpecialMapsRef.current = {};
    } catch (err) {
      // If we already painted from cache, a background refresh failure is silent.
      if (!hadCache) {
        setError(err instanceof Error ? err.message : t('Failed to load custom nodes'));
      }
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadSpecialFilter = useCallback(async (targetFilter: CustomNodeFilterValue) => {
    if (!targetFilter || loadedSpecialFiltersRef.current.has(targetFilter)) return;
    setLoading(true);
    setError(null);
    try {
      if (targetFilter === 'Update') {
        const response = await fetchCustomNodeList(DATA_MODE, { skipUpdate: false });
        setNodePacks(response.node_packs);
        setChannel(response.channel);
        const updatedRows = rebuildRows(response.node_packs, accumulatedSpecialMapsRef.current);
        // Persist the update-checked list into the module cache and bump
        // `fetchedAt`, so (a) reopening doesn't pay the slow remote update check
        // again within the staleness window, and (b) the base background refresh
        // (skipUpdate:true) sees a fresh cache and won't clobber the update flags.
        const existingCache = getCustomNodesManagerCache();
        if (existingCache) {
          setCustomNodesManagerCache({
            ...existingCache,
            nodePacks: response.node_packs,
            channel: response.channel,
            rows: updatedRows,
            fetchedAt: Date.now(),
          });
        }
      } else if (targetFilter === 'In Workflow' || targetFilter === 'Missing') {
        const activeMappings = mappings ?? await fetchCustomNodeMappings(DATA_MODE);
        setMappings(activeMappings);
        const baseRows = buildCustomNodeRows(nodePacks, { mappings: activeMappings });
        const maps = buildWorkflowHashMaps(workflow, baseRows, activeMappings, nodeTypes ?? undefined);
        // Pass activeMappings through: `mappings` may have been undefined when
        // this callback closed over it, so rebuildRows would otherwise rebuild
        // without mapping-derived metadata (missing nodes/conflicts).
        accumulatedSpecialMapsRef.current = { ...accumulatedSpecialMapsRef.current, ...maps, mappings: activeMappings };
        rebuildRows(nodePacks, accumulatedSpecialMapsRef.current);
      } else if (targetFilter === 'Favorites') {
        const baseRows = buildCustomNodeRows(nodePacks, { mappings });
        accumulatedSpecialMapsRef.current = { ...accumulatedSpecialMapsRef.current, favoritesHashMap: buildFavoritesHashMap(baseRows) };
        rebuildRows(nodePacks, accumulatedSpecialMapsRef.current);
      } else if (targetFilter === 'Alternatives') {
        const baseRows = buildCustomNodeRows(nodePacks, { mappings });
        const alternatives = await fetchCustomNodeAlternatives(DATA_MODE);
        accumulatedSpecialMapsRef.current = { ...accumulatedSpecialMapsRef.current, alternativesHashMap: buildAlternativesHashMap(baseRows, alternatives) };
        rebuildRows(nodePacks, accumulatedSpecialMapsRef.current);
      }
      loadedSpecialFiltersRef.current.add(targetFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to load ${targetFilter}`);
    } finally {
      setLoading(false);
    }
  }, [mappings, nodePacks, nodeTypes, rebuildRows, workflow]);

  // Reset transient view state each time the modal opens so a stale error/success
  // banner or a leftover search/filter from a previous session doesn't reappear.
  // `needsRestart` is intentionally preserved — a pending restart reflects real
  // server state until ComfyUI is actually restarted.
  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setMessage(null);
    setKeywords('');
    setFilter('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    void loadBaseData();
  }, [isOpen, loadBaseData, t]);

  useEffect(() => {
    if (!isOpen) return;
    if (SPECIAL_FILTERS.has(filter)) void loadSpecialFilter(filter);
  }, [filter, isOpen, loadSpecialFilter]);

  // Apply a requested initial filter (e.g. 'Missing') once the base list has
  // loaded — special filters derive from nodePacks, so applying before they
  // arrive would mark the filter "loaded" against an empty list. Applied once
  // per open; the reset effect above clears it back to '' on close.
  const initialFilterAppliedRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      initialFilterAppliedRef.current = false;
      return;
    }
    if ((!initialFilter && !initialSearch) || initialFilterAppliedRef.current) return;
    if (Object.keys(nodePacks).length === 0) return;
    initialFilterAppliedRef.current = true;
    if (initialFilter) setFilter(initialFilter);
    if (initialSearch) setKeywords(initialSearch);
  }, [isOpen, initialFilter, initialSearch, nodePacks]);

  useBodyScrollLock(isOpen);
  useModalKeyboard(isOpen, onClose, modalRef);

  useEffect(() => {
    if (!isOpen) return;
    const loadQueueStatus = async () => {
      try {
        const status = await fetchManagerQueueStatus();
        setQueueStatus(status);
        if (wasQueueProcessingRef.current && !status.is_processing && weStartedQueueRef.current) {
          weStartedQueueRef.current = false;
          setNeedsRestart(true);
          setMessage(t('Custom node task completed. Restart ComfyUI to apply changes.'));
          void loadBaseData({ force: true });
        }
        wasQueueProcessingRef.current = status.is_processing;
      } catch {
        // The manager may not be installed; the main load error handles that.
      }
    };
    void loadQueueStatus();
    const interval = window.setInterval(loadQueueStatus, 2500);
    return () => window.clearInterval(interval);
  }, [isOpen, loadBaseData, t]);

  useEffect(() => {
    if (!isOpen) return;
    const onQueueStatus = (event: Event) => {
      const detail = (event as CustomEvent<ManagerQueueStatusEvent>).detail;
      if (!detail || detail.ui_target !== 'nodepack_manager') return;
      if (detail.status === 'in_progress') {
        setQueueStatus({
          total_count: detail.total_count ?? 0,
          done_count: detail.done_count ?? 0,
          in_progress_count: detail.in_progress_count ?? 1,
          is_processing: true,
        });
      } else if (detail.status === 'done') {
        setQueueStatus({
          total_count: detail.total_count ?? 0,
          done_count: detail.done_count ?? detail.total_count ?? 0,
          in_progress_count: 0,
          is_processing: false,
        });
        if (weStartedQueueRef.current) {
          weStartedQueueRef.current = false;
          setNeedsRestart(true);
          setMessage(t('Custom node task completed. Restart ComfyUI to apply changes.'));
          void loadBaseData({ force: true });
        }
      }
    };
    window.addEventListener('comfy-mobile-manager-queue-status', onQueueStatus);
    return () => window.removeEventListener('comfy-mobile-manager-queue-status', onQueueStatus);
  }, [isOpen, loadBaseData, t]);

  const visibleRows = useMemo(
    () => filterCustomNodeRows(rows, filter, keywords),
    [filter, keywords, rows]
  );
  const windowedRows = useMemo(
    () => visibleRows.slice(0, visibleCount),
    [visibleRows, visibleCount]
  );
  // Reset the window to the top whenever the filtered set changes (new filter,
  // search, or reloaded data). visibleRows keeps a stable identity while only the
  // window grows, so scrolling to load more doesn't trigger this.
  useEffect(() => {
    setVisibleCount(CUSTOM_NODE_PAGE_SIZE);
    if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
  }, [visibleRows]);
  const selectedFilterLabel = CUSTOM_NODE_FILTERS.find((item) => item.value === filter)?.label ?? t('All');
  const filterWidth = Math.min(Math.max(selectedFilterLabel.length * 7.5 + 76, 112), 230);

  const handleFilterChange = (value: CustomNodeFilterValue) => {
    setFilter(value);
    setOpenMenuHash(null);
  };

  const handleInstallViaGitUrl = async () => {
    const url = window.prompt(t('Git repository URL to install'));
    if (!url?.trim()) return;
    setActionLoading('git-url');
    setError(null);
    try {
      weStartedQueueRef.current = true;
      await installCustomNodeViaGitUrl(url.trim());
      setNeedsRestart(true);
      setMessage(t('Custom node installed. Restart ComfyUI to apply changes.'));
      await loadBaseData({ force: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to install via Git URL'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleAction = async (row: CustomNodeRow, mode: CustomNodeActionMode) => {
    setOpenMenuHash(null);
    if (mode === 'uninstall') {
      // In-app dialog, never window.confirm: iOS has shipped standalone-PWA
      // builds where native JS dialogs silently return false without showing.
      setUninstallTarget(row);
      return;
    }
    await runAction(row, mode);
  };

  const runAction = async (row: CustomNodeRow, mode: CustomNodeActionMode) => {
    const title = rowTitle(row);
    setActionLoading(`${row.hash}:${mode}`);
    setError(null);
    try {
      const status = await fetchManagerQueueStatus();
      if (status.is_processing) {
        throw new Error(`Manager queue is already processing (${status.done_count}/${status.total_count}).`);
      }

      let selectedVersion: string | undefined;
      if (mode === 'switch') {
        const nodeId = String(row.id || row.key);
        const versions = await fetchCustomNodeVersions(nodeId);
        const choices = ['latest', 'nightly', ...versions.filter((version) => version !== row.active_version)];
        const selected = window.prompt(`Version for ${title}:\n${choices.join('\n')}`, choices[0]);
        if (!selected) return;
        selectedVersion = selected.trim();
      }

      await resetManagerQueue();
      await queueCustomNodeAction(mode, prepareQueuePayload(row, mode, selectedVersion, channel));
      weStartedQueueRef.current = true;
      await startManagerQueue();
      setQueueStatus({ total_count: 1, done_count: 0, in_progress_count: 1, is_processing: true });
      // Don't optimistically mark "was processing" — let the poll/event status
      // set that only when the backend actually starts work. Otherwise a queue
      // call that no-ops server-side would later look like a completed task and
      // wrongly prompt for a restart. Real tasks are caught by the poll seeing
      // is_processing:true, or by the authoritative 'done' queue-status event.
      setMessage(t('{action} queued for {title}.', {
        action: mode === 'switch' ? t('Switch version') : t(mode),
        title,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Failed to {action} {title}', {
        action: mode === 'switch' ? t('Switch version') : t(mode),
        title,
      }));
    } finally {
      setActionLoading(null);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div ref={modalRef} className="fixed inset-0 z-[2600] bg-slate-950 flex flex-col safe-area-top text-slate-100">
      <FullscreenModalHeader
        title={t('Custom nodes')}
        onClose={onClose}
        headerActions={
          needsRestart ? (
            <button
              type="button"
              onClick={onRestartServer}
              className="h-10 px-3 rounded-lg border border-emerald-400/25 bg-emerald-500/10 text-emerald-200 text-sm font-semibold inline-flex items-center gap-2"
            >
              <ReloadIcon className="w-4 h-4" />
              {t('Restart')}
            </button>
          ) : null
        }
      />

      <div className="shrink-0 border-b border-white/10 bg-slate-900/95 px-4 py-3 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input
              type="search"
              value={keywords}
              onChange={(event) => setKeywords(event.target.value)}
              placeholder={t('Search custom nodes')}
              aria-label={t('Search custom nodes')}
              className="w-full h-11 rounded-lg border border-white/10 bg-slate-950/80 pl-10 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
            />
          </div>
          <label className="relative h-11 shrink-0" style={{ width: `${filterWidth}px` }}>
            <FunnelIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <select
              value={filter}
              aria-label={t('Filter custom nodes')}
              onChange={(event) => handleFilterChange(event.target.value as CustomNodeFilterValue)}
              className="w-full h-11 appearance-none rounded-lg border border-white/10 bg-slate-950/80 pl-9 pr-9 text-sm text-slate-100 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/25"
            >
              {CUSTOM_NODE_FILTERS.map((item) => (
                <option key={item.value || 'all'} value={item.value}>{t(item.label)}</option>
              ))}
            </select>
            <ChevronDownIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
          <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {t('{count} custom nodes', { count: visibleRows.length.toLocaleString() })}
              {channel && channel !== 'default' ? t(' · Channel: {channel}', { channel }) : ''}
            </span>
            {queueStatus?.is_processing ? (
              <span>{queueStatus.done_count}/{queueStatus.total_count} tasks</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleInstallViaGitUrl}
            disabled={actionLoading === 'git-url'}
            className="shrink-0 text-xs font-semibold text-cyan-300 disabled:opacity-50"
          >
            Install via Git URL
          </button>
        </div>
      </div>

      {(error || message) && (
        <div className="shrink-0 px-4 pt-3">
          {error ? (
            <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {message}
            </div>
          )}
        </div>
      )}

      <div
        ref={listScrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 space-y-2 overscroll-contain"
        onScroll={(event) => {
          const el = event.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < 600) {
            setVisibleCount((current) =>
              current >= visibleRows.length ? current : current + CUSTOM_NODE_PAGE_SIZE
            );
          }
        }}
      >
        {loading && visibleRows.length === 0 ? (
          <div className="flex items-center justify-center gap-3 rounded-lg border border-white/10 bg-slate-900/95 p-6 text-center text-sm text-slate-400">
            <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-300" />
            <span>{keywords.trim() ? t('Finding “{query}”…', { query: keywords.trim() }) : t('Loading custom nodes…')}</span>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-slate-900/95 p-6 text-center text-sm text-slate-400">
            {t('No custom nodes match this view.')}
          </div>
        ) : (
          windowedRows.map((row) => (
            <CustomNodeCard
              key={row.hash}
              row={row}
              menuOpen={openMenuHash === row.hash}
              actionLoading={actionLoading?.startsWith(`${row.hash}:`) ?? false}
              onToggleMenu={() => setOpenMenuHash((current) => current === row.hash ? null : row.hash)}
              onCloseMenu={() => setOpenMenuHash(null)}
              onAction={(mode) => void handleAction(row, mode)}
            />
          ))
        )}
      </div>
      {uninstallTarget && (
        <Dialog
          onClose={() => setUninstallTarget(null)}
          // Above this fullscreen modal (z-2600).
          zIndex={2700}
          fullscreen
          title={t('Uninstall {title}?', { title: rowTitle(uninstallTarget) })}
          actions={[
            { label: t('Cancel'), onClick: () => setUninstallTarget(null) },
            {
              label: t('Uninstall'),
              variant: 'danger',
              autoFocus: true,
              onClick: () => {
                const row = uninstallTarget;
                setUninstallTarget(null);
                void runAction(row, 'uninstall');
              },
            },
          ]}
        />
      )}
    </div>,
    document.body
  );
}

function CustomNodeCard({
  row,
  menuOpen,
  actionLoading,
  onToggleMenu,
  onCloseMenu,
  onAction,
}: {
  row: CustomNodeRow;
  menuOpen: boolean;
  actionLoading: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onAction: (mode: CustomNodeActionMode) => void;
}) {
  const { t } = useI18n();
  const menuRef = useRef<HTMLDivElement>(null);
  const actions = getCustomNodeActionOptions(row);
  const repository = rowRepository(row);
  // Maintained mobile-frontend support notes, keyed off the node's identity.
  const note = getCustomNodeNote([rowTitle(row), row.id, row.key, repository]);
  const lastUpdate = formatLastUpdate(row.last_update);
  const description = plainTextFromHtml(row.description);
  const subtitleItems = [
    row.version && !isUnknownVersion(row.version) ? `v${row.version}` : null,
    row.cnr_latest && row.cnr_latest !== row.version ? t('latest {version}', { version: row.cnr_latest }) : null,
    typeof row.nodes === 'number' ? t('{count} nodes', { count: row.nodes }) : null,
  ].filter((item): item is string => Boolean(item));
  const bottomItems: Array<string | ReactElement> = [
    row.author ? String(row.author) : String(row.id || row.key),
    typeof row.stars === 'number' && row.stars >= 0 ? (
      <span className="inline-flex items-center gap-1">
        <StarIcon className="w-3.5 h-3.5 text-amber-500" />
        {row.stars.toLocaleString()}
      </span>
    ) : null,
    lastUpdate,
  ].filter((item): item is string | ReactElement => item != null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && menuRef.current.contains(target)) return;
      onCloseMenu();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, onCloseMenu]);

  return (
    <article className="relative rounded-lg border border-white/10 bg-slate-900/95 p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-100">
              {rowTitle(row)}
            </h3>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClassName(row)}`}>
              {getStatusLabel(row)}
            </span>
          </div>
          <MetadataItems className="mt-1 text-xs text-slate-400" items={subtitleItems} />
        </div>

        <div ref={menuRef} className="relative -mr-2 -mt-2 shrink-0 text-slate-300">
          <ContextMenuButton
            ariaLabel={t('Actions for {title}', { title: rowTitle(row) })}
            onClick={(event) => {
              event.stopPropagation();
              onToggleMenu();
            }}
          />
          {menuOpen && (
            <div className="absolute right-0 top-11 z-20 w-44 rounded-lg border border-white/10 bg-slate-950 py-1 shadow-lg">
              {actions.length > 0 ? actions.map((action) => (
                <button
                  key={action.mode}
                  type="button"
                  onClick={() => onAction(action.mode)}
                  disabled={actionLoading}
                  className={`w-full px-3 py-2 text-left text-sm disabled:opacity-50 flex items-center gap-2 ${
                    action.destructive
                      ? 'text-red-300 hover:bg-red-500/10'
                      : 'text-slate-100 hover:bg-white/10'
                  }`}
                >
                  <CustomNodeActionIcon mode={action.mode} className="w-4 h-4 shrink-0" />
                  {t(action.label)}
                </button>
              )) : (
                <div className="px-3 py-2 text-sm text-slate-400">{t('No actions')}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {description && (
        <p className="mt-2 text-sm leading-5 text-slate-300 break-words">
          {description}
        </p>
      )}

      {row.alternatives && (
        <p className="mt-2 text-xs leading-5 text-cyan-300 break-words">
          {plainTextFromHtml(row.alternatives)}
        </p>
      )}

      {note && <CustomNodeNotes note={note} />}

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
        <MetadataItems className="min-w-0 text-xs text-slate-400" items={bottomItems} />
        <div className="flex items-center gap-2 shrink-0">
          {repository ? (
            <a
              href={repository}
              target="_blank"
              rel="noreferrer"
              aria-label={t('Open repository for {title}', { title: rowTitle(row) })}
              className="inline-flex items-center justify-center text-slate-400 hover:text-slate-100"
            >
              <ExternalLinkIcon className="w-5 h-5" />
            </a>
          ) : null}
        </div>
      </div>

      {actionLoading ? (
        <div className="absolute inset-0 rounded-lg bg-slate-950/70 flex items-center justify-center">
          <ReloadIcon className="w-5 h-5 animate-spin text-slate-200" />
        </div>
      ) : null}
    </article>
  );
}

function CustomNodeNotes({ note }: { note: ReturnType<typeof getCustomNodeNote> }) {
  if (!note) return null;
  const supported = note.supported ?? [];
  const unsupported = note.unsupported ?? [];
  if (supported.length === 0 && unsupported.length === 0 && !note.summary) return null;
  return (
    <div className="custom-node-notes mt-2 rounded-md border border-white/10 bg-slate-950/40 p-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        Mobile frontend support
      </p>
      {note.summary && (
        <p className="mt-1 text-xs leading-5 text-slate-300 break-words">{note.summary}</p>
      )}
      {supported.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {supported.map((item, index) => (
            <li key={`s-${index}`} className="flex items-start gap-1.5 text-xs leading-5 text-slate-200">
              <CheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      )}
      {unsupported.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {unsupported.map((item, index) => (
            <li key={`u-${index}`} className="flex items-start gap-1.5 text-xs leading-5 text-slate-400">
              <XMarkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
              <span className="min-w-0 break-words">{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CustomNodeActionIcon({
  mode,
  className,
}: {
  mode: CustomNodeActionMode;
  className?: string;
}) {
  if (mode === 'install') return <DownloadIcon className={className} />;
  if (mode === 'update') return <ReloadIcon className={className} />;
  if (mode === 'switch') return <MoveUpDownIcon className={className} />;
  if (mode === 'disable') return <EyeOffIcon className={className} />;
  return <TrashIcon className={className} />;
}

function MetadataItems({
  items,
  className,
}: {
  items: Array<string | ReactElement>;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className ?? ''}`}>
      {items.map((item, index) => (
        <span key={index} className="inline-flex min-w-0 items-center gap-2">
          {index > 0 ? <span className="text-slate-600">•</span> : null}
          <span className="min-w-0 truncate">{item}</span>
        </span>
      ))}
    </div>
  );
}
