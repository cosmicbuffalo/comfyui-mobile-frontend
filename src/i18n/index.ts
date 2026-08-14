import { useCallback } from 'react';
import { create } from 'zustand';
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from './locales';
import { zhCN } from './zh-CN';
import { zhTW } from './zh-TW';
import { ja } from './ja';
import { ko } from './ko';

export {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_LABELS,
  LOCALES,
  LOCALE_STORAGE_KEY,
} from './locales';
export type { Locale } from './locales';

/**
 * TODO(i18n-review): the zh-CN / zh-TW / ja / ko dictionaries are ~770 strings
 * each and were machine-translated. None of them has been reviewed by a fluent
 * speaker, and nothing in CI can catch a translation that is grammatical but
 * wrong, awkward, or wrong for its UI context — the tests only verify that keys
 * exist, are unique across locales, and keep their `{param}` placeholders.
 *
 * Worth a native-speaker pass per locale before leaning on these too heavily.
 * The highest-value strings to check first are the destructive-action dialogs
 * (delete / uninstall confirmations), where a mistranslation could get someone
 * to confirm something they didn't intend.
 */
const translations: Record<Locale, Record<string, string>> = {
  // English is the source of truth: every key is its own English text, so no
  // lookup table is needed. Missing translations in any locale fall back to
  // the English key.
  en: {},
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  ja,
  ko,
};

const warnedKeys = new Set<string>();

function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && isLocale(stored)) return stored;
  } catch {
    // localStorage unavailable (private mode / tests) — fall through.
  }
  if (typeof navigator !== 'undefined') {
    const lang = navigator.language?.toLowerCase() ?? '';
    if (lang.startsWith('zh')) {
      // Traditional Chinese locales (Taiwan / Hong Kong / Macau).
      if (lang === 'zh-tw' || lang === 'zh-hk' || lang === 'zh-mo') {
        return 'zh-TW';
      }
      return 'zh-CN';
    }
    if (lang.startsWith('ja')) return 'ja';
    if (lang.startsWith('ko')) return 'ko';
  }
  return DEFAULT_LOCALE;
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match,
  );
}

/**
 * Translate a key (English source string) into the given locale. `{param}`
 * placeholders are replaced from `params`.
 */
export function translate(
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const table = translations[locale] ?? {};
  const template = table[key] ?? key;
  if (locale !== 'en' && !(key in table) && !warnedKeys.has(key)) {
    warnedKeys.add(key);
    console.warn(`[i18n] Missing ${locale} translation for: ${key}`);
  }
  return interpolate(template, params);
}

function applyDocumentLocale(locale: Locale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectInitialLocale(),
  setLocale: (locale) => {
    if (!isLocale(locale)) return;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage failures; the in-memory locale still switches.
    }
    applyDocumentLocale(locale);
    set({ locale });
  },
}));

applyDocumentLocale(useLocaleStore.getState().locale);

export function getLocale(): Locale {
  return useLocaleStore.getState().locale;
}

/** Non-reactive translate for use outside React components. */
export function t(
  key: string,
  params?: Record<string, string | number>,
): string {
  return translate(key, getLocale(), params);
}

/**
 * React hook: re-renders when the locale changes.
 *
 * ```ts
 * const { t, locale, setLocale } = useI18n();
 * ```
 */
export function useI18n() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const translateLocale = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(key, locale, params),
    [locale],
  );
  return { t: translateLocale, locale, setLocale };
}
