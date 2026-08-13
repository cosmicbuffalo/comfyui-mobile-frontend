import { useState } from 'react';
import { CaretDownIcon, CheckIcon } from '@/components/icons';
import { LOCALES, LOCALE_LABELS, useI18n } from '@/i18n';
import { CollapsibleMenuSection } from './CollapsibleMenuSection';
import {
  menuChevronClassName,
  menuSectionHeaderClassName,
  menuSurfaceButtonClassName,
  menuTextClassName,
} from './menuStyles';

/** Standalone "Language" menu section — sits directly above About so the
 *  language switcher is one tap away from anywhere in the app. */
export function MenuLanguageSection() {
  const { t, locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={menuSectionHeaderClassName}
        aria-expanded={open}
      >
        <span>{t('Language')}</span>
        <CaretDownIcon className={`${menuChevronClassName} ${open ? 'rotate-0' : '-rotate-90'}`} />
      </button>
      <CollapsibleMenuSection open={open}>
        <div className="space-y-2 pb-1">
          {LOCALES.map((option) => {
            const isActive = locale === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setLocale(option)}
                aria-pressed={isActive}
                className={menuSurfaceButtonClassName}
              >
                <span className={menuTextClassName}>{LOCALE_LABELS[option]}</span>
                {isActive && (
                  <span className="ml-auto text-cyan-400">
                    <CheckIcon className="w-4 h-4" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </CollapsibleMenuSection>
    </section>
  );
}
