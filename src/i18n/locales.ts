export const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  ja: '日本語',
  ko: '한국어',
};

export const LOCALE_STORAGE_KEY = 'comfyui-mobile-locale';

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}
