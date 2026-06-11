import { DownloadDeviceIcon } from '@/components/icons';
import { OverlayCircleButton } from './OverlayCircleButton';

interface DownloadButtonProps {
  onClick: () => void;
}

export function DownloadButton({ onClick }: DownloadButtonProps) {
  return (
    <OverlayCircleButton
      onClick={onClick}
      ariaLabel="Download"
      className="text-white"
      icon={<DownloadDeviceIcon className="w-5 h-5" />}
    />
  );
}
