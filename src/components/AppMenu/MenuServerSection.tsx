import { Component, type ReactNode } from 'react';
import { CaretDownIcon, GearIcon, ReloadIcon, ServerIcon, WarningTriangleIcon } from '@/components/icons';
import type { SystemStats } from '@/api/client';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function UsageBar({ used, total, label, color = 'bg-blue-500' }: { used: number; total: number; label: string; color?: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
        <span>{label}</span>
        <span>{formatBytes(used)} / {formatBytes(total)}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
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
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-400 text-center flex items-center justify-center gap-2">
          <WarningTriangleIcon className="w-4 h-4 text-gray-300" />
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
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      {version && (
        <div className="flex items-center gap-2 mb-1">
          <ServerIcon className="w-5 h-5 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">
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
            <div className="text-xs font-medium text-gray-600 truncate" title={device.name}>
              {gpuName || device.name || `GPU ${device.index}`}
            </div>
            <UsageBar
              used={vramUsed}
              total={device.vram_total}
              label="VRAM"
              color={device.vram_total > 0 && vramUsed / device.vram_total > 0.9 ? 'bg-red-500' : device.vram_total > 0 && vramUsed / device.vram_total > 0.7 ? 'bg-amber-500' : 'bg-blue-500'}
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
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>CPU</span>
            <span>{cpuPercent.toFixed(0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${cpuPercent > 90 ? 'bg-red-500' : cpuPercent > 70 ? 'bg-amber-500' : 'bg-violet-500'}`}
              style={{ width: `${Math.min(100, cpuPercent)}%` }}
            />
          </div>
        </div>
      )}

      {(pytorchVersion || pythonVersion) && (
        <div className="pt-2 border-t border-gray-100 space-y-1">
          {pytorchVersion && (
            <div className="flex justify-between text-xs text-gray-400">
              <span>PyTorch</span>
              <span>{pytorchVersion}</span>
            </div>
          )}
          {pythonVersion && (
            <div className="flex justify-between text-xs text-gray-400">
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
}: MenuServerSectionProps) {
  return (
    <section ref={sectionRef} className="mb-6">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
        aria-expanded={open}
      >
        <span>Server</span>
        <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="space-y-2">
          <StatsErrorBoundary>
            {systemStats ? (
              <ServerStatsCard systemStats={systemStats} cpuPercent={cpuPercent} />
            ) : (
              <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-400 text-center">
                Loading server info...
              </div>
            )}
          </StatsErrorBoundary>

          <button
            onClick={onOpenGenerationSettings}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <GearIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">Generation Settings</span>
          </button>

          <button
            onClick={onRestartServer}
            disabled={restartingServer}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ReloadIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">
              {restartingServer ? 'Restarting ComfyUI...' : 'Restart ComfyUI'}
            </span>
          </button>
        </div>
      )}
    </section>
  );
}
