import { useCallback } from 'react';
import { create } from 'zustand';
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
  type Locale,
} from './locales';
import { LOCALE_DICTIONARIES } from './dictionaries';

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
/**
 * Dictionaries that have arrived. Loaded on demand — see `./dictionaries`.
 *
 * English is the source of truth: every key is its own English text, so no
 * lookup table is needed and `en` is complete from the start. Any locale not in
 * here yet falls back to the English key, which is also what a genuinely
 * missing translation does.
 */
const translations: Partial<Record<Locale, Record<string, string>>> = {
  en: {},
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
  const table = translations[locale];
  const template = table?.[key] ?? key;
  // Only a dictionary that is actually here can be missing a key. Warning while
  // one is still in flight would report every string in the app as untranslated
  // on each cold load.
  if (table && locale !== 'en' && !(key in table) && !warnedKeys.has(key)) {
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
  /**
   * Bumped each time a dictionary lands. Nothing reads its value — it exists so
   * a component holding a memoised `t` re-renders when the words it needs
   * finally arrive, which a locale that never changed would not otherwise do.
   */
  dictionaryVersion: number;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectInitialLocale(),
  dictionaryVersion: 0,
  setLocale: (locale) => {
    if (!isLocale(locale)) return;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage failures; the in-memory locale still switches.
    }
    applyDocumentLocale(locale);
    set({ locale });
    void ensureLocaleLoaded(locale);
  },
}));

const inFlight = new Map<Locale, Promise<void>>();

/**
 * Fetch a locale's dictionary, once. Resolves immediately for a locale that is
 * already here, and for `en`, which needs nothing.
 *
 * A failure resolves rather than rejects: the app is entirely usable in English
 * and a missing dictionary is not worth taking a render down for.
 */
export function ensureLocaleLoaded(locale: Locale): Promise<void> {
  if (locale === 'en' || translations[locale]) return Promise.resolve();
  const existing = inFlight.get(locale);
  if (existing) return existing;

  const load = LOCALE_DICTIONARIES[locale]()
    .then((table) => {
      translations[locale] = table;
      useLocaleStore.setState((state) => ({
        dictionaryVersion: state.dictionaryVersion + 1,
      }));
    })
    .catch((error) => {
      console.warn(`[i18n] Unable to load the ${locale} dictionary:`, error);
    })
    .finally(() => {
      inFlight.delete(locale);
    });
  inFlight.set(locale, load);
  return load;
}

/**
 * The dictionary for the locale this visit starts in. Awaited before the first
 * render so a non-English user is not shown a frame of English while their
 * words are still on the wire.
 */
export const initialLocaleReady: Promise<void> = ensureLocaleLoaded(
  useLocaleStore.getState().locale,
);

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
  // A dictionary arriving changes what `translate` returns without changing the
  // locale, so the memo has to depend on it too.
  const dictionaryVersion = useLocaleStore((s) => s.dictionaryVersion);
  const translateLocale = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      translate(key, locale, params),
    // dictionaryVersion is a cache-invalidation signal, not a value this reads —
    // `translate` looks the table up itself. The rule cannot see that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, dictionaryVersion],
  );
  return { t: translateLocale, locale, setLocale };
}
