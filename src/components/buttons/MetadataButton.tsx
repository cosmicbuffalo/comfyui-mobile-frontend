import { InfoIcon } from '@/components/icons/InfoIcon';
import { useT } from '@/i18n';
import { OverlayCircleButton } from './OverlayCircleButton';

interface MetadataButtonProps {
  onClick: () => void;
  disabled: boolean;
}

export function MetadataButton({
  onClick,
  disabled
}: MetadataButtonProps) {
  const t = useT();
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
