import { MenuSubPageHeader } from './MenuSubPageHeader';
import { useGenerationSettingsStore } from '@/hooks/useGenerationSettings';

interface GenerationSettingsPanelProps {
  onBack: () => void;
}

export function GenerationSettingsPanel({ onBack }: GenerationSettingsPanelProps) {
  const previewMethod = useGenerationSettingsStore((s) => s.previewMethod);
  const setPreviewMethod = useGenerationSettingsStore((s) => s.setPreviewMethod);
  const enabled = previewMethod !== 'none';

  return (
    <>
      <MenuSubPageHeader title="Generation Settings" onBack={onBack} />

      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Latent Preview
          </div>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
            {/* Enable toggle */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="text-sm font-medium text-gray-900">Show live preview</div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${
                  enabled ? 'bg-blue-600' : 'bg-gray-300'
                }`}
                onClick={() => setPreviewMethod(enabled ? 'none' : 'latent2rgb')}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${
                    enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Method picker — only visible when enabled */}
            {enabled && (
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">Method</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {previewMethod === 'latent2rgb'
                      ? 'Fast approximate preview'
                      : 'Higher quality, slightly slower'}
                  </div>
                </div>
                <select
                  value={previewMethod}
                  onChange={(e) => setPreviewMethod(e.target.value as 'latent2rgb' | 'taesd')}
                  className="text-sm bg-gray-100 border border-gray-200 rounded-lg px-3 py-1.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="latent2rgb">Fast (latent2rgb)</option>
                  <option value="taesd">Accurate (TAESD)</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
