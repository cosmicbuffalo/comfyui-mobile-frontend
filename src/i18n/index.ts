import { useCallback } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zhCN } from './zh-CN';

export type Language = 'zh' | 'en';

interface I18nState {
  language: Language;
  setLanguage: (language: Language) => void;
}

/**
 * Initial language on first run (no persisted choice yet): follow the
 * browser/device language — Simplified Chinese users get the Chinese UI,
 * everyone else gets English. A persisted choice always wins afterwards.
 */
export function detectInitialLanguage(): Language {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    if (navigator.language.toLowerCase().startsWith('zh')) {
      return 'zh';
    }
  }
  return 'en';
}

/**
 * Global language preference. Defaults to English for non-Chinese browsers
 * (see detectInitialLanguage); persisted so the choice survives reloads. The
 * English UI is the source-of-truth fallback: for language === 'en' every key
 * is returned verbatim, so no separate English dictionary is needed.
 */
export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: detectInitialLanguage(),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'comfyui-mobile-language',
      version: 1,
    },
  ),
);

export type TranslateParams = Record<string, string | number>;

/**
 * Translate a UI string. Keys are the exact English source literals.
 * Interpolated values use `{name}` placeholders inside the key, e.g.
 * t('{count} nodes', { count: 3 }).
 */
export function translate(key: string, params?: TranslateParams): string {
  const language = useI18nStore.getState().language;
  let text = language === 'zh' ? (zhCN[key] ?? key) : key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

export const t = translate;

/**
 * Hook for use inside components. Re-renders when the language changes, so
 * every component that renders translated text must call this and use the
 * returned function (never the bare `t`) during render.
 */
export function useT(): typeof t {
  const language = useI18nStore((s) => s.language);
  return useCallback(
    (key: string, params?: TranslateParams) => {
      // Reading `language` here is deliberate: it keeps this callback's
      // identity tied to the current language so memoized callers that use
      // t() recompute their cached strings after a language switch.
      void language;
      return translate(key, params);
    },
    [language],
  );
}
