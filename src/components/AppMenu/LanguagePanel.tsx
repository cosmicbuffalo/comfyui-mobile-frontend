import { LOCALES, LOCALE_LABELS, useI18n } from '@/i18n';
import { MenuSubPageHeader } from './MenuSubPageHeader';
import {
  menuMutedTextClassName,
  menuPanelDivideClassName,
  menuTextClassName,
} from './menuStyles';

interface LanguagePanelProps {
  onBack: () => void;
}

export function LanguagePanel({ onBack }: LanguagePanelProps) {
  const { t, locale, setLocale } = useI18n();

  return (
    <div className="flex flex-col h-full">
      <MenuSubPageHeader title={t('Language')} onBack={onBack} />

      <div className={menuPanelDivideClassName}>
        <div className="px-4 py-3">
          <div className={`text-sm ${menuTextClassName}`}>{t('Language')}</div>
          <div className={`text-xs ${menuMutedTextClassName} mt-0.5`}>
            {t('Choose the language used throughout the app.')}
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('Language')}>
            {LOCALES.map((option) => {
              const isActive = locale === option;
              return (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setLocale(option)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                    isActive
                      ? 'border-cyan-400 bg-cyan-500 text-slate-950 shadow-sm'
                      : 'border-white/10 bg-slate-950/70 text-slate-100 hover:bg-slate-800/95'
                  }`}
                >
                  <span className="font-medium">{LOCALE_LABELS[option]}</span>
                  {isActive && <span aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
