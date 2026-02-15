interface ErrorHighlightBadgeProps {
  label: string;
}

export function ErrorHighlightBadge({ label }: ErrorHighlightBadgeProps) {
  return (
    <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-[100] animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap uppercase tracking-tighter ring-2 ring-white">
        {label}
      </div>
    </div>
  );
}
