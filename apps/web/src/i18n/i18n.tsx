import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './locales/en.js';
import type { MessageKey, Messages } from './locales/en.js';
import { readPref, writePref } from '../state/prefs.js';

export type { MessageKey } from './locales/en.js';

export interface LocaleInfo {
  code: string;
  /** Name in the language itself. */
  name: string;
  load: () => Promise<Partial<Messages>>;
}

/** Locale catalogues are loaded on demand so the initial bundle only carries English. */
export const LOCALES: readonly LocaleInfo[] = [
  { code: 'en', name: 'English', load: async () => en },
  { code: 'bn', name: 'বাংলা', load: async () => (await import('./locales/bn.js')).default },
  { code: 'zh-CN', name: '简体中文', load: async () => (await import('./locales/zh-CN.js')).default },
  { code: 'zh-TW', name: '繁體中文', load: async () => (await import('./locales/zh-TW.js')).default },
  { code: 'ja', name: '日本語', load: async () => (await import('./locales/ja.js')).default },
  { code: 'ko', name: '한국어', load: async () => (await import('./locales/ko.js')).default },
  { code: 'ru', name: 'Русский', load: async () => (await import('./locales/ru.js')).default },
  { code: 'fr', name: 'Français', load: async () => (await import('./locales/fr.js')).default },
  { code: 'de', name: 'Deutsch', load: async () => (await import('./locales/de.js')).default },
  { code: 'es', name: 'Español', load: async () => (await import('./locales/es.js')).default },
  { code: 'pt', name: 'Português', load: async () => (await import('./locales/pt.js')).default },
];

export type { Vars } from './interpolate.js';
import type { Vars } from './interpolate.js';
export type Translate = (key: MessageKey, vars?: Vars) => string;

export { interpolate } from './interpolate.js';
import { interpolate } from './interpolate.js';

export function makeTranslate(messages: Partial<Messages>): Translate {
  return (key, vars) => interpolate(messages[key] ?? en[key] ?? '', vars);
}

/** Picks the best supported locale from the browser's preference list. */
export function negotiateLocale(preferred: readonly string[]): string {
  for (const p of preferred) {
    const exact = LOCALES.find((l) => l.code.toLowerCase() === p.toLowerCase());
    if (exact) return exact.code;
    if (/^zh-(tw|hk|mo|hant)/i.test(p)) return 'zh-TW';
    if (/^zh/i.test(p)) return 'zh-CN';
    const base = LOCALES.find((l) => l.code.split('-')[0] === p.split('-')[0]!.toLowerCase());
    if (base) return base.code;
  }
  return 'en';
}

interface I18nCtx {
  locale: string;
  setLocale(code: string): void;
  t: Translate;
  /** Share of keys translated in the active locale (1 for English). */
  coverage: number;
  formatNumber(n: number, opts?: Intl.NumberFormatOptions): string;
  formatDate(d: Date | string): string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState(
    () => readPref('locale') ?? negotiateLocale(typeof navigator !== 'undefined' ? navigator.languages ?? [] : []),
  );
  const [messages, setMessages] = useState<Partial<Messages>>(en);

  useEffect(() => {
    let live = true;
    const info = LOCALES.find((l) => l.code === locale) ?? LOCALES[0]!;
    void info.load().then((m) => {
      if (live) setMessages(m);
    });
    document.documentElement.lang = locale;
    return () => {
      live = false;
    };
  }, [locale]);

  const setLocale = useCallback((code: string) => {
    writePref('locale', code);
    setLocaleState(code);
  }, []);

  const value = useMemo<I18nCtx>(() => {
    const total = Object.keys(en).length;
    const translated = Object.keys(messages).filter((k) => k in en).length;
    const nf = (n: number, opts?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, opts).format(n);
    return {
      locale,
      setLocale,
      t: makeTranslate(messages),
      coverage: locale === 'en' ? 1 : translated / total,
      formatNumber: nf,
      formatDate: (d) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d)),
    };
  }, [locale, messages, setLocale]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useI18n outside I18nProvider');
  return c;
}

export function useT(): Translate {
  return useI18n().t;
}
