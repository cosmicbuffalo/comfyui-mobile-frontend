import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectInitialLanguage, t, useI18nStore } from '@/i18n';
import { zhCN } from '@/i18n/zh-CN';
import { LanguageToggle } from '@/i18n/LanguageToggle';

describe('detectInitialLanguage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('picks Chinese for zh* browser languages (case-insensitive)', () => {
    for (const lang of ['zh-CN', 'zh-TW', 'zh-HK', 'ZH-CN']) {
      vi.stubGlobal('navigator', { language: lang });
      expect(detectInitialLanguage()).toBe('zh');
    }
  });

  it('picks English for non-Chinese browser languages', () => {
    for (const lang of ['en-US', 'en-GB', 'ja-JP', 'ko-KR', 'fr-FR']) {
      vi.stubGlobal('navigator', { language: lang });
      expect(detectInitialLanguage()).toBe('en');
    }
  });

  it('picks English when navigator.language is unavailable', () => {
    vi.stubGlobal('navigator', {});
    expect(detectInitialLanguage()).toBe('en');
  });
});

describe('i18n store + t()', () => {
  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ language: 'zh' });
  });

  it('translates known keys in Chinese mode', () => {
    expect(t('Queue')).toBe('队列');
    expect(t('Run')).toBe('运行');
    expect(t('Queue')).toBe(zhCN['Queue']);
  });

  it('returns the key verbatim for unknown keys in Chinese mode', () => {
    expect(t('A string nobody wrapped')).toBe('A string nobody wrapped');
  });

  it('returns keys verbatim in English mode', () => {
    useI18nStore.getState().setLanguage('en');
    expect(useI18nStore.getState().language).toBe('en');
    expect(t('Queue')).toBe('Queue');
    expect(t('Run')).toBe('Run');
  });

  it('interpolates {name} placeholders', () => {
    expect(t('{count} nodes', { count: 3 })).toBe('3 个节点');
    expect(t('Node {id}', { id: 7 })).toBe('节点 7');
  });

  it('persists the language choice to localStorage', () => {
    useI18nStore.getState().setLanguage('en');
    const saved = JSON.parse(
      localStorage.getItem('comfyui-mobile-language') ?? '{}',
    ) as { state?: { language?: string } };
    expect(saved.state?.language).toBe('en');
  });
});

describe('LanguageToggle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    useI18nStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders both language options and switches language on click', async () => {
    await act(async () => {
      root.render(<LanguageToggle />);
    });

    const buttons = container.querySelectorAll<HTMLButtonElement>(
      'button[role="radio"]',
    );
    expect(buttons.length).toBe(2);
    expect(buttons[0]?.textContent).toBe('中文');
    expect(buttons[1]?.textContent).toBe('English');
    expect(buttons[0]?.getAttribute('aria-checked')).toBe('true');

    await act(async () => {
      buttons[1]?.click();
    });

    expect(useI18nStore.getState().language).toBe('en');
    expect(buttons[1]?.getAttribute('aria-checked')).toBe('true');
  });
});
