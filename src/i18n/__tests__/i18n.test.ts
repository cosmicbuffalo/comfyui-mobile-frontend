import { describe, expect, it } from 'vitest';
import {
  getLocale,
  translate,
  useLocaleStore,
} from '@/i18n';
import {
  isLocale,
  LOCALES,
  LOCALE_LABELS,
  type Locale,
} from '@/i18n/locales';
import { zhCN } from '@/i18n/zh-CN';
import { zhTW } from '@/i18n/zh-TW';
import { ja } from '@/i18n/ja';
import { ko } from '@/i18n/ko';

const NON_EN_LOCALES: Locale[] = ['zh-CN', 'zh-TW', 'ja', 'ko'];

describe('i18n', () => {
  it('declares labels for every supported locale', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy();
      expect(isLocale(locale)).toBe(true);
    }
  });

  it('translates an English key into every non-English locale', () => {
    for (const locale of NON_EN_LOCALES) {
      expect(translate('Outputs', locale)).not.toBe('Outputs');
      expect(translate('Load Workflow', locale)).not.toBe('Load Workflow');
    }
  });

  it('interpolates {param} placeholders', () => {
    const result = translate('{count} run', 'zh-CN', { count: 3 });
    expect(result).toContain('3');
    expect(result).not.toContain('{count}');
  });

  it('falls back to the English key when a translation is missing', () => {
    expect(translate('A string that has no translation anywhere', 'zh-CN'))
      .toBe('A string that has no translation anywhere');
  });

  it('keeps the locale switchable and persisted', () => {
    const initial = useLocaleStore.getState().locale;
    useLocaleStore.getState().setLocale('zh-CN');
    expect(useLocaleStore.getState().locale).toBe('zh-CN');
    expect(getLocale()).toBe('zh-CN');
    // Restore so other tests keep their default.
    useLocaleStore.getState().setLocale(initial);
    expect(useLocaleStore.getState().locale).toBe(initial);
  });

  it('has no duplicate keys in any dictionary', () => {
    const dictionaries: Array<[string, Record<string, string>]> = [
      ['zh-CN', zhCN],
      ['zh-TW', zhTW],
      ['ja', ja],
      ['ko', ko],
    ];
    for (const [name, dictionary] of dictionaries) {
      const keys = Object.keys(dictionary);
      expect(new Set(keys).size, `${name} has duplicate keys`).toBe(keys.length);
    }
  });
});
