import { BookIcon, CaretDownIcon, ExternalLinkIcon, GithubIcon, InfoCircleOutlineIcon } from '@/components/icons';

interface MenuAboutSectionProps {
  open: boolean;
  sectionRef: React.RefObject<HTMLElement | null>;
  onToggle: () => void;
  onOpenLegend: () => void;
}

export function MenuAboutSection({
  open,
  sectionRef,
  onToggle,
  onOpenLegend,
}: MenuAboutSectionProps) {
  return (
    <section ref={sectionRef} className="mt-auto pt-6 border-t border-gray-200">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3"
        aria-expanded={open}
      >
        <span>About</span>
        <CaretDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="space-y-2 pb-4">
          <a
            href="https://github.com/cosmicbuffalo/comfyui-mobile-frontend"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <GithubIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">Open in GitHub</span>
            <ExternalLinkIcon className="w-4 h-4 ml-auto text-gray-400" />
          </a>

          <button
            onClick={onOpenLegend}
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <InfoCircleOutlineIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">Icon Legend</span>
            <span className="ml-auto text-gray-400">&rarr;</span>
          </button>

          <a
            href="https://github.com/cosmicbuffalo/comfyui-mobile-frontend/blob/main/USER_GUIDE.md"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 p-4 bg-white border border-gray-200
                       rounded-xl text-left hover:bg-gray-50 min-h-[56px]"
          >
            <BookIcon className="w-6 h-6 text-gray-600" />
            <span className="font-medium text-gray-900">User Manual</span>
            <ExternalLinkIcon className="w-4 h-4 ml-auto text-gray-400" />
          </a>
        </div>
      )}
    </section>
  );
}
