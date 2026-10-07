import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { StateStore } from '@openkey/core';

export function defaultStateDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config');
  const dir = path.join(base, 'openkey');
  // Keep using the pre-rename directory so mirrors and backups written by OpenAK820 stay visible.
  const legacy = path.join(base, 'openak820');
  return !existsSync(dir) && existsSync(legacy) ? legacy : dir;
}

/** JSON-file backed StateStore for the CLI (mirror state, last-written settings). */
export class FileStateStore implements StateStore {
  private cache: Record<string, unknown> | null = null;

  constructor(private readonly file = path.join(defaultStateDir(), 'state.json')) {}

  private async load(): Promise<Record<string, unknown>> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await fs.readFile(this.file, 'utf8')) as Record<string, unknown>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2));
    await fs.rename(tmp, this.file);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return (await this.load())[key] as T | undefined;
  }
  async set<T>(key: string, value: T): Promise<void> {
    (await this.load())[key] = value;
    await this.save();
  }
  async delete(key: string): Promise<void> {
    delete (await this.load())[key];
    await this.save();
  }
  async keys(prefix = ''): Promise<string[]> {
    return Object.keys(await this.load()).filter((k) => k.startsWith(prefix));
  }
}
