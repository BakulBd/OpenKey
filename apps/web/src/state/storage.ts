import type { StateStore } from '@openak820/core';

/**
 * Browser StateStore for mirror state (values written to write-only firmware). Every access is
 * guarded: storage can be unavailable in private windows or sandboxed frames.
 */
export class LocalStorageStateStore implements StateStore {
  private readonly memory = new Map<string, string>();
  constructor(private readonly prefix = 'openak820/') {}

  private raw(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }
  async get<T>(key: string): Promise<T | undefined> {
    let v: string | null | undefined;
    try {
      v = this.raw()?.getItem(this.prefix + key);
    } catch {
      v = undefined;
    }
    v ??= this.memory.get(key) ?? null;
    return v === null ? undefined : (JSON.parse(v) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    const s = JSON.stringify(value);
    this.memory.set(key, s);
    try {
      this.raw()?.setItem(this.prefix + key, s);
    } catch {
      // Quota or disabled storage: keep the in-memory copy.
    }
  }
  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    try {
      this.raw()?.removeItem(this.prefix + key);
    } catch {
      /* ignore */
    }
  }
  async keys(prefix = ''): Promise<string[]> {
    const out = new Set(this.memory.keys());
    try {
      const s = this.raw();
      if (s)
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i);
          if (k?.startsWith(this.prefix)) out.add(k.slice(this.prefix.length));
        }
    } catch {
      /* ignore */
    }
    return [...out].filter((k) => k.startsWith(prefix));
  }
}

export function readPref(key: string, fallback: string): string {
  try {
    return globalThis.localStorage?.getItem(`openak820.pref.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(`openak820.pref.${key}`, value);
  } catch {
    /* ignore */
  }
}
