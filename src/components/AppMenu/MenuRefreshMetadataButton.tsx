import { CheckIcon, CloudDownloadIcon } from "@/components/icons";
import { useLoraManagerMetadataStore } from "@/hooks/useLoraManagerMetadata";
import { useI18n } from "@/i18n";
import { MenuErrorNotice } from "./MenuErrorNotice";
import { menuIconClassName, menuSurfaceButtonDisabledClassName, menuTextClassName } from "./menuStyles";

/**
 * "Refresh model metadata" button for the Server menu section. Refreshes every
 * model kind through Lora Manager when it is installed, or through our built-in
 * compatible scanner otherwise.
 */
export function MenuRefreshMetadataButton() {
  const { t } = useI18n();
  const refreshing = useLoraManagerMetadataStore((s) => s.refreshing);
  const refreshDone = useLoraManagerMetadataStore((s) => s.refreshDone);
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
        disabled={refreshing || refreshDone}
        className={menuSurfaceButtonDisabledClassName}
      >
        {refreshDone ? (
          <CheckIcon className="w-6 h-6 shrink-0 text-emerald-400" />
        ) : (
          <CloudDownloadIcon className={menuIconClassName} />
        )}
        <span className={refreshDone ? "min-w-0 font-medium text-emerald-200" : menuTextClassName}>
          {refreshing
            ? t("Refreshing {label}", { label: refreshLabel ?? "" }).trim()
            : refreshDone
              ? `${t("Done")}!`
              : t("Refresh model metadata")}
        </span>
      </button>
      {!refreshing && (
        <MenuErrorNotice error={refreshError} onDismiss={() => setRefreshError(null)} />
      )}
    </>
  );
}
