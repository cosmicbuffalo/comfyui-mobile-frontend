import { getCivitaiStatus } from '@/api/loraManagerClient';
import { useLoraManagerMetadataStore } from '@/hooks/useLoraManagerMetadata';
import { useI18n } from '@/i18n';
import { ServerSwitchSetting } from './ServerSwitchSetting';

/**
 * Server-wide switch for looking models up on CivitAI (model_metadata.py, and
 * the lookups this app asks Lora Manager for). On by default. When
 * COMFYUI_MOBILE_CIVITAI_METADATA is set, the environment decides and the
 * switch only reports it.
 */
export function CivitaiMetadataSetting() {
  const { t } = useI18n();
  const setCivitaiEnabled = useLoraManagerMetadataStore((s) => s.setCivitaiEnabled);
  return (
    <ServerSwitchSetting
      label={t('Fetch model details from CivitAI')}
      description={t('Look up previews, names and base models for your models on CivitAI, including new models as soon as a workflow uses them. Sends a hash of the model file, never its name.')}
      lockedNote={t('Set by the COMFYUI_MOBILE_CIVITAI_METADATA environment variable on this server.')}
      preferenceKey="civitaiMetadataEnabled"
      getStatus={getCivitaiStatus}
      onStatus={(status) => setCivitaiEnabled(status.enabled)}
    />
  );
}
