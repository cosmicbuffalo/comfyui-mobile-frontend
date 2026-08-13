import { useI18nStore, useT } from './index';
import {
  menuPanelDivideClassName,
  menuTextClassName,
} from '@/components/AppMenu/menuStyles';

/**
 * Language switcher: 中文 / English segmented control shown at the top of the
 * Preferences page. Both option labels are shown in their own language so the
 * switch stays usable regardless of the current UI language.
 */
export function LanguageToggle() {
  const language = useI18nStore((s) => s.language);
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const t = useT();

  const options: Array<{ value: 'zh' | 'en'; label: string }> = [
    { value: 'zh', label: '中文' },
    { value: 'en', label: 'English' },
  ];

  return (
    <div className={menuPanelDivideClassName}>
      <div className="px-4 py-3">
        <div className={`text-sm ${menuTextClassName}`}>{t('Language')}</div>
        <div
          className="mt-3 grid grid-cols-2 gap-2"
          role="radiogroup"
          aria-label={t('Language')}
        >
          {options.map((option) => {
            const isActive = language === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setLanguage(option.value)}
                className={`min-h-[44px] rounded-lg border px-3 py-2 text-center text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                  isActive
                    ? 'border-cyan-400 bg-cyan-500 text-slate-950 shadow-sm'
                    : 'border-white/10 bg-slate-950/70 text-slate-100 hover:bg-slate-800/95'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
