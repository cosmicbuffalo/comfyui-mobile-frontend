import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

// Keys in source order, including any duplicates — the whole point of reading
// the file rather than the evaluated object.
function readDictionaryKeys(locale: Locale): string[] {
  const source = readFileSync(
    resolve(process.cwd(), `src/i18n/${locale}.ts`),
    'utf8',
  );
  const entry = /^ {2}('|")((?:\\.|(?!\1).)*)\1\s*:/gm;
  return [...source.matchAll(entry)].map(([, , key]) =>
    key.replace(/\\(['"\\])/g, '$1'),
  );
}

// Every string literal handed to t() across the app, with the file:line it came
// from. Only literal calls are visible here — a handful of sites translate a
// runtime value (`t(action.label)`), and those keys can't be checked statically.
function readSourceTranslationKeys(): Map<string, string> {
  const root = resolve(process.cwd(), 'src');
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !f.includes('__tests__') && !f.startsWith('i18n/'));

  // `\bt(` with a quoted first argument. The word boundary keeps `format(`,
  // `useEffect(` and friends from matching.
  const call = /\bt\(\s*('|")((?:\\.|(?!\1).)*)\1/g;
  const found = new Map<string, string>();
  for (const file of files) {
    const source = readFileSync(resolve(root, file), 'utf8');
    for (const match of source.matchAll(call)) {
      const key = match[2].replace(/\\(['"\\])/g, '$1');
      if (found.has(key)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      found.set(key, `src/${file}:${line}`);
    }
  }
  return found;
}

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
    // Must read the source text, not Object.keys(): a duplicated key collapses
    // when the object literal is evaluated, so an in-memory check can never
    // fail and would silently pass a dictionary with a shadowed entry.
    for (const name of NON_EN_LOCALES) {
      const keys = readDictionaryKeys(name);
      const seen = new Set<string>();
      const duplicates = keys.filter((key) => {
        if (seen.has(key)) return true;
        seen.add(key);
        return false;
      });
      expect(duplicates, `${name} has duplicate keys: ${duplicates.join(', ')}`)
        .toEqual([]);
    }
  });

  it('translates every string the app passes to t()', () => {
    // The guard against silent drift. Two ways this fails:
    //   - a new t('...') string was added without dictionary entries, so it
    //     renders English in every locale;
    //   - an existing English string was reworded, which changes the key and
    //     silently unhooks all four translations at once.
    // Either way the UI degrades to English with only a console warning at
    // runtime, so it has to be caught here.
    const sourceKeys = readSourceTranslationKeys();
    const translated = new Set(readDictionaryKeys('zh-CN'));
    const untranslated = [...sourceKeys]
      .filter(([key]) => !translated.has(key))
      .map(([key, where]) => `${where}  t(${JSON.stringify(key)})`);

    expect(
      untranslated,
      `${untranslated.length} string(s) reach t() with no dictionary entry. ` +
        'Add them to all four dictionaries in src/i18n/, or revert the English ' +
        'wording change that orphaned them:\n' + untranslated.join('\n'),
    ).toEqual([]);
  });

  it('defines the same key set in every dictionary', () => {
    // zh-CN is the reference; drift in either direction means some locale
    // silently falls back to English for a string the others translate.
    const reference = readDictionaryKeys('zh-CN');
    const referenceSet = new Set(reference);
    for (const name of NON_EN_LOCALES.filter((l) => l !== 'zh-CN')) {
      const keys = new Set(readDictionaryKeys(name));
      const missing = reference.filter((key) => !keys.has(key));
      const extra = [...keys].filter((key) => !referenceSet.has(key));
      expect(missing, `${name} is missing keys`).toEqual([]);
      expect(extra, `${name} has keys zh-CN lacks`).toEqual([]);
    }
  });

  it('preserves every {param} placeholder from the English key', () => {
    // The key is the English source string, so it defines which placeholders
    // must survive translation. A dropped one renders as a blank in the UI; an
    // invented one renders literally, since interpolate() leaves it untouched.
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const dictionaries: Array<[string, Record<string, string>]> = [
      ['zh-CN', zhCN],
      ['zh-TW', zhTW],
      ['ja', ja],
      ['ko', ko],
    ];
    for (const [name, dictionary] of dictionaries) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect(placeholders(value), `${name} placeholder mismatch for "${key}"`)
          .toEqual(placeholders(key));
      }
    }
  });
});
