export async function restartServer(): Promise<void> {
  const response = await fetch(`/mobile/api/restart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm: true })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to restart server');
  }
}

export interface SystemDevice {
  name: string;
  type: string;
  index: number;
  vram_total: number;
  vram_free: number;
  torch_vram_total: number;
  torch_vram_free: number;
}

export interface SystemStats {
  system: {
    os: string;
    ram_total: number;
    ram_free: number;
    comfyui_version: string;
    python_version: string;
    pytorch_version: string;
    embedded_python: boolean;
    argv: string[];
  };
  devices: SystemDevice[];
}

export async function fetchSystemStats(): Promise<SystemStats> {
  const response = await fetch(`/system_stats`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to fetch system stats');
  }
  return response.json();
}


export async function fetchCpuPercent(): Promise<number | null> {
  try {
    const response = await fetch(`/mobile/api/cpu-stats`, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    return data.cpu_percent ?? null;
  } catch {
    return null;
  }
}
