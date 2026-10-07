import { readPref, writePref } from './prefs.js';

export type ThemePref = 'system' | 'light' | 'dark';

export function themePref(): ThemePref {
  const v = readPref('theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}

/** Applies the theme preference; `system` follows prefers-color-scheme through CSS alone. */
export function applyTheme(pref: ThemePref = themePref()): void {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function setTheme(pref: ThemePref): void {
  writePref('theme', pref);
  applyTheme(pref);
}
