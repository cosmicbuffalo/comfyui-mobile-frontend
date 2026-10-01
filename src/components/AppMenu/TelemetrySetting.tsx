import { getTelemetryStatus } from '@/api/client/preferences';
import { useI18n } from '@/i18n';
import { ServerSwitchSetting } from './ServerSwitchSetting';

/**
 * Server-wide switch for the node's operational telemetry (mobile_telemetry.py).
 * On by default. When COMFYUI_MOBILE_TELEMETRY is set, the environment decides
 * and the switch only reports it.
 */
export function TelemetrySetting() {
  const { t } = useI18n();
  return (
    <ServerSwitchSetting
      label={t('Share operational telemetry')}
      description={t('Help improve the mobile frontend by sending anonymous counts of how this server runs. Never prompts, workflows, file names or who uses it.')}
      lockedNote={t('Set by the COMFYUI_MOBILE_TELEMETRY environment variable on this server.')}
      preferenceKey="telemetryEnabled"
      getStatus={getTelemetryStatus}
    />
  );
}
