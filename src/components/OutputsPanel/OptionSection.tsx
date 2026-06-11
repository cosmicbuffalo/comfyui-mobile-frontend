interface OptionSectionItem<TValue extends string> {
  value: TValue;
  label: string;
  suffix?: string;
}

interface OptionSectionProps<TValue extends string> {
  idPrefix: string;
  title: string;
  items: Array<OptionSectionItem<TValue>>;
  selectedValue: TValue;
  onSelect: (value: TValue) => void;
  gridClassName?: string;
  buttonClassName?: string;
}

export function OptionSection<TValue extends string>({
  idPrefix,
  title,
  items,
  selectedValue,
  onSelect,
  gridClassName = 'grid grid-cols-2 gap-2',
  buttonClassName = ''
}: OptionSectionProps<TValue>) {
  return (
    <div id={`${idPrefix}-container`}>
      <h4 id={`${idPrefix}-label`} className="text-sm font-medium text-slate-300 mb-2">
        {title}
      </h4>
      <div id={`${idPrefix}-options`} className={gridClassName}>
        {items.map((item) => {
          const isActive = selectedValue === item.value;
          return (
            <button
              key={item.value}
              className={`px-3 py-2 rounded-lg text-sm border ${buttonClassName} ${
                isActive
                  ? 'bg-cyan-500 border-cyan-500 text-slate-950 shadow-sm'
                  : 'border-white/10 bg-slate-950/70 text-slate-200 hover:bg-slate-800/95'
              }`}
              onClick={() => onSelect(item.value)}
            >
              {item.label}
              {isActive && item.suffix ? item.suffix : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}
