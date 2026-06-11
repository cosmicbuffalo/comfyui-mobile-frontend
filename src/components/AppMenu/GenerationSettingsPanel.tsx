import { MenuSubPageHeader } from './MenuSubPageHeader';
import { useGenerationSettingsStore, type PreviewMethod } from '@/hooks/useGenerationSettings';
import { menuMutedTextClassName, menuPanelDivideClassName, menuTextClassName } from './menuStyles';
import type { ReactNode } from 'react';

interface GenerationSettingsPanelProps {
  onBack: () => void;
}

const previewMethodOptions: Array<{
  value: Exclude<PreviewMethod, 'none'>;
  label: string;
  description: string;
}> = [
  {
    value: 'latent2rgb',
    label: 'Fast',
    description: 'Approximate latent2rgb previews',
  },
  {
    value: 'taesd',
    label: 'Accurate',
    description: 'Higher quality TAESD previews',
  },
];

interface PreferenceSectionProps {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

function PreferenceSection({
  label,
  description,
  checked,
  onToggle,
  children,
}: PreferenceSectionProps) {
  return (
    <div>
      <div className={menuPanelDivideClassName}>
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <div className={`text-sm ${menuTextClassName}`}>{label}</div>
            {description && (
              <div className={`text-xs ${menuMutedTextClassName} mt-0.5`}>{description}</div>
            )}
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ${
              checked ? 'bg-cyan-500' : 'bg-slate-700'
            }`}
            onClick={onToggle}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 ${
                checked ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function GenerationSettingsPanel({ onBack }: GenerationSettingsPanelProps) {
  const infiniteModeEnabled = useGenerationSettingsStore((s) => s.infiniteModeEnabled);
  const setInfiniteModeEnabled = useGenerationSettingsStore((s) => s.setInfiniteModeEnabled);
  const previewMethod = useGenerationSettingsStore((s) => s.previewMethod);
  const setPreviewMethod = useGenerationSettingsStore((s) => s.setPreviewMethod);
  const followIntoSubgraphs = useGenerationSettingsStore((s) => s.followIntoSubgraphs);
  const setFollowIntoSubgraphs = useGenerationSettingsStore((s) => s.setFollowIntoSubgraphs);
  const webpPreviewEnabled = useGenerationSettingsStore((s) => s.webpPreviewEnabled);
  const setWebpPreviewEnabled = useGenerationSettingsStore((s) => s.setWebpPreviewEnabled);
  const hideBottomBarWhenViewerIdle = useGenerationSettingsStore(
    (s) => s.hideBottomBarWhenViewerIdle,
  );
  const setHideBottomBarWhenViewerIdle = useGenerationSettingsStore(
    (s) => s.setHideBottomBarWhenViewerIdle,
  );
  const autoRestoreLostQueueJobs = useGenerationSettingsStore((s) => s.autoRestoreLostQueueJobs);
  const setAutoRestoreLostQueueJobs = useGenerationSettingsStore((s) => s.setAutoRestoreLostQueueJobs);
  const obfuscateSharedInputPaths = useGenerationSettingsStore((s) => s.obfuscateSharedInputPaths);
  const setObfuscateSharedInputPaths = useGenerationSettingsStore((s) => s.setObfuscateSharedInputPaths);
  const previewEnabled = previewMethod !== 'none';

  return (
    // Solid, full-height background so the area below the cards stays opaque
    // instead of letting the translucent slide panel show the backdrop through.
    // -m-4 bleeds over the slide panel's p-4; min-h calc(100%+2rem) + p-4 makes
    // the fill span the full padding box (all four edges) while keeping insets.
    <div className="flex flex-col min-h-[calc(100%+2rem)] -m-4 p-4 bg-slate-950">
      <MenuSubPageHeader title="Preferences" onBack={onBack} />

      <div className="space-y-4">
        <PreferenceSection
          label="Fast image previews"
          description="Load lightweight WebP previews instead of full-size originals. Turn off if images look wrong. Downloads always use the original."
          checked={webpPreviewEnabled}
          onToggle={() => setWebpPreviewEnabled(!webpPreviewEnabled)}
        />

        <PreferenceSection
          label="Show latent previews"
          checked={previewEnabled}
          onToggle={() => setPreviewMethod(previewEnabled ? 'none' : 'latent2rgb')}
        >
          {/* Method picker — only visible when enabled */}
          {previewEnabled && (
            <div className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className={`text-sm ${menuTextClassName}`}>Method</div>
                <div className={`text-xs ${menuMutedTextClassName} mt-0.5`}>
                  {previewMethod === 'latent2rgb'
                    ? 'Fast approximate preview'
                    : 'Higher quality, slightly slower'}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Latent preview method">
                {previewMethodOptions.map((option) => {
                  const isActive = previewMethod === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      onClick={() => setPreviewMethod(option.value)}
                      className={`min-h-[64px] rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                        isActive
                          ? 'border-cyan-400 bg-cyan-500 text-slate-950 shadow-sm'
                          : 'border-white/10 bg-slate-950/70 text-slate-100 hover:bg-slate-800/95'
                      }`}
                    >
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className={`mt-0.5 block text-xs ${isActive ? 'text-slate-900' : 'text-slate-400'}`}>
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </PreferenceSection>

        <PreferenceSection
          label="Restore lost queue after restart"
          description="Automatically re-enqueue pending jobs this device saw if ComfyUI restarts and loses them."
          checked={autoRestoreLostQueueJobs}
          onToggle={() => setAutoRestoreLostQueueJobs(!autoRestoreLostQueueJobs)}
        />

        <PreferenceSection
          label="Alias filepaths in embedded metadata"
          description="Hide input paths and output filename prefixes in shared workflow metadata."
          checked={obfuscateSharedInputPaths}
          onToggle={() => setObfuscateSharedInputPaths(!obfuscateSharedInputPaths)}
        />

        <PreferenceSection
          label="Enable infinite mode"
          checked={infiniteModeEnabled}
          onToggle={() => setInfiniteModeEnabled(!infiniteModeEnabled)}
        />

        <PreferenceSection
          label="Hide bottom bar when viewer is idle"
          description="Fade the bottom bar with the image viewer controls after a few seconds without interaction."
          checked={hideBottomBarWhenViewerIdle}
          onToggle={() => setHideBottomBarWhenViewerIdle(!hideBottomBarWhenViewerIdle)}
        />

        <PreferenceSection
          label="Follow into subgraphs"
          description="Navigate into subgraph scopes when following execution"
          checked={followIntoSubgraphs}
          onToggle={() => setFollowIntoSubgraphs(!followIntoSubgraphs)}
        />
      </div>
    </div>
  );
}
