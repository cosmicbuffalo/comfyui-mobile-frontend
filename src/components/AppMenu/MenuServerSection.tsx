import { Component, type ReactNode } from 'react';
import { CaretDownIcon, DownloadDeviceIcon, GearIcon, ReloadIcon, ServerIcon, WarningTriangleIcon } from '@/components/icons';
import type { SystemStats } from '@/api/client';
import { MenuRefreshMetadataButton } from './MenuRefreshMetadataButton';
import {
  menuChevronClassName,
  menuIconClassName,
  menuSectionHeaderClassName,
  menuSurfaceButtonClassName,
  menuSurfaceButtonDisabledClassName,
  menuSurfaceClassName,
  menuTextClassName,
} from './menuStyles';
import { CollapsibleMenuSection } from './CollapsibleMenuSection';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function UsageBar({ used, total, label, color = 'bg-cyan-500' }: { used: number; total: number; label: string; color?: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
        <span>{label}</span>
        <span>{formatBytes(used)} / {formatBytes(total)}</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

class StatsErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={`${menuSurfaceClassName} p-4 text-sm text-slate-400 text-center flex items-center justify-center gap-2`}>
          <WarningTriangleIcon className="w-4 h-4 text-slate-500" />
          Unable to display server stats
        </div>
      );
    }
    return this.props.children;
  }
}

function ServerStatsCard({ systemStats, cpuPercent }: { systemStats: SystemStats; cpuPercent: number | null }) {
  const version = systemStats.system?.comfyui_version;
  const devices = systemStats.devices ?? [];
  const ramTotal = systemStats.system?.ram_total;
  const ramFree = systemStats.system?.ram_free;
  const hasRam = typeof ramTotal === 'number' && typeof ramFree === 'number' && ramTotal > 0;
  const pytorchVersion = systemStats.system?.pytorch_version;
  const pythonVersion = systemStats.system?.python_version;

  return (
    <div className={`${menuSurfaceClassName} p-4 space-y-3`}>
      {version && (
        <div className="flex items-center gap-2 mb-1">
          <ServerIcon className="w-5 h-5 text-slate-300" />
          <span className="text-sm font-medium text-slate-100">
            ComfyUI {version}
          </span>
        </div>
      )}

      {devices.map((device) => {
        if (!device || typeof device.vram_total !== 'number' || typeof device.vram_free !== 'number') return null;
        const vramUsed = device.vram_total - device.vram_free;
        const gpuName = (device.name ?? '')
          .replace(/^cuda:\d+\s*/, '')
          .replace(/\s*:\s*cudaMallocAsync$/, '')
          .trim();
        return (
          <div key={device.index} className="space-y-2">
            <div className="text-xs font-medium text-slate-300 truncate" title={device.name}>
              {gpuName || device.name || `GPU ${device.index}`}
            </div>
            <UsageBar
              used={vramUsed}
              total={device.vram_total}
              label="VRAM"
              color={device.vram_total > 0 && vramUsed / device.vram_total > 0.9 ? 'bg-red-500' : device.vram_total > 0 && vramUsed / device.vram_total > 0.7 ? 'bg-amber-500' : 'bg-cyan-500'}
            />
          </div>
        );
      })}

      {hasRam && (
        <UsageBar
          used={ramTotal - ramFree}
          total={ramTotal}
          label="System RAM"
          color="bg-emerald-500"
        />
      )}

      {cpuPercent != null && (
        <div>
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span>CPU</span>
            <span>{cpuPercent.toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${cpuPercent > 90 ? 'bg-red-500' : cpuPercent > 70 ? 'bg-amber-500' : 'bg-violet-500'}`}
              style={{ width: `${Math.min(100, cpuPercent)}%` }}
            />
          </div>
        </div>
      )}

      {(pytorchVersion || pythonVersion) && (
        <div className="pt-2 border-t border-white/10 space-y-1">
          {pytorchVersion && (
            <div className="flex justify-between text-xs text-slate-500">
              <span>PyTorch</span>
              <span>{pytorchVersion}</span>
            </div>
          )}
          {pythonVersion && (
            <div className="flex justify-between text-xs text-slate-500">
              <span>Python</span>
              <span>{pythonVersion.split(' ')[0]}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface MenuServerSectionProps {
  open: boolean;
  systemStats: SystemStats | null;
  cpuPercent: number | null;
  restartingServer: boolean;
  sectionRef: React.RefObject<HTMLElement | null>;
  onToggle: () => void;
  onRestartServer: () => void;
  onOpenGenerationSettings: () => void;
  onOpenCustomNodes: () => void;
}

export function MenuServerSection({
  open,
  systemStats,
  cpuPercent,
  restartingServer,
  sectionRef,
  onToggle,
  onRestartServer,
  onOpenGenerationSettings,
  onOpenCustomNodes,
}: MenuServerSectionProps) {
  return (
    <section ref={sectionRef} className="mb-6">
      <button
        type="button"
        onClick={onToggle}
        className={menuSectionHeaderClassName}
        aria-expanded={open}
      >
        <span>Server</span>
        <CaretDownIcon className={`${menuChevronClassName} ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      <CollapsibleMenuSection open={open}>
        <div className="space-y-2 pb-1">
          <StatsErrorBoundary>
            {systemStats ? (
              <ServerStatsCard systemStats={systemStats} cpuPercent={cpuPercent} />
            ) : (
              <div className={`${menuSurfaceClassName} p-4 text-sm text-slate-400 text-center`}>
                Loading server info...
              </div>
            )}
          </StatsErrorBoundary>

          <button
            onClick={onOpenCustomNodes}
            className={menuSurfaceButtonClassName}
          >
            <DownloadDeviceIcon className={menuIconClassName} />
            <span className={menuTextClassName}>Custom nodes</span>
          </button>

          <MenuRefreshMetadataButton />

          <button
            onClick={onOpenGenerationSettings}
            className={menuSurfaceButtonClassName}
          >
            <GearIcon className={menuIconClassName} />
            <span className={menuTextClassName}>Preferences</span>
          </button>

          <button
            onClick={onRestartServer}
            disabled={restartingServer}
            className={menuSurfaceButtonDisabledClassName}
          >
            <ReloadIcon className={menuIconClassName} />
            <span className={menuTextClassName}>
              {restartingServer ? 'Restarting ComfyUI...' : 'Restart ComfyUI'}
            </span>
          </button>
        </div>
      </CollapsibleMenuSection>
    </section>
  );
}
