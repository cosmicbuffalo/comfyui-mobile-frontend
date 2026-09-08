import type { Locale } from './locales';

/**
 * One dynamic import per translated locale, so each dictionary is its own chunk.
 *
 * The four tables are ~770 strings each and were reaching the browser inside the
 * entry bundle — every user parsing all four to read one, or none at all in the
 * English case. Imported this way, Vite emits a chunk per locale and the app
 * fetches at most the one it is about to draw in.
 *
 * `en` has no entry: every key IS its English text, so there is nothing to load.
 */
export const LOCALE_DICTIONARIES: Record<
  Exclude<Locale, 'en'>,
  () => Promise<Record<string, string>>
> = {
  'zh-CN': () => import('./zh-CN').then((module) => module.zhCN),
  'zh-TW': () => import('./zh-TW').then((module) => module.zhTW),
  ja: () => import('./ja').then((module) => module.ja),
  ko: () => import('./ko').then((module) => module.ko),
};
