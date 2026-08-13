import { CloudDownloadIcon } from "@/components/icons";
import { useLoraManagerMetadataStore } from "@/hooks/useLoraManagerMetadata";
import { MenuErrorNotice } from "./MenuErrorNotice";
import { menuIconClassName, menuSurfaceButtonDisabledClassName, menuTextClassName } from "./menuStyles";
import { useT } from "@/i18n";

/**
 * "Refresh model metadata" button for the Server menu section. Runs our built-in
 * Civitai fetcher across all model kinds — populating preview/name/version/badge
 * data and writing Lora Manager-compatible sidecars. Always available (the
 * fetcher ships with the app), *including* when Lora Manager is installed (they
 * share sidecars, so refreshing here updates both).
 */
export function MenuRefreshMetadataButton() {
  const t = useT();
  const refreshing = useLoraManagerMetadataStore((s) => s.refreshing);
  const refreshLabel = useLoraManagerMetadataStore((s) => s.refreshLabel);
  const refreshError = useLoraManagerMetadataStore((s) => s.refreshError);
  const setRefreshError = useLoraManagerMetadataStore((s) => s.setRefreshError);
  const refreshAllMetadata = useLoraManagerMetadataStore(
    (s) => s.refreshAllMetadata,
  );

  return (
    <>
      <button
        onClick={refreshAllMetadata}
        disabled={refreshing}
        className={menuSurfaceButtonDisabledClassName}
      >
        <CloudDownloadIcon className={menuIconClassName} />
        <span className={menuTextClassName}>
          {refreshing
            ? t('Refreshing {refreshLabel}', { refreshLabel: refreshLabel ?? '' }).trim()
            : t('Refresh model metadata')}
        </span>
      </button>
      {!refreshing && (
        <MenuErrorNotice error={refreshError} onDismiss={() => setRefreshError(null)} />
      )}
    </>
  );
}
