/**
 * Per-viewer conveniences (language, theme, remembered tab) in localStorage. Every access is
 * guarded: storage can be unavailable in private windows or sandboxed frames, and the app must work
 * without it. Substantial state lives in IndexedDB (db.ts), not here.
 */
const PREFIX = 'openkey.pref.';
const LEGACY_PREFIX = 'openak820.pref.';

export function readPref(key: string): string | null {
  try {
    const ls = globalThis.localStorage;
    return ls?.getItem(PREFIX + key) ?? ls?.getItem(LEGACY_PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, value);
  } catch {
    /* storage unavailable: the preference lasts for this page only */
  }
}

export function clearPrefs(): void {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return;
    for (let i = ls.length - 1; i >= 0; i--) {
      const k = ls.key(i);
      if (k && (k.startsWith('openkey.') || k.startsWith('openak820'))) ls.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
