/**
 * Persistent key/value storage for "mirror" state: values OpenKey wrote to firmware that the
 * firmware cannot report back. Implementations: in-memory (tests), localStorage (web),
 * JSON file (CLI). Values must be JSON-serialisable.
 */
export interface StateStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

export class MemoryStateStore implements StateStore {
  private readonly data = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const v = this.data.get(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async keys(prefix = ''): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

/** Namespaces a store per physical keyboard so two boards never share mirrors. */
export class ScopedStateStore implements StateStore {
  constructor(
    private readonly inner: StateStore,
    private readonly scope: string,
  ) {}
  private k(key: string): string {
    return `${this.scope}/${key}`;
  }
  get<T>(key: string): Promise<T | undefined> {
    return this.inner.get<T>(this.k(key));
  }
  set<T>(key: string, value: T): Promise<void> {
    return this.inner.set(this.k(key), value);
  }
  delete(key: string): Promise<void> {
    return this.inner.delete(this.k(key));
  }
  async keys(prefix = ''): Promise<string[]> {
    const all = await this.inner.keys(this.k(prefix));
    return all.map((k) => k.slice(this.scope.length + 1));
  }
}
