import type { StateStore } from '@openkey/core';

/**
 * Local-first storage in IndexedDB. Two stores:
 * - `mirror`: values written to write-only firmware (StateStore for drivers).
 * - `records`: user data — profiles, backups, macro/RGB/TFT projects, research traces.
 * Nothing is uploaded anywhere. When IndexedDB is unavailable (private mode, blocked site data) an
 * in-memory map keeps the app working for the session.
 */
const DB_NAME = 'openkey';
const DB_VERSION = 1;
const MIRROR = 'mirror';
const RECORDS = 'records';

export type RecordKind =
  | 'profile'
  | 'backup'
  | 'macro-project'
  | 'rgb-project'
  | 'tft-project'
  | 'trace'
  | 'definition'
  | 'research-note';

export interface StoredRecord<T = unknown> {
  id: string;
  kind: RecordKind;
  name: string;
  createdAt: string;
  updatedAt: string;
  data: T;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = { [MIRROR]: new Map<string, unknown>(), [RECORDS]: new Map<string, unknown>() };

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(MIRROR)) db.createObjectStore(MIRROR);
        if (!db.objectStoreNames.contains(RECORDS)) {
          const s = db.createObjectStore(RECORDS, { keyPath: 'id' });
          s.createIndex('kind', 'kind');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(
  name: typeof MIRROR | typeof RECORDS,
  mode: IDBTransactionMode,
): Promise<IDBObjectStore | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return db.transaction(name, mode).objectStore(name);
  } catch {
    return null;
  }
}

/** Driver StateStore backed by IndexedDB; migrates OpenAK820 localStorage mirrors on first use. */
export class IdbStateStore implements StateStore {
  private migrated: Promise<void> | null = null;

  private migrate(): Promise<void> {
    this.migrated ??= (async () => {
      try {
        const ls = globalThis.localStorage;
        if (!ls) return;
        for (let i = ls.length - 1; i >= 0; i--) {
          const k = ls.key(i);
          if (!k?.startsWith('openak820/')) continue;
          const key = k.slice('openak820/'.length);
          if ((await this.rawGet(key)) === undefined)
            await this.set(key, JSON.parse(ls.getItem(k) ?? 'null'));
        }
      } catch {
        /* nothing to migrate */
      }
    })();
    return this.migrated;
  }

  private async rawGet<T>(key: string): Promise<T | undefined> {
    const s = await store(MIRROR, 'readonly');
    if (!s) return memory[MIRROR].get(key) as T | undefined;
    return (await wrap(s.get(key))) as T | undefined;
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.migrate();
    return this.rawGet<T>(key);
  }
  async set<T>(key: string, value: T): Promise<void> {
    const s = await store(MIRROR, 'readwrite');
    if (!s) return void memory[MIRROR].set(key, value);
    await wrap(s.put(value, key));
  }
  async delete(key: string): Promise<void> {
    const s = await store(MIRROR, 'readwrite');
    if (!s) return void memory[MIRROR].delete(key);
    await wrap(s.delete(key));
  }
  async keys(prefix = ''): Promise<string[]> {
    await this.migrate();
    const s = await store(MIRROR, 'readonly');
    const all = s ? ((await wrap(s.getAllKeys())) as string[]) : [...memory[MIRROR].keys()];
    return all.filter((k) => k.startsWith(prefix));
  }
}

export async function listRecords<T>(kind: RecordKind): Promise<StoredRecord<T>[]> {
  const s = await store(RECORDS, 'readonly');
  const all = s
    ? ((await wrap(s.index('kind').getAll(kind))) as StoredRecord<T>[])
    : ([...memory[RECORDS].values()] as StoredRecord<T>[]).filter((r) => r.kind === kind);
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveRecord<T>(
  r: Omit<StoredRecord<T>, 'createdAt' | 'updatedAt'> & { createdAt?: string },
): Promise<StoredRecord<T>> {
  const now = new Date().toISOString();
  const full: StoredRecord<T> = { ...r, createdAt: r.createdAt ?? now, updatedAt: now };
  const s = await store(RECORDS, 'readwrite');
  if (!s) memory[RECORDS].set(full.id, full);
  else await wrap(s.put(full));
  return full;
}

export async function deleteRecord(id: string): Promise<void> {
  const s = await store(RECORDS, 'readwrite');
  if (!s) return void memory[RECORDS].delete(id);
  await wrap(s.delete(id));
}

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const LOCAL_EXPORT_FORMAT = 'openkey-local-data';

/** Everything OpenKey stores in this browser, as one JSON document. */
export async function exportAll(): Promise<unknown> {
  const m = await store(MIRROR, 'readonly');
  // Both requests are issued in the same tick so they share one live transaction.
  const [keys, values] = m
    ? await Promise.all([wrap(m.getAllKeys()), wrap(m.getAll())])
    : [[...memory[MIRROR].keys()], [...memory[MIRROR].values()]];
  const mirror: Record<string, unknown> = {};
  (keys as IDBValidKey[]).forEach((k, i) => (mirror[String(k)] = values[i]));
  const r = await store(RECORDS, 'readonly');
  const records = r ? await wrap(r.getAll()) : [...memory[RECORDS].values()];
  return {
    format: LOCAL_EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    mirror,
    records,
  };
}

export async function importAll(doc: unknown): Promise<{ records: number; mirror: number }> {
  const d = doc as { format?: string; mirror?: Record<string, unknown>; records?: StoredRecord[] };
  if (d?.format !== LOCAL_EXPORT_FORMAT) throw new Error('Not an OpenKey local-data export');
  const st = new IdbStateStore();
  const mirror = Object.entries(d.mirror ?? {});
  for (const [k, v] of mirror) await st.set(k, v);
  const records = Array.isArray(d.records) ? d.records : [];
  for (const rec of records) if (rec && typeof rec.id === 'string') await saveRecord({ ...rec });
  return { records: records.length, mirror: mirror.length };
}

export async function clearAll(): Promise<void> {
  memory[MIRROR].clear();
  memory[RECORDS].clear();
  for (const name of [MIRROR, RECORDS] as const) {
    const s = await store(name, 'readwrite');
    if (s) await wrap(s.clear());
  }
  try {
    const ls = globalThis.localStorage;
    for (let i = (ls?.length ?? 0) - 1; i >= 0; i--) {
      const k = ls!.key(i);
      if (k?.startsWith('openak820/')) ls!.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
