import { InfoIcon } from '@/components/icons/InfoIcon';
import { OverlayCircleButton } from './OverlayCircleButton';
import { useI18n } from '@/i18n';

interface MetadataButtonProps {
  onClick: () => void;
  disabled: boolean;
}

export function MetadataButton({
  onClick,
  disabled
}: MetadataButtonProps) {
  const { t } = useI18n();
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel={t('Toggle metadata')}
      disabled={disabled}
      className={`text-white ${disabled ? 'opacity-40' : ''}`}
      icon={<InfoIcon className="w-5 h-5" />}
    />
  );
}
